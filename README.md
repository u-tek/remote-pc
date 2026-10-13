# Remote PC

An iPhone app plus a small Windows companion ("the agent") that turns your PC into a phone:
**every Windows app opens on the iPhone as a native iOS app** — real iOS lists, switches, pickers,
navigation, sheets and keyboards — not a shrunken desktop.

- **Windows apps, rewritten for iPhone** — the Home tab shows your open PC apps as icons. Tap one
  and it opens like an iPhone app: Settings becomes iOS-Settings-style grouped lists with toggles and
  sliders, File Explorer a Files-style list with a folder sidebar, Calculator keeps its keypad,
  dialogs become sheets and message boxes become iOS alerts, menus become native menus. The window
  stays where it is on the PC and both stay in sync.
  - It works with **any app**: a rules engine reads the app through Windows UI Automation (what
    screen readers use) and rewrites it — finding the sidebar, toolbars, search, tabs, settings
    rows, forms, lists, tables, documents, web content, keypads and dialogs.
  - **Hand-tuned** for the apps you use most: **Chrome / Edge / Firefox** (pages as readable
    articles with an address bar and a tab switcher), **Discord / Slack / Teams / WhatsApp** (chat
    bubbles and a message box), **File Explorer** (save any file to your iPhone), **Settings**, and
    **Word / Excel / PowerPoint / Outlook**.
  - **Search to start** any installed app; it opens straight into its phone version.
  - When something truly can't be rebuilt (a game, a video, a canvas), just that part shows live
    and responds to touch — you never have to think about it.
