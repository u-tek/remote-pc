# A PowerShell script with a native iPhone UI. Run in Windows PowerShell or PowerShell 7:
#   powershell -ExecutionPolicy Bypass -File examples\Counter.ps1
Add-Type -Path (Join-Path $PSScriptRoot '..\csharp\RemotePhone.cs') -ReferencedAssemblies System.Core

$script:count = 0
$render = [Func[RemotePC.Sdk.PhoneApp, RemotePC.Sdk.Node]] {
  param($app)
  [RemotePC.Sdk.Ui]::Screen('Counter', @(
    [RemotePC.Sdk.Ui]::Text("$script:count", 'display', $null, $null),
    [RemotePC.Sdk.Ui]::Button('Add one', [Action] { $script:count++ }, 'prominent', $null, 'plus', $null, $null),
    [RemotePC.Sdk.Ui]::Button('Lock this PC', [Action] { rundll32.exe user32.dll,LockWorkStation }, $null, 'destructive', 'lock.fill', 'Lock the PC now?', $null)
  ))
}
$app = New-Object RemotePC.Sdk.PhoneApp('ps-counter', 'Counter', $render, ([RemotePC.Sdk.Ui]::Icon('number', 'indigo', 'tile')), $null, 'A PowerShell script')
Write-Host 'Counter is on your phone. Ctrl+C to stop.'
$app.Run()
