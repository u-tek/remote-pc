# Remote PC

An iPhone app plus a small Windows companion ("the agent") that puts your PC in your pocket:

- **Your actual desktop, live** — open the PC tab and you're looking at your real screen (with your wallpaper behind it). Tap *Take control* for a full-screen, low-latency stream you drive with your fingers: tap to click, hold to right-click, drag, two-finger scroll with momentum, pinch to zoom, or switch to **trackpad mode**. The iPhone keyboard types on the PC, with a key bar for Ctrl/Alt/Win, arrows, F-keys and shortcuts like Alt+Tab and Task Manager.
- **Any PC app as a phone app** — tap the 📱 button on an open window (or *Open on phone* in Start) and that window is reshaped to your phone's proportions and streamed full screen, so a browser goes into its mobile layout and apps fill your screen. When you close it, the window goes back exactly where it was.
- **Control Center for your PC** — volume, mute, play/pause/skip, lock, screen off, sleep, restart and shut down.
- **Claude Code & OpenCode** — start sessions in any project folder, chat with them, attach photos, stop them, switch Claude's permission mode, and pick up sessions you started at your desk (Claude Code sessions from the terminal show up too).
- **Approvals on your phone** — when an agent wants to edit files or run a command, you get a card with **Allow / Always / Deny** (or "deny and explain"). Claude's plan reviews and multiple-choice questions come through as well.
- **"Mobile Windows"** — phone-native screens for your PC:
  - **Start** — searchable app grid with real icons, pins and recents; tap to launch on the PC.
  - **Windows** — live thumbnails of open windows; tap to bring one to the front, or minimize / maximize / close.
  - **Tasks** — Task Manager with CPU and memory meters, grouped processes and *End task*.
  - **Clipboard** — pull the PC clipboard (text or image) to the phone, push text or photos to it.
- **Files** — browse every drive, preview and share files, upload photos/videos/files, rename, make folders, delete to the Recycle Bin, or open a file on the PC.
- **Web** — open web UIs running on the PC (dev servers, ComfyUI, Jupyter, Home Assistant…) in an in-app browser, even if they only listen on `localhost`. Ports in use are detected so you can add them with one tap.
- **Security** — QR-code pairing with a random 256-bit token, Face ID app lock, and the agent listens only on your private Tailscale network by default.

```
iPhone app (SwiftUI)  ──HTTP + WebSocket over Tailscale──▶  agent (Node.js, runs on your PC)
  hardware H.264 decode ◀── live video (FLV → H.264) ──────  ├─ FFmpeg: Desktop Duplication → NVENC/AMF/QSV/x264
  touches, keys ─────────── input ─────────────────────────▶  ├─ SendInput (mouse, keyboard, scroll, text)
                                                              ├─ Claude Code (Agent SDK)
                                                              ├─ OpenCode (opencode serve)
                                                              ├─ PowerShell/C# helper → apps, windows, tasks, clipboard
                                                              ├─ file system
                                                              └─ port forwarder → localhost web UIs
```

## 1. Set up the PC

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
5. The agent prints a **QR code** (and saves it as `pairing.png` in `%APPDATA%\RemotePC`). Keep it handy for the phone.
6. **Start with Windows** (recommended): `node dist\index.js install-startup` starts the agent hidden when you sign in. Logs go to `%APPDATA%\RemotePC\agent.log`. The agent has to run in your own desktop session, not as a service, so it can see your windows and clipboard.

## 2. Install the app on the iPhone

The IPA is built by GitHub Actions on every push that touches `ios/`:

- **Actions** tab → **iOS app** → latest successful run → download the **RemotePC-ipa** artifact (a zip containing `RemotePC.ipa`), or
- push a tag like `v0.1.0` and the IPA is attached to a GitHub **Release**.

Install it with [SideStore](https://sidestore.io) or [AltStore](https://altstore.io) using your free Apple ID. Free signing expires every 7 days; SideStore can refresh on the phone itself, AltStore refreshes from AltServer on your PC. (A paid Apple Developer account would remove the 7-day limit and allow real push notifications.)

Then open **Remote PC** → **Pair with my PC** → scan the QR code. You can also scan the code with the iPhone Camera app, which opens the app and pairs automatically.

## Using it

### Live desktop

- **PC tab → Desktop** shows a live preview of your screen; tap **Take control**. Turn the phone sideways for the full desktop.
- The first time you open it, the agent downloads FFmpeg (~150 MB, once) into `%APPDATA%\RemotePC\ffmpeg`. It then picks the fastest encoder that works on your PC: NVIDIA NVENC, AMD AMF, Intel Quick Sync, Media Foundation, or x264 on the CPU. If you already have FFmpeg, set `stream.ffmpeg` in the config.
- Quality adapts automatically when the connection struggles; you can also pick it in the ⋯ menu (Sharp 1080p60 → Cellular saver). On the same Wi-Fi or a direct Tailscale connection it feels close to sitting at the PC.
- **App mode**: the 📱 button on a window (PC → Windows, or the *Open on your phone* list on the Desktop page) streams just that window, resized to phone shape. Long-press a Start menu app → *Open on phone* to launch it straight into app mode.
- Limits: Windows doesn't let normal apps see or control the **lock screen** or admin (UAC) prompts. Keep the PC unlocked while you want to use it remotely (Control Center's *Screen off* turns the monitor off without locking). Apps running as administrator also ignore input from non-admin programs.

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
| `claude.executable` | – | Use a specific `claude.exe` instead of the SDK's bundled one |
| `opencode.enabled` | `true` | Start OpenCode's server |
| `opencode.askPermissions` | `true` | Make OpenCode ask before edits / shell commands so approvals reach the phone |
| `opencode.url` | – | Use an OpenCode server you already run |
| `stream.quality` | `"balanced"` | Default live-desktop quality: `high`, `balanced`, `low`, `saver` |
| `stream.ffmpeg` | – | Path to your own `ffmpeg.exe` (otherwise PATH or a copy downloaded on first use) |
| `projects` | `[]` | Pinned project folders |
| `web` | `[]` | Saved web apps (managed from the app) |

Other commands: `npm run pair` (show the QR again), `node dist\index.js uninstall-startup`, `node dist\index.js config`.

## Security notes

- Every request needs the pairing token. After 10 failed attempts an address is blocked for 5 minutes.
- By default the agent only listens on its Tailscale address (plus `localhost`), so only devices on your tailnet can reach it. Traffic is encrypted by Tailscale (WireGuard).
- The paired phone can do anything your Windows account can: read and write files, run agents, end processes. Treat the token like a password; rotate it with `npm run pair -- --new-token` if the phone is lost.
- The live desktop uses the same token-protected connection; nothing streams unless the app is open on your phone.
- Saved web apps are forwarded to your tailnet **without** the token, because the browser connects to them directly. Only save apps you are happy for your own devices to reach.

## More feature ideas (not built yet)

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
agent/   Node.js + TypeScript agent        npm test · npm run typecheck · npm run dev
  assets/helper.ps1, helper.cs              Windows helper (compiled by PowerShell at startup)
  scripts/smoke-windows.mjs                 exercises the real helper (runs in CI on Windows)
ios/     SwiftUI app (iOS 17+)              brew install xcodegen && cd ios && xcodegen generate
.github/workflows/                          agent tests on Linux + Windows, unsigned IPA build on macOS
```
