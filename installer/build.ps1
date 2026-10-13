<#
.SYNOPSIS
  Builds installer\out\RemotePC-Setup.exe: the agent with its production dependencies, a private
  Node.js runtime, the SDK and setup.ps1, packed by Inno Setup.

.EXAMPLE
  .\installer\build.ps1                 # needs Node.js, npm and Inno Setup 6 (choco install innosetup)
#>
param(
  [string]$Version,
  # Node.js major version to bundle (the one CI tests the agent with).
  [string]$NodeMajor = '22',
  # Skip `npm ci` + `npm run build` in agent\ (CI has already done it).
  [switch]$NoAgentBuild
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$here = $PSScriptRoot
$root = Split-Path -Parent $here
$agentSrc = Join-Path $root 'agent'
$out = Join-Path $here 'out'
$stage = Join-Path $out 'stage'

function Invoke-Checked([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

if (-not $Version) { $Version = (Get-Content (Join-Path $agentSrc 'package.json') -Raw | ConvertFrom-Json).version }
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

Write-Host "==> Agent $Version"
if (-not $NoAgentBuild) {
  Push-Location $agentSrc
  try { Invoke-Checked 'npm' @('ci', '--no-audit', '--no-fund'); Invoke-Checked 'npm' @('run', 'build') } finally { Pop-Location }
}
$agent = Join-Path $stage 'agent'
New-Item -ItemType Directory -Path $agent | Out-Null
Copy-Item (Join-Path $agentSrc 'dist'), (Join-Path $agentSrc 'assets') $agent -Recurse
Copy-Item (Join-Path $agentSrc 'package.json'), (Join-Path $agentSrc 'package-lock.json') $agent
Push-Location $agent
try {
  # Optional dependencies are the Claude Agent SDK's own ~250 MB Claude Code binaries. The installer
  # sets up Claude Code natively instead (it keeps itself updated), and the agent uses that one.
  Invoke-Checked 'npm' @('ci', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund')
} finally { Pop-Location }
Remove-Item (Join-Path $agent 'package-lock.json')

Write-Host "==> Node.js $NodeMajor (latest release)"
# Parentheses make PowerShell enumerate the JSON array instead of passing it on as one object.
$release = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.version -like "v$NodeMajor.*" } | Select-Object -First 1
$v = $release.version
$zip = Join-Path $out "node-$v-win-x64.zip"
Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$v/node-$v-win-x64.zip" -OutFile $zip
$nodeDir = Join-Path $stage 'node'
New-Item -ItemType Directory -Path $nodeDir | Out-Null
Invoke-Checked 'tar.exe' @('-xf', $zip, '-C', $out, "node-$v-win-x64/node.exe", "node-$v-win-x64/LICENSE")
Move-Item (Join-Path $out "node-$v-win-x64\node.exe"), (Join-Path $out "node-$v-win-x64\LICENSE") $nodeDir
Write-Host "    $v"

Write-Host '==> SDK and setup files'
Copy-Item (Join-Path $root 'sdk') $stage -Recurse
Copy-Item (Join-Path $here 'setup.ps1'), (Join-Path $here 'Remote PC.vbs'), (Join-Path $here 'remotepc.ico') $stage

Write-Host '==> Inno Setup'
$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { $iscc = (Get-Command iscc -ErrorAction SilentlyContinue).Source }
if (-not $iscc) { throw 'Inno Setup 6 not found. Install it with: choco install innosetup' }
Invoke-Checked $iscc @('/Q', "/DAppVersion=$Version", "/DStage=$stage", "/DOutDir=$out", (Join-Path $here 'RemotePC.iss'))

$exe = Join-Path $out 'RemotePC-Setup.exe'
Write-Host ("==> {0} ({1:N1} MB)" -f $exe, ((Get-Item $exe).Length / 1MB))