- **An SDK for your own tools** — any program or script on the PC can publish its own native
  phone UI in a few lines of [Node](sdk/node), [Python](sdk/python), [C# or PowerShell](sdk/csharp).
  See [sdk/](sdk).
- **Claude Code & OpenCode** — start sessions in any project folder, chat with them, attach photos, stop them, switch Claude's permission mode, and pick up sessions you started at your desk (Claude Code sessions from the terminal show up too).
- **Approvals on your phone** — when an agent wants to edit files or run a command, you get a card with **Allow / Always / Deny** (or "deny and explain"). Claude's plan reviews and multiple-choice questions come through as well.
- **Tools** — Control Center (volume, media, lock, sleep, restart), Task Manager, clipboard sync, a Start menu, and **Files** (browse every drive, preview, share, upload).
- **Web** — open web UIs running on the PC (dev servers, ComfyUI, Jupyter, Home Assistant…) even if they only listen on `localhost`.
- **The whole screen, if you want it** — the *Screen* tool streams your real desktop with low latency (hardware H.264), touch or trackpad control and the iPhone keyboard.
- **Security** — QR-code pairing with a random 256-bit token, Face ID app lock, and the agent listens only on your private Tailscale network by default.

```
iPhone app (SwiftUI)                                     agent (Node.js, runs on your PC)
  native screens ◀──── Phone UI views (JSON) ─────────  ├─ UI Automation helper (C#) → window trees, actions
  taps, text ──────────── actions ────────────────────▶  ├─ rules engine + adapters → native views
                                                         ├─ SDK endpoint ◀── your scripts and apps
  live parts ◀────────── pictures / H.264 ────────────  ├─ FFmpeg: Desktop Duplication → NVENC/AMF/QSV/x264
                                                         ├─ Claude Code (Agent SDK), OpenCode
                                                         └─ files, clipboard, processes, web forwarding
          all over HTTP + WebSocket on your Tailscale network
```

## 1. Set up the PC

Download **[RemotePC-Setup.exe](https://github.com/u-tek/remote-pc/raw/main/builds/RemotePC-Setup.exe)**
and run it. No administrator account is needed; Windows asks once for the firewall rule. It sets up:

| Part | What it does |
| --- | --- |
| Remote PC agent | Runs in the background with its own Node.js; starts when you sign in |
| Tailscale | Lets the phone reach the PC from anywhere; opens the Tailscale sign-in |
| Claude Code (+ Git for Windows) | Installed with Anthropic's official installer; opens the Claude sign-in |
| OpenCode | Downloaded into the app folder; opens `opencode auth login` to pick a provider |
| FFmpeg | Downloaded now so the live screen starts instantly |
| iloader + iTunes | Put SideStore on the iPhone over USB (iTunes provides Apple's USB driver) |
| Windows Firewall | Lets the phone in from Tailscale and your home network only |

Every part except the agent can be unticked. A setup window shows progress and opens each sign-in
when it's needed (press **S** there to skip one). At the end the **Connect your iPhone** page opens
in your browser with three QR codes: Tailscale for the iPhone, the Remote PC app, and pairing.

- **Start menu → Remote PC** starts the agent if it isn't running and reopens that page.
- **Start menu → Remote PC Setup** repairs the install or signs you in again. Steps already done are skipped.
- **Uninstall** from Settings → Apps. It asks whether to keep your settings and pairing. Tailscale,
  Claude Code, Git, iTunes and iloader stay installed; they are separate apps.
- Updating: run a newer `RemotePC-Setup.exe` over the old one. Every build on `main` is committed
  to [`builds/`](builds), and each one was installed, used and uninstalled on a fresh Windows
  machine by CI first.

<details>
<summary>Set up by hand instead</summary>

1. **Tailscale**: install [Tailscale](https://tailscale.com/download) on the PC and on your iPhone and sign in with the same account. This is what lets the phone reach the PC from anywhere, without opening ports to the internet.
2. **Node.js 20 or newer**: install the LTS version from [nodejs.org](https://nodejs.org).
3. **Agents you want to use**:
   - Claude Code: sign in once by running `claude` in a terminal (or set `ANTHROPIC_API_KEY`). The agent drives Claude Code through Anthropic's Agent SDK and uses the same login.
   - OpenCode (optional): `npm install -g opencode-ai`, then `opencode auth login`. The agent starts `opencode serve` for you.
4. **Start the agent**: get this repository onto the PC (clone it or download the ZIP), then double-click `agent\start.cmd`. Or from a terminal:

   ```powershell
   cd agent
   npm install
   npm run build
   npm start
   ```

   If Windows Firewall asks, allow Node.js on **private** networks.
5. `node dist\index.js welcome` opens the **Connect your iPhone** page (`npm run pair` prints the pairing QR code in the terminal instead).
6. **Start with Windows** (recommended): `node dist\index.js install-startup` starts the agent hidden when you sign in. Logs go to `%APPDATA%\RemotePC\agent.log`. The agent has to run in your own desktop session, not as a service, so it can see your windows and clipboard.

</details>

## 2. Install the app on the iPhone

The **Connect your iPhone** page walks through this. In short:

1. **No SideStore yet?** Plug the iPhone into the PC, open **iloader** (the installer adds it) and
   choose *LiveContainer + SideStore* (or just SideStore). Then on the iPhone: Settings → General → VPN & Device Management →
   trust your Apple ID, and turn on Developer Mode if asked.
2. **Install Remote PC**: scan the page's QR code with the iPhone camera and open it in SideStore
   (or AltStore, or download it for LiveContainer). It installs the latest build straight from `main`.
3. **Pair**: open Remote PC → **Pair with my PC** → scan the pairing code (the iPhone Camera works too).

The IPA is built by GitHub Actions on every push that touches `ios/`, and every build on `main` is
committed as [`builds/RemotePC.ipa`](builds/RemotePC.ipa). Builds from other branches are under
**Actions** → **iOS app** → the **RemotePC-ipa** artifact, and a tag like `v0.1.0` attaches the IPA
and the installer to a GitHub **Release**.

Free Apple IDs sign apps for 7 days; SideStore refreshes them on the phone itself. (A paid Apple
Developer account would remove the 7-day limit and allow real push notifications.)

**Out of App IDs?** A free Apple ID can create 10 App IDs per rolling 7 days (and keep 3 sideloaded
apps active). Remote PC needs one, and updates and refreshes reuse it. If you have none left:

- **LiveContainer** (recommended): install the IPA inside [LiveContainer](https://github.com/LiveContainer/LiveContainer),
  which runs apps without App IDs of their own. iloader can install *LiveContainer + SideStore*
  together. Pair by scanning inside the app; the Camera app can't open apps inside LiveContainer.
- Wait for one to expire: SideStore/AltStore → Settings → *App IDs* shows when each frees up.
- Sign in to SideStore with a second (free) Apple ID, which has its own 10.

## Using it

### PC apps on your phone

- **Home tab**: every open window is an app icon. Tap to open it natively; long-press for *Bring to
  Front on PC*, *Live View* or *Close on PC*. Type in **Search apps** to start anything installed.
- Apps open on their own home screen when they have a sidebar (Settings categories, Explorer
  folders, chat channels) and push into pages like any iPhone app; Back goes back in the app.
- Pickers whose choices only appear when opened on Windows (most dropdowns) load their choices the
  first time you tap them; after that they are instant.
- File Explorer: long-press a file → **Save to iPhone** / **Share**.
- Changes go to the real app through UI Automation, so the PC doesn't need to be in front of you,
  and you can keep using it at the desk at the same time. Typing into chat apps and browser address
  bars briefly brings that window to the front on the PC.
- Chrome/Electron apps (Discord, Slack, Teams, VS Code…) expose their full UI only while a screen
  reader is "running"; the agent turns Windows' screen-reader flag on while the phone shows an app
  (`ui.screenReaderFlag` in the config).
- Apps running as administrator can't be read or controlled by a normal-user agent, and Windows
  doesn't let any app see the lock screen. Keep the PC unlocked.

### Live screen

- **Home → Tools → Screen** streams your desktop; long-press an app → *Live View* streams one window.
- The first time, the agent downloads FFmpeg (~150 MB, once) into `%APPDATA%\RemotePC\ffmpeg`, then picks the fastest encoder that works: NVIDIA NVENC, AMD AMF, Intel Quick Sync, Media Foundation, or x264. Quality adapts automatically; pick it in the ⋯ menu.
- Tap to click, hold to right-click, drag, two-finger scroll, pinch to zoom, or switch to trackpad mode. The keyboard button types on the PC.

### Agents

- **Agents tab**: `+` starts a session (pick Claude Code or OpenCode, a project folder, and the first message). Pinned and recent folders are suggested; *Browse folders on the PC* lets you pick any folder.
- Pending approvals show at the bottom of the chat, in the **Waiting for you** inbox, and as an in-app banner (with sound and haptics) wherever you are in the app.
- Claude's permission modes (⋯ menu in a chat): *Ask before changes* (default), *Auto-accept edits*, *Plan first*.
- Alerts are **in-app only**: a free sideload can't receive Apple push notifications. iOS keeps the connection alive briefly after you switch away, and alerts that arrive in that window still show as notifications if you turn that on in Settings.

## Agent configuration

`%APPDATA%\RemotePC\config.json` (created on first run; restart the agent after editing):

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | PC hostname | Name shown on the phone |
| `port` | `8787` | Agent port |
| `bind` | `"auto"` | `auto` = Tailscale address if present, else all interfaces; also `tailscale`, `all`, `localhost`, or an IP |
| `token` | random | Pairing secret. `npm run pair -- --new-token` makes a new one and unpairs every phone |
| `claude.defaultPermissionMode` | `"default"` | `default`, `acceptEdits` or `plan` |
| `claude.idleCloseMinutes` | `120` | Close idle Claude processes (sessions can be resumed) |
| `claude.executable` | – | Use a specific `claude.exe` (otherwise the SDK's bundled one, or the installed Claude Code) |
| `opencode.enabled` | `true` | Start OpenCode's server |
| `opencode.askPermissions` | `true` | Make OpenCode ask before edits / shell commands so approvals reach the phone |
| `opencode.url` | – | Use an OpenCode server you already run |
| `stream.quality` | `"balanced"` | Default live-desktop quality: `high`, `balanced`, `low`, `saver` |
| `stream.ffmpeg` | – | Path to your own `ffmpeg.exe` (otherwise PATH or a copy downloaded on first use) |
| `ui.screenReaderFlag` | `true` | Tell apps a screen reader is running while the phone shows them (needed for Chrome/Electron apps) |
| `ui.pollMs` | `1000` | How often an open app is re-read when nothing is happening |
| `ui.sdkToken` | random | Token SDK apps use (`sdk.json` next to the config holds it for them) |
| `projects` | `[]` | Pinned project folders |
| `web` | `[]` | Saved web apps (managed from the app) |

Other commands: `node dist\index.js welcome` (the Connect your iPhone page), `npm run pair` (the pairing QR in the terminal), `node dist\index.js ffmpeg`, `node dist\index.js uninstall-startup`, `node dist\index.js config`. In an installed copy, run them with `"%LOCALAPPDATA%\Programs\Remote PC\node\node.exe" "%LOCALAPPDATA%\Programs\Remote PC\agent\dist\index.js" <command>`.

## Security notes

- Every request needs the pairing token. After 10 failed attempts an address is blocked for 5 minutes.
- By default the agent only listens on its Tailscale address (plus `localhost`), so only devices on your tailnet can reach it. Traffic is encrypted by Tailscale (WireGuard).
- The paired phone can do anything your Windows account can: read and write files, run agents, end processes. Treat the token like a password; rotate it with `npm run pair -- --new-token` if the phone is lost.
- The live desktop uses the same token-protected connection; nothing streams unless the app is open on your phone.
- Apps on the phone are read with UI Automation only while you have them open. SDK apps can only connect from the PC itself (`127.0.0.1`) with the separate SDK token, and can only publish their own UI.
- Saved web apps are forwarded to your tailnet **without** the token, because the browser connects to them directly. Only save apps you are happy for your own devices to reach.

## More feature ideas (not built yet)

- AI-assisted rewrites for apps the rules don't understand well, cached per app.
- Live Activity / Dynamic Island progress and real push notifications (needs a paid Apple Developer account).
- Siri Shortcuts ("Hey Siri, tell Claude to run the tests") and home-screen widgets.
- Share-sheet extension: "Send to PC" from any app.
- Wake-on-LAN, so a sleeping PC can be woken from the phone.
- PC audio streamed to the phone, and a phone-shaped virtual monitor (needs a virtual display driver).
- Controlling the lock screen and admin prompts (needs the agent to run as a Windows service).
- A PowerShell/WSL terminal, a Git panel with diffs, and commit/push.
- More agents through the same chat: Codex CLI, Gemini CLI, Aider, and local models via Ollama.

## Development

```
agent/   Node.js + TypeScript agent         npm test · npm run typecheck · npm run dev
  src/ui/schema.ts                           Phone UI protocol (source of truth)
  src/ui/rules/                              rules engine: UI Automation tree → native views
  src/ui/adapters/                           hand-tuned apps (browser, chat, explorer, settings, office)
  src/ui/session.ts, routes.ts, sdk.ts       app sessions, /api/ui, /api/sdk
  assets/ui.cs, ui.ps1                       UI Automation helper (compiled by PowerShell)
  assets/helper.ps1, helper.cs               Windows helper for everything else
  test/fixtures/uia/                         realistic window trees used by the rules tests
ios/     SwiftUI app (iOS 17+)               brew install xcodegen && cd ios && xcodegen generate
  RemotePC/Models/PhoneUI.swift              protocol models
  RemotePC/Views/Apps/                       native renderer and home screen
sdk/     Phone UI SDK                        PROTOCOL.md, node/, python/, csharp/, examples/
installer/ Windows installer (Inno Setup)     build.ps1 builds it, test.ps1 installs/uninstalls it
  setup.ps1                                  installs and signs in to everything; Start menu "Remote PC Setup"
.github/workflows/                           agent tests on Linux + Windows, IPA build on macOS, installer build + test
builds/                                      latest RemotePC.ipa and RemotePC-Setup.exe from main (committed by CI)
```
