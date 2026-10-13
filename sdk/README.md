# Remote PC SDK

Put any program on the iPhone as a **native app**. Your code describes screens with lists,
toggles, pickers, fields, buttons, chat bubbles and more; the phone draws them with real iOS
controls and sends taps back to your code. It runs on the PC next to the Remote PC agent, finds it
automatically, and appears on the phone's Home tab under **Made for iPhone**.

Each client is a single file with no dependencies.

| Language | File | Needs |
| --- | --- | --- |
| Node.js | [`node/index.js`](node/index.js) (+ `index.d.ts`) | Node 22+ |
| Python | [`python/remote_pc.py`](python/remote_pc.py) | Python 3.8+ |
| C# / PowerShell | [`csharp/RemotePhone.cs`](csharp/RemotePhone.cs) | .NET, .NET Framework 4.5+, Mono, or Windows PowerShell 5.1 |

## Node

```js
import { PhoneApp, ui } from './sdk/node/index.js';

let lamp = false;
const app = new PhoneApp({ id: 'lights', name: 'Lights', icon: ui.icon('lightbulb.fill', 'yellow') }, () =>
  ui.screen('Lights', [ui.toggle('Desk lamp', lamp, (on) => (lamp = on))], { largeTitle: true }),
);
await app.connect();
```

## Python

```python
from remote_pc import PhoneApp, ui

state = {"lamp": False}
PhoneApp("lights", "Lights",
         lambda app: ui.screen("Lights", [ui.toggle("Desk lamp", state["lamp"], lambda on: state.update(lamp=on))]),
         icon=ui.icon("lightbulb.fill", "yellow")).run()
```

## C#

```csharp
var lamp = false;
new PhoneApp("lights", "Lights", a => Ui.Screen("Lights", Ui.Toggle("Desk lamp", lamp, on => lamp = on)),
             icon: Ui.Icon("lightbulb.fill", "yellow")).Run();
```

## PowerShell

```powershell
Add-Type -Path .\sdk\csharp\RemotePhone.cs -ReferencedAssemblies System.Core
$app = New-Object RemotePC.Sdk.PhoneApp('hello', 'Hello', [Func[RemotePC.Sdk.PhoneApp, RemotePC.Sdk.Node]] {
  param($a) [RemotePC.Sdk.Ui]::Screen('Hello', @([RemotePC.Sdk.Ui]::Text("It's $(Get-Date -Format t) on $env:COMPUTERNAME", $null, $null, $null)))
}, $null, $null, $null)
$app.Run()
```

## How it works

- Render functions return a screen. After every action the SDK renders again and sends the new
  view, so your UI is just a function of your state. Call `update()` after changes you make
  yourself (timers, background work).
- `push(render)` opens a detail screen with a native push; the phone's Back pops it. `sheet()`,
  `alert()` and `toast()` do what they say.
- Callbacks become stable action refs derived from each element's id (or title), so pass `id`
  when two elements share a title.
- The SDK reconnects by itself if the agent restarts.

Examples: [`examples/builds.mjs`](examples/builds.mjs) (CI dashboard with detail screens and swipe
actions), [`examples/pc_monitor.py`](examples/pc_monitor.py) (disk space and a note),
[`examples/csharp/HelloPhone.cs`](examples/csharp/HelloPhone.cs), and
[`examples/Counter.ps1`](examples/Counter.ps1).

Everything the phone can draw is in [PROTOCOL.md](PROTOCOL.md) — you can also speak the protocol
directly over a WebSocket from any language.
