<#
.SYNOPSIS
  Sets up everything Remote PC needs on this PC: Tailscale, Claude Code (with Git), OpenCode,
  FFmpeg, the tools that put the app on your iPhone, the firewall rule and start-at-sign-in.

.DESCRIPTION
  The installer runs this at the end. Run it again any time from the Start menu ("Remote PC Setup")
  to repair things or sign in again: steps that are already done are skipped. With no switches it
  repeats the choices made in the installer.
#>
[CmdletBinding()]
param(
  [switch]$Tailscale,
  [switch]$Claude,
  [switch]$OpenCode,
  [switch]$Ffmpeg,
  [switch]$IPhoneTools,
  [switch]$Startup,
  [switch]$Firewall,
  # Everything above.
  [switch]$All,
  # No questions, sign-in windows or browser (silent installs and CI).
  [switch]$Unattended,
  # Set by the installer: the switches are the complete choice (don't reuse the saved one).
  [switch]$Installer,
  # Only stop the running agent (the installer does this before replacing files).
  [switch]$Stop,
  # Undo what setup did to Windows (the uninstaller runs this).
  [switch]$Uninstall
)

# This file must stay plain ASCII: Windows PowerShell 5.1 reads scripts without a BOM as ANSI.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

$App = $PSScriptRoot
$Node = Join-Path $App 'node\node.exe'
$Agent = Join-Path $App 'agent\dist\index.js'
$Bin = Join-Path $App 'bin'
$Choices = Join-Path $App 'setup.json'
$RuleName = 'Remote PC agent'
$Failures = New-Object System.Collections.Generic.List[string]

function Step([string]$Text) { Write-Host ''; Write-Host "  $Text" -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host "    + $Text" -ForegroundColor Green }
function Info([string]$Text) { Write-Host "    $Text" }
function Warn([string]$Text) { Write-Host "    ! $Text" -ForegroundColor Yellow }

# Runs a program and shows its output indented. Windows PowerShell turns a native program's stderr
# into errors when $ErrorActionPreference is Stop, so relax it for the call; check $LASTEXITCODE.
function Show-Native([string]$File, [string[]]$Arguments) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $File @Arguments 2>&1 | ForEach-Object {
      $line = ("$_" -split "`r")[-1].Trim()
      if ($line -match '[A-Za-z]{2}') { Write-Host "      $line" -ForegroundColor DarkGray }
    }
  } finally { $ErrorActionPreference = $old }
}

function Read-Native([string]$File, [string[]]$Arguments) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { return (& $File @Arguments 2>$null | Out-String) } finally { $ErrorActionPreference = $old }
}

function Update-Path {
  $parts = @($Bin, (Join-Path $env:USERPROFILE '.local\bin'),
    [Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'))
  $env:Path = ($parts | Where-Object { $_ }) -join ';'
}

function Find-Exe([string]$Name, [string[]]$Candidates) {
  foreach ($c in $Candidates) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  $cmd = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($cmd) { return $cmd.Source }
  return $null
}

function Get-File([string]$Url, [string]$OutFile) {
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
}

function Install-Winget([string]$Id) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return $false }
  Show-Native 'winget' @('install', '--id', $Id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements')
  # 0x8A15002B: nothing newer to install, 0x8A150061: already installed.
  return ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335189 -or $LASTEXITCODE -eq -1978335135)
}

# Waits for a condition (a sign-in, usually). The user can press S to stop waiting.
function Wait-Until([scriptblock]$Done, [string]$Message, [int]$Minutes = 15) {
  if (& $Done) { return $true }
  Info "$Message  (press S to skip)"
  $deadline = (Get-Date).AddMinutes($Minutes)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1500
    if (& $Done) { return $true }
    try { while ([Console]::KeyAvailable) { if ([Console]::ReadKey($true).Key -eq 'S') { return $false } } } catch {}
  }
  return $false
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Start-Process -Wait also waits for everything the process starts (a tray app, our agent), which
# can be forever; wait for the process itself.
function Start-AndWait([string]$File, [string[]]$Arguments, [switch]$Elevated) {
  if ($Elevated) { $p = Start-Process $File -ArgumentList $Arguments -Verb RunAs -WindowStyle Hidden -PassThru }
  else { $p = Start-Process $File -ArgumentList $Arguments -PassThru }
  $p.WaitForExit()
  return $p.ExitCode
}

