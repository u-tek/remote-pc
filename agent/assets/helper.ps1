# Long-lived helper for the Remote PC agent.
# Reads one JSON request per line on stdin and writes one JSON response per line on stdout.
# Heavy lifting lives in helper.cs so responses never go through PowerShell's JSON quirks.
param([string]$Source = (Join-Path $PSScriptRoot 'helper.cs'))

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath $Source) -ReferencedAssemblies @(
  'System.Drawing', 'System.Windows.Forms', 'System.Web.Extensions', 'Microsoft.VisualBasic'
)
[RemotePC.Win]::Init()
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

function Get-Apps {
  $list = New-Object 'System.Collections.Generic.List[RemotePC.AppEntry]'
  $entries = $null
  if (Get-Command Get-StartApps -ErrorAction SilentlyContinue) {
    $entries = Get-StartApps
  } else {
    $folder = (New-Object -ComObject Shell.Application).NameSpace('shell:::{4234d49b-0245-4df3-b780-3893943456e1}')
    $entries = foreach ($item in $folder.Items()) { [pscustomobject]@{ Name = $item.Name; AppID = $item.Path } }
  }
  foreach ($e in $entries) {
    if ($e.Name -and $e.AppID) {
      $list.Add((New-Object RemotePC.AppEntry -ArgumentList ([string]$e.Name), ([string]$e.AppID)))
    }
  }
  # Return the list object itself (unary comma stops PowerShell unrolling it).
  return ,$list
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $id = 0
  try {
    $req = ConvertFrom-Json -InputObject $line
    $id = [int]$req.id
    $a = $req.args
    $out = switch ([string]$req.op) {
      'ping'           { [RemotePC.Json]::OkString($id, 'pong') }
      'windows'        { [RemotePC.Json]::Ok($id, [RemotePC.Win]::ListWindows()) }
      'window'         { [RemotePC.Json]::Ok($id, [RemotePC.Win]::Act([long]$a.hwnd, [string]$a.action)) }
      'thumb'          { [RemotePC.Json]::OkString($id, [RemotePC.Win]::Thumbnail([long]$a.hwnd, [int]$a.width)) }
      'processes'      { [RemotePC.Json]::Ok($id, [RemotePC.Sys]::Processes()) }
      'apps'           { $apps = Get-Apps; [RemotePC.Json]::Ok($id, $apps) }
      'winicon'        { [RemotePC.Json]::OkString($id, [RemotePC.Shell]::WindowIcon([long]$a.hwnd, [int]$a.size)) }
      'appicon'        { [RemotePC.Json]::OkString($id, [RemotePC.Shell]::AppIcon([string]$a.id, [int]$a.size)) }
      'clip_get'       { [RemotePC.Json]::Ok($id, [RemotePC.Clip]::Get()) }
      'clip_set'       { [RemotePC.Json]::Ok($id, [RemotePC.Clip]::SetText([string]$a.text)) }
      'clip_set_image' { [RemotePC.Json]::Ok($id, [RemotePC.Clip]::SetImage([string]$a.data)) }
      'recycle'        { [RemotePC.Json]::Ok($id, [RemotePC.Shell]::Recycle([string]$a.path)) }
      'folders'        { [RemotePC.Json]::Ok($id, [RemotePC.Shell]::KnownFolders()) }
      'outputs'        { [RemotePC.Json]::Ok($id, [RemotePC.Display]::Outputs()) }
      'shot'           { [RemotePC.Json]::OkString($id, [RemotePC.Display]::Shot([int]$a.x, [int]$a.y, [int]$a.w, [int]$a.h, [int]$a.width)) }
      'input'          { [RemotePC.Json]::Ok($id, [RemotePC.Input]::Do([string]$a.k, [bool]$a.at, [int]$a.x, [int]$a.y, [string]$a.b, [int]$a.n, [string]$a.s, [int[]]$a.keys)) }
      'winbounds'      { [RemotePC.Json]::Ok($id, [RemotePC.Win]::Bounds([long]$a.hwnd)) }
      'winplace'       { [RemotePC.Json]::Ok($id, [RemotePC.Win]::Place([long]$a.hwnd, [int]$a.x, [int]$a.y, [int]$a.w, [int]$a.h)) }
      'getplacement'   { [RemotePC.Json]::Ok($id, [RemotePC.Win]::GetPlacement([long]$a.hwnd)) }
      'setplacement'   { [RemotePC.Json]::Ok($id, [RemotePC.Win]::SetPlacement([long]$a.hwnd, [int[]]$a.p)) }
      'status'         { [RemotePC.Json]::Ok($id, [RemotePC.Machine]::Status()) }
      'volume'         { [RemotePC.Json]::Ok($id, [RemotePC.Machine]::SetVolume([int]$a.level, [string]$a.mute)) }
      'media'          { [RemotePC.Json]::Ok($id, [RemotePC.Machine]::Media([string]$a.action)) }
      'power'          { [RemotePC.Json]::Ok($id, [RemotePC.Machine]::Power([string]$a.action)) }
      'wallpaper'      { [RemotePC.Json]::OkString($id, [RemotePC.Machine]::WallpaperPath()) }
      default          { [RemotePC.Json]::Err($id, 'unknown op: ' + $req.op) }
    }
  } catch {
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
    $out = [RemotePC.Json]::Err($id, $msg)
  }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
