<#
.SYNOPSIS
  Installs installer\out\RemotePC-Setup.exe silently, checks that everything works, then
  uninstalls it and checks that it cleaned up. CI runs this on a fresh Windows machine.
#>
param(
  [string]$Setup = (Join-Path $PSScriptRoot 'out\RemotePC-Setup.exe'),
  [string]$Components = 'agent,claude,opencode,ffmpeg',
  [string]$Tasks = 'startup,firewall'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$app = Join-Path $env:LOCALAPPDATA 'Programs\Remote PC'
$data = Join-Path $env:APPDATA 'RemotePC'
$startupVbs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\Remote PC Agent.vbs'
$shortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Remote PC.lnk'
$setupLog = Join-Path $env:TEMP 'RemotePC-setup.log'
$failed = 0

function Check([string]$Name, [scriptblock]$Test) {
  try {
    $detail = & $Test
    if ($detail -eq $false) { throw 'check returned false' }
    Write-Host "ok   $Name $(if ($detail -and $detail -ne $true) { "- $detail" })"
  } catch {
    $script:failed++
    Write-Host "FAIL $Name - $_" -ForegroundColor Red
  }
}

function Wait-For([scriptblock]$Test, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try { $r = & $Test; if ($r) { return $r } } catch {}
    Start-Sleep -Seconds 2
  }
  return $null
}

Write-Host "Installing $Setup ($Components; $Tasks)"
# Not Start-Process -Wait: that also waits for the agent the installer leaves running.
$p = Start-Process $Setup -PassThru -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/COMPONENTS=$Components", "/TASKS=$Tasks", "/LOG=$(Join-Path $env:TEMP 'RemotePC-install.log')"
$finished = $p.WaitForExit(25 * 60 * 1000)
if (Test-Path $setupLog) { Write-Host '--- setup.ps1 ---'; Get-Content $setupLog | Write-Host; Write-Host '---' }
if (-not $finished) {
  Get-Content (Join-Path $env:TEMP 'RemotePC-install.log') -ErrorAction SilentlyContinue | Select-Object -Last 40 | Write-Host
  throw 'The installer did not finish within 25 minutes'
}
Check 'installer exit code' { if ($p.ExitCode -ne 0) { throw "exit code $($p.ExitCode)" }; $true }
Check 'files' { (Test-Path "$app\node\node.exe") -and (Test-Path "$app\agent\dist\index.js") -and (Test-Path "$app\agent\node_modules\ws") }
Check 'no bundled Claude binary' { -not (Test-Path "$app\agent\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64") }
Check 'Start menu shortcut' { Test-Path $shortcut }
Check 'start at sign-in' { Test-Path $startupVbs }
Check 'firewall rule' { ((Get-NetFirewallRule -DisplayName 'Remote PC agent' | Get-NetFirewallApplicationFilter).Program) -ieq "$app\node\node.exe" }
Check 'welcome page' { Test-Path "$data\welcome.html" }

$config = Get-Content "$data\config.json" -Raw | ConvertFrom-Json
$base = "http://127.0.0.1:$($config.port)"
$headers = @{ Authorization = "Bearer $($config.token)" }
Check 'agent answers' { (Invoke-RestMethod "$base/health" -TimeoutSec 5).ok }
if ($Components -match 'claude') {
  Check 'Claude Code installed' { $c = "$env:USERPROFILE\.local\bin\claude.exe"; if (-not (Test-Path $c)) { $c = (Get-Command claude -ErrorAction Stop).Source }; (& $c --version) -join ' ' }
  Check 'agent can use Claude Code' {
    $info = Invoke-RestMethod "$base/api/info" -Headers $headers
    if (-not $info.agents.claude.available) { throw ($info.agents.claude.detail) }
    $true
  }
}
if ($Components -match 'opencode') {
  Check 'OpenCode installed' { (& "$app\bin\opencode.exe" --version) -join ' ' }
  Check 'agent started OpenCode' {
    $info = Wait-For { $i = Invoke-RestMethod "$base/api/info" -Headers $headers; if ($i.agents.opencode.available) { $i } } 90
    if (-not $info) { throw ((Invoke-RestMethod "$base/api/info" -Headers $headers).agents.opencode.detail) }
    $true
  }
}
if ($Components -match 'ffmpeg') {
  Check 'FFmpeg downloaded' { (Get-ChildItem "$data\ffmpeg" -Recurse -Filter ffmpeg.exe | Select-Object -First 1).FullName }
}
Check 'Remote PC shortcut starts the agent after it stopped' {
  & "$app\setup.ps1" -Stop
  [void](Wait-For { try { [void](Invoke-RestMethod "$base/health" -TimeoutSec 2); $false } catch { $true } } 15)
  Start-Process wscript.exe -ArgumentList "`"$app\Remote PC.vbs`""
  $ok = Wait-For { (Invoke-RestMethod "$base/health" -TimeoutSec 2).ok } 60
  if (-not $ok) { throw 'agent did not come back' }
  $true
}

Write-Host 'Uninstalling'
$u = Start-Process "$app\unins000.exe" -PassThru -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'
$u.WaitForExit()
# The uninstaller re-launches itself from a temp copy; wait for that one to finish.
[void](Wait-For { -not (Test-Path "$app\unins000.exe") } 120)
Check 'agent stopped' { $r = $null; try { $r = Invoke-RestMethod "$base/health" -TimeoutSec 2 } catch {}; -not $r }
Check 'files removed' { -not (Test-Path "$app\agent") -and -not (Test-Path "$app\node") -and -not (Test-Path "$app\bin") }
Check 'start at sign-in removed' { -not (Test-Path $startupVbs) }
Check 'firewall rule removed' { -not (Get-NetFirewallRule -DisplayName 'Remote PC agent' -ErrorAction SilentlyContinue) }
Check 'Start menu shortcut removed' { -not (Test-Path $shortcut) }
Check 'settings kept for a reinstall' { Test-Path "$data\config.json" }

if ($failed) { Write-Host "$failed check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host 'All installer checks passed' -ForegroundColor Green