# Runs a script as administrator (one UAC prompt) unless we already are.
function Invoke-Elevated([string]$Script) {
  if (Test-Admin) { & ([scriptblock]::Create($Script)); return }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
  $code = Start-AndWait 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -Elevated
  if ($code -ne 0) { throw "the elevated step failed (exit code $code)" }
}

function Stop-Agent {
  $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $Node) })
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($procs.Count -gt 0) { Start-Sleep -Milliseconds 800 }
}

function Remove-FirewallRule {
  if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
    Invoke-Elevated "Remove-NetFirewallRule -DisplayName '$RuleName' -ErrorAction SilentlyContinue"
  }
}

if ($Stop) { Stop-Agent; exit 0 }

if ($Uninstall) {
  Stop-Agent
  if (Test-Path -LiteralPath $Node) { Show-Native $Node @($Agent, 'uninstall-startup') }
  try { Remove-FirewallRule } catch { Write-Host "Could not remove the firewall rule: $_" }
  exit 0
}

# ---------------------------------------------------------------------------------------------
# Which parts to set up: the switches, everything with -All, or what the installer chose last time.

$names = 'Tailscale', 'Claude', 'OpenCode', 'Ffmpeg', 'IPhoneTools', 'Startup', 'Firewall'
$want = @{}
foreach ($n in $names) { $want[$n] = [bool](Get-Variable $n -ValueOnly) -or $All }
if (-not $Installer -and -not ($want.Values -contains $true) -and (Test-Path -LiteralPath $Choices)) {
  $saved = Get-Content -LiteralPath $Choices -Raw | ConvertFrom-Json
  foreach ($n in $names) { $want[$n] = [bool]$saved.$n }
}
($want | ConvertTo-Json) | Set-Content -LiteralPath $Choices -Encoding ASCII

try { Start-Transcript -Path (Join-Path $env:TEMP 'RemotePC-setup.log') -Append | Out-Null } catch {}
try { $Host.UI.RawUI.WindowTitle = 'Remote PC setup' } catch {}
Write-Host ''
Write-Host '  Remote PC setup' -ForegroundColor White
Write-Host '  Setting up this PC so your iPhone can use it. Sign-in windows open when they are needed.' -ForegroundColor DarkGray

if (-not (Test-Path -LiteralPath $Node) -or -not (Test-Path -LiteralPath $Agent)) {
  Warn "Remote PC is not installed next to this script ($App). Run RemotePC-Setup.exe."
  exit 1
}
Update-Path

# ---------------------------------------------------------------------------------------------
if ($want.Tailscale) {
  Step 'Tailscale (reach your PC from anywhere)'
  try {
    $tsCandidates = @("$env:ProgramFiles\Tailscale\tailscale.exe")
    $ts = Find-Exe 'tailscale' $tsCandidates
    if (-not $ts) {
      Info 'Installing Tailscale...'
      if (-not (Install-Winget 'Tailscale.Tailscale')) {
        $f = Join-Path $env:TEMP 'tailscale-setup.exe'
        Get-File 'https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe' $f
        [void](Start-AndWait $f @('/passive'))
      }
      Update-Path
      $ts = Find-Exe 'tailscale' $tsCandidates
    }
    if (-not $ts) { throw 'Tailscale did not install' }
    Ok 'Installed'

    $state = { try { return ((Read-Native $ts @('status', '--json')) | ConvertFrom-Json).BackendState } catch { return 'Unknown' } }
    $current = & $state
    if ($current -eq 'Running') {
      Ok 'Signed in'
    } elseif ($Unattended) {
      Warn 'Not signed in. Sign in from the Tailscale icon in the taskbar.'
    } else {
      $ipn = "$env:ProgramFiles\Tailscale\tailscale-ipn.exe"
      if ((Test-Path $ipn) -and -not (Get-Process tailscale-ipn -ErrorAction SilentlyContinue)) { Start-Process $ipn }
      $out = Join-Path $env:TEMP 'remotepc-tailscale-up'
      $up = Start-Process $ts -ArgumentList 'up' -WindowStyle Hidden -PassThru -RedirectStandardError "$out.err" -RedirectStandardOutput "$out.out"
      $url = $null
      for ($i = 0; $i -lt 40 -and -not $url; $i++) {
        Start-Sleep -Milliseconds 500
        $text = (Get-Content "$out.err", "$out.out" -Raw -ErrorAction SilentlyContinue) -join "`n"
        if ($text -match '(https://login\.tailscale\.com/\S+)') { $url = $Matches[1] }
        if ((& $state) -eq 'Running') { break }
      }
      if ($url) { Start-Process $url }
      if (Wait-Until { (& $state) -eq 'Running' } 'Sign in to Tailscale in your browser (use the same account on the iPhone).') {
        Ok 'Signed in'
      } else {
        Warn 'Skipped. Sign in later from the Tailscale icon in the taskbar.'
      }
      if (-not $up.HasExited) { Stop-Process -Id $up.Id -Force -ErrorAction SilentlyContinue }
    }
  } catch { Warn "Tailscale: $_"; $Failures.Add('Tailscale') }
}

