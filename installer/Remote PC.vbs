' Remote PC: starts the agent in the background if it isn't running and opens the
' "Connect your iPhone" page. The Start menu shortcut runs this.
Set fso = CreateObject("Scripting.FileSystemObject")
app = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = app & "\agent"
sh.Run """" & app & "\node\node.exe"" """ & app & "\agent\dist\index.js"" welcome --start", 0, False
