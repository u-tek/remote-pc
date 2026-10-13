; Remote PC for Windows: the agent plus everything it works with, in one installer.
; Build it with installer\build.ps1 (CI does this in .github/workflows/installer.yml).
; This file must stay plain ASCII.

#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef Stage
  #define Stage "out\stage"
#endif
#ifndef OutDir
  #define OutDir "out"
#endif

#define PowerShell "{sys}\WindowsPowerShell\v1.0\powershell.exe"

[Setup]
AppId={{71826105-A844-4CB9-8163-F3FAFEB72F7C}
AppName=Remote PC
AppVersion={#AppVersion}
AppVerName=Remote PC {#AppVersion}
AppPublisher=Remote PC
AppPublisherURL=https://github.com/u-tek/remote-pc
AppSupportURL=https://github.com/u-tek/remote-pc
DefaultDirName={localappdata}\Programs\Remote PC
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutDir}
OutputBaseFilename=RemotePC-Setup
SetupIconFile=remotepc.ico
UninstallDisplayIcon={app}\remotepc.ico
UninstallDisplayName=Remote PC
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
CloseApplications=no
RestartApplications=no

[Messages]
WelcomeLabel2=Remote PC turns this PC's apps into iPhone apps and brings Claude Code and OpenCode to your phone.%n%nSetup installs the Remote PC agent and everything it works with: Tailscale, Claude Code, OpenCode, FFmpeg and the tools that put the app on your iPhone. A window walks you through signing in.
FinishedLabel=Remote PC is running. The "Connect your iPhone" page is open in your browser: follow its three steps on the phone.%n%nOpen it again any time from the Start menu: Remote PC.

[Types]
Name: "full"; Description: "Everything (recommended)"
Name: "custom"; Description: "Choose what to install"; Flags: iscustom

[Components]
Name: "agent"; Description: "Remote PC agent"; Types: full custom; Flags: fixed
Name: "tailscale"; Description: "Tailscale: reach your PC from anywhere"; Types: full
Name: "claude"; Description: "Claude Code (with Git for Windows)"; Types: full
Name: "opencode"; Description: "OpenCode"; Types: full
Name: "ffmpeg"; Description: "FFmpeg for the live screen (150 MB download)"; Types: full
Name: "iphone"; Description: "iPhone install tools: iloader and iTunes (put SideStore on the iPhone over USB)"; Types: full

[Tasks]
Name: "startup"; Description: "Start Remote PC when I sign in to Windows"
Name: "firewall"; Description: "Let the iPhone through Windows Firewall (asks for permission once)"
Name: "desktopicon"; Description: "Create a desktop icon"; Flags: unchecked

[InstallDelete]
; Start each version with a clean agent folder; bin\ (OpenCode) is kept.
Type: filesandordirs; Name: "{app}\agent"
Type: filesandordirs; Name: "{app}\node"

[Files]
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Remote PC"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Remote PC.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\remotepc.ico"; Comment: "Start Remote PC and connect your iPhone"
Name: "{userprograms}\Remote PC Setup"; Filename: "{#PowerShell}"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\remotepc.ico"; Comment: "Repair Remote PC or sign in again"
Name: "{userdesktop}\Remote PC"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Remote PC.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\remotepc.ico"; Tasks: desktopicon

[Run]
Filename: "{#PowerShell}"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup.ps1"" {code:SetupArgs}"; StatusMsg: "Setting up Remote PC. A window shows the progress and opens sign-ins when needed..."; Flags: waituntilterminated; Check: not WizardSilent
Filename: "{#PowerShell}"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup.ps1"" {code:SetupArgs}"; StatusMsg: "Setting up Remote PC..."; Flags: waituntilterminated runhidden; Check: WizardSilent

[UninstallRun]
Filename: "{#PowerShell}"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\setup.ps1"" -Uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemotePCCleanup"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\agent"
Type: filesandordirs; Name: "{app}\bin"
Type: files; Name: "{app}\setup.json"
Type: dirifempty; Name: "{app}"

[Code]
function SetupArgs(Param: String): String;
begin
  Result := '-Installer';
  if WizardIsComponentSelected('tailscale') then Result := Result + ' -Tailscale';
  if WizardIsComponentSelected('claude') then Result := Result + ' -Claude';
  if WizardIsComponentSelected('opencode') then Result := Result + ' -OpenCode';
  if WizardIsComponentSelected('ffmpeg') then Result := Result + ' -Ffmpeg';
  if WizardIsComponentSelected('iphone') then Result := Result + ' -IPhoneTools';
  if WizardIsTaskSelected('startup') then Result := Result + ' -Startup';
  if WizardIsTaskSelected('firewall') then Result := Result + ' -Firewall';
  if WizardSilent then Result := Result + ' -Unattended';
end;

{ Stop a running agent before its files are replaced. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Script: String;
  Code: Integer;
begin
  Result := '';
  Script := ExpandConstant('{app}\setup.ps1');
  if FileExists(Script) then
    Exec(ExpandConstant('{#PowerShell}'), '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -Stop', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent then
    if MsgBox('Also delete your Remote PC settings and pairing? Your iPhone would have to pair again after a reinstall.' + #13#10#13#10 +
              'Tailscale, Claude Code, Git, iTunes and iloader stay installed. Remove them from Settings > Apps if you no longer want them.',
              mbConfirmation, MB_YESNO) = IDYES then
      DelTree(ExpandConstant('{userappdata}\RemotePC'), True, True, True);
end;