# ---------------------------------------------------------------------------------------------
if ($want.Claude) {
  Step 'Claude Code'
  try {
    $git = Find-Exe 'git' @("$env:ProgramFiles\Git\cmd\git.exe")
    if (-not $git) {
      Info 'Installing Git for Windows (gives Claude a Bash shell)...'
      if (-not (Install-Winget 'Git.Git')) {
        $rel = Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest'
        $asset = $rel.assets | Where-Object { $_.name -match '^Git-.*-64-bit\.exe$' } | Select-Object -First 1
        $f = Join-Path $env:TEMP $asset.name
        Get-File $asset.browser_download_url $f
        [void](Start-AndWait $f @('/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'))
      }
      Update-Path
      $git = Find-Exe 'git' @("$env:ProgramFiles\Git\cmd\git.exe")
    }
    if ($git) { Ok "Git: $git" } else { Warn 'Git for Windows did not install; Claude will use PowerShell instead of Bash.' }

    $claudeCandidates = @("$env:USERPROFILE\.local\bin\claude.exe", "$env:LOCALAPPDATA\Microsoft\WinGet\Links\claude.exe")
    $claude = Find-Exe 'claude' $claudeCandidates
    if (-not $claude) {
      Info 'Installing Claude Code...'
      Show-Native 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex')
      Update-Path
      $claude = Find-Exe 'claude' $claudeCandidates
      if (-not $claude -and (Install-Winget 'Anthropic.ClaudeCode')) { Update-Path; $claude = Find-Exe 'claude' $claudeCandidates }
    }
    if (-not $claude) { throw 'Claude Code did not install. Get it from https://claude.com/claude-code and run Remote PC Setup again.' }
    Ok "Installed: $claude"

    $signedIn = {
      if ($env:ANTHROPIC_API_KEY) { return $true }
      if (Test-Path "$env:USERPROFILE\.claude\.credentials.json") { return $true }
      $cfg = "$env:USERPROFILE\.claude.json"
      if (Test-Path $cfg) { try { return [bool]((Get-Content $cfg -Raw | ConvertFrom-Json).oauthAccount) } catch {} }
      return $false
    }
    if (& $signedIn) {
      Ok 'Signed in'
    } elseif ($Unattended) {
      Warn 'Not signed in. Run "claude" in a terminal once to sign in.'
    } else {
      Info 'A Claude Code window is opening. Sign in there with your Claude account, then type /exit.'
      Start-Process $claude -WorkingDirectory $env:USERPROFILE
      if (Wait-Until $signedIn 'Waiting for you to sign in to Claude...') { Ok 'Signed in' }
      else { Warn 'Skipped. Run "claude" in a terminal to sign in later.' }
    }
  } catch { Warn "Claude Code: $_"; $Failures.Add('Claude Code') }
}

