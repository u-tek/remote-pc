# Phone UI protocol, version 1

Remote PC shows Windows apps on the iPhone as **native iOS screens**. Most apps are rewritten
automatically from Windows UI Automation; a few have hand-tuned adapters. With this SDK, any program
on the PC (an app, a script, a service) can **describe its own phone UI** and get the same native
treatment: it sends views, the phone draws them with real iOS controls, and taps come back as
actions.

The phone never runs your code and never interprets what an action means. You send a `ref` with
every interactive element; when the user taps it, the phone sends that `ref` back (with a value for
inputs), and you decide what happens.

- Source of truth for the types: [`agent/src/ui/schema.ts`](../agent/src/ui/schema.ts)
- Clients: [Node](node), [Python](python), [C# / PowerShell](csharp) — each a single dependency-free file
- Examples: [examples](examples)

## Connecting

The agent accepts SDK connections on the PC itself only:

```
ws://127.0.0.1:<port>/api/sdk?token=<sdk token>
```

(or send the token as `Authorization: Bearer <sdk token>`). Connections from other machines are
refused. The SDK token is **not** the phone's pairing token; it only allows publishing apps.

The agent writes everything you need to `sdk.json` in its config folder whenever it starts:

| OS | Location |
| --- | --- |
| Windows | `%APPDATA%\RemotePC\sdk.json` |
| other | `~/.config/remote-pc/sdk.json` |
| any | `$REMOTE_PC_HOME/sdk.json` if `REMOTE_PC_HOME` is set |

```json
{ "url": "ws://127.0.0.1:8787/api/sdk", "token": "…", "protocol": 1 }
```

`REMOTE_PC_SDK_URL` and `REMOTE_PC_SDK_TOKEN` override the file.

## Messages

All messages are JSON text frames.

### Your app → agent

| Message | When |
| --- | --- |
| `{"type":"hello","protocol":1,"app":{"id":"builds","name":"Builds","icon":{…},"tint":"orange","description":"CI status"}}` | First message. `id`: letters, digits, `.`, `_`, `-` (max 64). Reconnecting with the same id replaces the old connection. |
| `{"type":"view","view":{"screens":[…],"sheet":{…},"alert":{…},"toast":"…"}}` | Whenever your UI changes. Always send the **whole** view; the agent fills in `v` and `app`. |
| `{"type":"toast","text":"Saved"}` | A short message at the bottom of the phone. |

### Agent → your app

| Message | Meaning |
| --- | --- |
| `{"type":"welcome","protocol":1}` | Connected. Send `hello`. |
| `{"type":"open","viewers":1}` | A phone opened your app. Send a `view` now if you haven't. |
| `{"type":"close"}` | No phone is showing your app any more (you can pause expensive work). |
| `{"type":"action","ref":"…","value":…}` | The user tapped / changed something. `value` depends on the element (see below). |
| `{"type":"pop","depth":1}` | The user went back; keep only the first `depth` screens. |
| `{"type":"dismiss"}` | The user closed your sheet or alert without choosing. |
| `{"type":"refresh"}` | Pull to refresh. |

## The view

```ts
interface AppView {
  screens: Screen[];   // navigation stack, root first; push/pop animate natively when it changes
  sheet?: Screen;      // a modal sheet over the stack
  alert?: Alert;       // { title, message?, actions: Action[] }
  toast?: string;
}
```

### Screen

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Stable while it is "the same place". A new id at the same depth replaces the screen. |
| `title` | string | Navigation bar title. |
| `subtitle` | string? | Small line under the title. |
| `style` | `form` · `list` · `grid` · `chat` · `article` · `document` · `browser` | How the phone lays it out. Default `form` (iOS Settings look). |
| `largeTitle` | bool? | iOS large title (good for root screens). |
| `sections` | Section[] | The content. |
| `actions` | Action[]? | Navigation bar buttons (max 2 shown). In sheets, `role:"cancel"` goes left and `role:"primary"` right. |
| `menu` | MenuItem[]? | The ⋯ menu. A menu item with an empty title and `children` is an inline group. |
| `bottomBar` | Action[]? | Bottom toolbar (icons). |
| `search` | `{ref, placeholder, value, submit?}` | Search field; `ref` gets the text while typing, `submit` on Search. |
| `segments` | `{items: Choice[], selected?, ref?}` | Segmented control under the title. |
| `composer` | `{ref, placeholder, value?, attach?}` | Message box pinned to the bottom (`chat` style); `ref` gets the text on send. |
| `address` | `{value, ref, secure?, title?}` | Browser address bar; `ref` gets what the user typed. |
| `document` | `{text, ref?, typeRef?, format?}` | Text for `document` screens. `ref` gets the whole edited text; `typeRef` gets typed text. |
| `more` | Action? | Sent when the user scrolls near the end of a list. |
| `refresh` | Action? | Sent on pull to refresh (otherwise you get a `refresh` message). |
| `back` | Action? | Informational: what "back" means in your app. |
| `empty` | `{title, message?, symbol?}` | Shown when there are no sections. |

### Section

`{ id, header?, footer?, style?: "grouped" | "plain" | "grid" | "cards", items: Item[] }`

### Items

Every item has an `id` (stable, used for animations) and a `kind`.

| kind | Fields | Action value sent |
| --- | --- | --- |
| `nav` | `title, subtitle?, value?, icon?, badge?, tap` | — (row with a chevron) |
| `toggle` | `title, subtitle?, icon?, on, ref, disabled?` | `true` / `false` |
| `choice` | `title, value?, options?: Choice[], selected?, ref, load?, style?: menu·inline·segmented` | the option `id` (or the option's own `ref` is sent alone) |
| `slider` | `title, min, max, step?, value, ref` | number |
| `stepper` | `title, value, min?, max?, step?, ref` | number |
| `field` | `title?, placeholder?, value, ref, secure?, multiline?, readOnly?, keyboard?, submit?` | the text (when editing ends) |
| `button` | `action, style?: row·prominent·bordered·link` | — |
| `check` | `title, subtitle?, on, ref, radio?` | `true` / `false` |
| `text` | `text, style?, label?, copyable?` | — (`style`: body, secondary, caption, footnote, headline, title, largeTitle, mono, display) |
| `heading` | `text, level: 1–6` | — |
| `paragraph` | `runs: [{text, link?: Action, bold?, italic?, code?}], bullet?, quote?` | — |
| `image` | `image, caption?, aspect?, tap?` | — |
| `progress` | `title?, value?: 0…1, label?` | — (no value = spinner) |
| `item` | `title, subtitle?, detail?, meta?, icon?, selected?, unread?, checked?, chevron?, tap?, menu?, swipe?, leadingSwipe?, level?, expanded?, expand?` | — (rows: files, mail, results) |
| `tile` | `title, subtitle?, icon?, image?, tap?, menu?` | — |
| `message` | `text, author?, time?, avatar?, outgoing?, images?, reactions?, system?` | — (chat bubbles) |
| `record` | `title, fields: [{label, value}], tap?, menu?` | — |
| `keypad` | `rows: [[{ref, title?, symbol?, span?, tone?: primary·secondary·accent} \| null]]` | — |
| `buttons` | `actions: Action[]` | — (a row of small buttons) |
| `profile` | `title, subtitle?, icon?, tap?` | — |
| `divider` | | — |

`live` items exist for Windows windows that can't be rebuilt; SDK apps don't need them.

### Shared types

```ts
interface Action { ref: string; title?: string; symbol?: string;          // SF Symbol name
                   role?: "destructive" | "cancel" | "primary"; disabled?: boolean;
                   confirm?: string;                                     // ask first
                   value?: string | number | boolean }                   // sent with the ref
interface MenuItem { title: string; symbol?: string; action?: Action; children?: MenuItem[];
                     checked?: boolean; role?: "destructive"; disabled?: boolean }
interface Choice { id: string; title: string; symbol?: string; ref?: string }
interface Icon { symbol?: string; image?: string; text?: string;          // initials
                 color?: string;                                         // blue, green, red, orange, yellow, pink, purple, indigo, teal, cyan, mint, brown, gray, #RRGGBB
                 style?: "tile" | "circle" | "plain" }
```

**Images** (`Icon.image`, `image`, `images`) can be `data:` URLs (best for SDK apps), `https://`
URLs the phone can reach, or agent paths.

### Things the phone does itself

Refs that start with `phone:` are handled on the phone and never sent back:

| Ref | Effect |
| --- | --- |
| `phone:copy?text=…` | Copy text to the iPhone clipboard. |
| `phone:open?url=…` | Open a URL on the iPhone. |
| `phone:share?url=…` | iOS share sheet for a URL. |
| `phone:download?path=…` | Download a PC file and offer it to save/share. |

## Good phone UI

- One idea per screen; push a new screen (`screens: [root, detail]`) instead of cramming.
- Use `form` for settings, `list` for collections, `chat` for conversations, `article` for reading.
- Give everything a stable `id` and `ref` so updates animate instead of flashing.
- Send a new view right after handling an action — the phone shows changes optimistically and
  your view confirms them.
