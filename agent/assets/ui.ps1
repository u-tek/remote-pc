# UI Automation helper for the Remote PC agent (separate from helper.ps1 so a slow app never
# blocks clipboard, files or streaming). Same JSON-lines protocol: one request per line on stdin,
# one response per line on stdout.
param(
  [string]$Helper = (Join-Path $PSScriptRoot 'helper.cs'),
  [string]$Source = (Join-Path $PSScriptRoot 'ui.cs')
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8

Add-Type -Path @($Helper, $Source) -ReferencedAssemblies @(
  'System.Drawing', 'System.Windows.Forms', 'System.Web.Extensions', 'Microsoft.VisualBasic',
  'UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'
)
[RemotePC.Win]::Init()
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

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
      'ping'       { [RemotePC.Json]::OkString($id, 'pong') }
      'snap'       { [RemotePC.Ui]::Raw($id, [RemotePC.Ui]::Snapshot([long]$a.hwnd)) }
      'act'        { [RemotePC.Json]::OkString($id, [RemotePC.Ui]::Act([long]$a.hwnd, [string]$a.id, [string]$a.op, [string]$a.value)) }
      'winkeys'    { [RemotePC.Json]::OkString($id, [RemotePC.Ui]::WindowKeys([long]$a.hwnd, [string]$a.value)) }
      'wheel'      { [RemotePC.Json]::OkString($id, [RemotePC.Ui]::Wheel([long]$a.hwnd, [int]$a.x, [int]$a.y, [int]$a.dy)) }
      'wintext'    { [RemotePC.Json]::OkString($id, [RemotePC.Ui]::WindowText([long]$a.hwnd, [string]$a.text)) }
      'tap'        { [RemotePC.Json]::OkString($id, [RemotePC.Ui]::Tap([long]$a.hwnd, [int]$a.x, [int]$a.y, [string]$a.button, [int]$a.count)) }
      'crop'       { [RemotePC.Json]::OkString($id, [RemotePC.Ui]::Crop([long]$a.hwnd, [int]$a.x, [int]$a.y, [int]$a.w, [int]$a.h, [int]$a.width, [string]$a.format)) }
      'invalidate' { [RemotePC.Json]::Ok($id, [RemotePC.Ui]::Invalidate([long]$a.hwnd)) }
      'reader'     { [RemotePC.Json]::Ok($id, [RemotePC.Ui]::ScreenReaderFlag([bool]$a.on)) }
      default      { [RemotePC.Json]::Err($id, 'unknown op: ' + $req.op) }
    }
  } catch {
    $msg = $_.Exception.Message
    if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
    $out = [RemotePC.Json]::Err($id, $msg)
  }
  [Console]::Out.WriteLine($out)
  [Console]::Out.Flush()
}