# ---------------------------------------------------------------------------------------------
if ($want.OpenCode) {
  Step 'OpenCode'
  try {
    $ours = Join-Path $Bin 'opencode.exe'
    $oc = Find-Exe 'opencode' @($ours)
    $arch = 'x64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
    $pkg = "opencode-windows-$arch"
    if ($arch -eq 'x64') {
      # Builds for CPUs without AVX2 are published separately.
      try {
        Add-Type -Namespace RemotePC -Name Cpu -MemberDefinition '[DllImport("kernel32.dll")] public static extern bool IsProcessorFeaturePresent(int feature);' -ErrorAction SilentlyContinue
        if (-not [RemotePC.Cpu]::IsProcessorFeaturePresent(40)) { $pkg += '-baseline' }
      } catch {}
    }
    $latest = Invoke-RestMethod "https://registry.npmjs.org/$pkg/latest"
    $have = $null
    if ($oc) { $have = ((Read-Native $oc @('--version')) -split "`n")[0].Trim() }
    if ($oc -and ($oc -ine $ours -or $have -eq $latest.version)) {
      Ok "Installed: $oc $have"
    } else {
      Info "Downloading OpenCode $($latest.version)..."
      $tgz = Join-Path $env:TEMP "$pkg.tgz"
      $tmp = Join-Path $env:TEMP "remotepc-$pkg"
      Get-File $latest.dist.tarball $tgz
      if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
      New-Item -ItemType Directory -Path $tmp | Out-Null
      Show-Native 'tar.exe' @('-xzf', $tgz, '-C', $tmp)
      $exe = Join-Path $tmp 'package\bin\opencode.exe'
      if (-not (Test-Path $exe)) { throw 'the download did not contain opencode.exe' }
      New-Item -ItemType Directory -Force -Path $Bin | Out-Null
      Copy-Item $exe $ours -Force
      Remove-Item $tmp, $tgz -Recurse -Force -ErrorAction SilentlyContinue
      $oc = $ours
      Ok "Installed: $oc"
    }

    $auth = Join-Path $env:USERPROFILE '.local\share\opencode\auth.json'
    if ((Test-Path $auth) -or $Unattended) {
      if (-not (Test-Path $auth)) { Warn 'No AI provider signed in yet. Run "opencode auth login" later.' } else { Ok 'Signed in' }
    } else {
      Info 'An OpenCode window is opening: pick an AI provider and sign in (Anthropic uses your Claude account).'
      $login = Start-Process $oc -ArgumentList 'auth', 'login' -WorkingDirectory $env:USERPROFILE -PassThru
      if (Wait-Until { $login.HasExited } 'Waiting for OpenCode sign-in...') { Ok 'Done' }
      else { Warn 'Skipped. Run "opencode auth login" later.' }
    }
  } catch { Warn "OpenCode: $_"; $Failures.Add('OpenCode') }
}

# ---------------------------------------------------------------------------------------------
if ($want.Ffmpeg) {
  Step 'FFmpeg (for the live screen)'
  Show-Native $Node @($Agent, 'ffmpeg')
  if ($LASTEXITCODE -eq 0) { Ok 'Ready' } else { Warn 'Could not download FFmpeg now; the agent will try again the first time you use the live screen.'; $Failures.Add('FFmpeg') }
}

# ---------------------------------------------------------------------------------------------
if ($want.IPhoneTools) {
  Step 'iPhone install tools (iloader and the Apple USB driver)'
  try {
    if (Get-Service -Name 'Apple Mobile Device Service' -ErrorAction SilentlyContinue) {
      Ok 'Apple USB driver present'
    } else {
      Info 'Installing iTunes (its Apple Mobile Device driver lets this PC talk to the iPhone)...'
      if (Install-Winget 'Apple.iTunes') { Ok 'iTunes installed' }
      else { Warn 'Install iTunes from https://www.apple.com/itunes/download/win64 (not the Microsoft Store version).'; $Failures.Add('iTunes') }
    }
    $findIloader = {
      foreach ($c in @("$env:LOCALAPPDATA\iloader\iloader.exe", "$env:LOCALAPPDATA\Programs\iloader\iloader.exe", "$env:ProgramFiles\iloader\iloader.exe")) {
        if (Test-Path $c) { return $c }
      }
      $lnk = Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs" -Filter 'iloader*.lnk' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($lnk) { return $lnk.FullName }
      return $null
    }
    $iloader = & $findIloader
    if (-not $iloader) {
      Info 'Installing iloader (puts SideStore on your iPhone over USB)...'
      $f = Join-Path $env:TEMP 'iloader-setup.exe'
      Get-File 'https://github.com/nab138/iloader/releases/latest/download/iloader-windows-x64.exe' $f
      $p = Start-Process $f -ArgumentList '/S' -PassThru
      [void]$p.WaitForExit(300000)
      $iloader = & $findIloader
    }
    if ($iloader) { Ok "iloader: open it from the Start menu with the iPhone plugged in" }
    else { Warn 'iloader did not install. Get it from https://github.com/nab138/iloader/releases'; $Failures.Add('iloader') }
  } catch { Warn "iPhone tools: $_"; $Failures.Add('iPhone tools') }
}

# ---------------------------------------------------------------------------------------------
if ($want.Firewall) {
  Step 'Windows Firewall'
  try {
    $rule = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Select-Object -First 1
    $program = $null
    if ($rule) { $program = ($rule | Get-NetFirewallApplicationFilter).Program }
    if ($program -and ($program -ieq $Node)) {
      Ok 'The iPhone is already allowed in'
    } else {
      if (-not (Test-Admin) -and -not $Unattended) { Info 'Windows will ask for permission to add the firewall rule.' }
      $nodeQ = $Node.Replace("'", "''")
      Invoke-Elevated @"
Remove-NetFirewallRule -DisplayName '$RuleName' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName '$RuleName' -Description 'Lets the Remote PC iPhone app reach this PC over Tailscale or your home network.' -Direction Inbound -Action Allow -Program '$nodeQ' -RemoteAddress LocalSubnet,100.64.0.0/10,fd7a:115c:a1e0::/48 -Profile Any | Out-Null
"@
      Ok 'Allowed in from Tailscale and your home network only'
    }
  } catch { Warn "Firewall: $_. Windows will ask the first time the phone connects instead."; $Failures.Add('Firewall') }
}

# ---------------------------------------------------------------------------------------------
if ($want.Startup) {
  Step 'Start with Windows'
  Show-Native $Node @($Agent, 'install-startup')
  if ($LASTEXITCODE -eq 0) { Ok 'Remote PC starts in the background when you sign in' } else { $Failures.Add('Start with Windows') }
}

# ---------------------------------------------------------------------------------------------
Step 'Starting Remote PC'
Stop-Agent
Update-Path
$welcome = @("`"$Agent`"", 'welcome', '--start')
if ($Unattended) { $welcome += '--no-open' }
# Not through a pipe: the agent it starts in the background would hold the pipe open.
$p = Start-Process $Node -ArgumentList $welcome -NoNewWindow -PassThru
[void]$p.WaitForExit(120000)
$config = (Read-Native $Node @($Agent, 'config')).Trim()
$port = 8787
try { $port = (Get-Content -LiteralPath $config -Raw | ConvertFrom-Json).port } catch {}
$running = $false
try { $running = (Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 5).ok } catch {}
if ($running) {
  Ok "Running (port $port)"
  if (-not $Unattended) { Ok 'The "Connect your iPhone" page opened in your browser' }
} else {
  Warn "The agent is not running. Its log: $(Join-Path (Split-Path $config) 'agent.log')"
  $Failures.Add('Agent')
}

Write-Host ''
if ($Failures.Count -eq 0) {
  Write-Host '  All set. Follow the steps on the "Connect your iPhone" page.' -ForegroundColor Green
} else {
  Write-Host "  Done, with problems: $($Failures -join ', '). Run Remote PC Setup from the Start menu to try again." -ForegroundColor Yellow
}
try { Stop-Transcript | Out-Null } catch {}

if (-not $Unattended) {
  if ($Failures.Count -eq 0) {
    Write-Host '  This window closes in 15 seconds.' -ForegroundColor DarkGray
    Start-Sleep -Seconds 15
  } else {
    Write-Host '  Press Enter to close.' -ForegroundColor DarkGray
    [void](Read-Host)
  }
}
if ($Failures.Contains('Agent')) { exit 1 }
exit 0
