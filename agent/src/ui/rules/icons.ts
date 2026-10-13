import type { Icon } from '../schema.js';

type Rule = [RegExp, string, string?];

/**
 * Words in a control's name or automation id → SF Symbol (and a tile color for navigation rows).
 * Order matters: more specific phrases first.
 */
const RULES: Rule[] = [
  [/\b(go )?back\b|\bnavigate back\b/, 'chevron.backward'],
  [/\b(go )?forward\b(?! (mail|message|email))/, 'chevron.forward'],
  [/\b(refresh|reload)\b/, 'arrow.clockwise', 'blue'],
  [/\bnew (message|mail|email|chat|conversation|post)\b|\bcompose\b/, 'square.and.pencil', 'blue'],
  [/\bnew tab\b/, 'plus.square.on.square'],
  [/\bnew folder\b/, 'folder.badge.plus', 'blue'],
  [/\b(new|add|create|plus)\b/, 'plus'],
  [/\breply all\b/, 'arrowshape.turn.up.left.2'],
  [/\breply\b/, 'arrowshape.turn.up.left'],
  [/\bforward (mail|message|email)\b/, 'arrowshape.turn.up.right'],
  [/\b(delete|remove|trash|recycle bin|discard)\b/, 'trash', 'red'],
  [/\b(rename|edit)\b/, 'pencil'],
  [/\bshare\b/, 'square.and.arrow.up', 'blue'],
  [/\bsave as\b/, 'square.and.arrow.down.on.square'],
  [/\bsave\b/, 'square.and.arrow.down'],
  [/\bcopy link\b|\blink\b/, 'link'],
  [/\bcopy\b/, 'doc.on.doc'],
  [/\bcut\b/, 'scissors'],
  [/\bpaste\b/, 'doc.on.clipboard'],
  [/\bundo\b/, 'arrow.uturn.backward'],
  [/\bredo\b/, 'arrow.uturn.forward'],
  [/\bbold\b/, 'bold'],
  [/\bitalic\b/, 'italic'],
  [/\bunderline\b/, 'underline'],
  [/\bstrikethrough\b/, 'strikethrough'],
  [/\bprint(er)?\b/, 'printer'],
  [/\bsend\b/, 'paperplane.fill', 'blue'],
  [/\b(attach|attachment|upload a file)\b/, 'paperclip'],
  [/\bemoji\b/, 'face.smiling'],
  [/\b(unmute|mute|microphone|mic)\b/, 'mic'],
  [/\b(call|phone|dial)\b/, 'phone.fill', 'green'],
  [/\b(video|camera|webcam)\b/, 'video.fill', 'green'],
  [/\b(play|resume)\b/, 'play.fill'],
  [/\bpause\b/, 'pause.fill'],
  [/\b(next|skip)\b/, 'forward.fill'],
  [/\bprevious\b/, 'backward.fill'],
  [/\bstop\b/, 'stop.fill'],
  [/\bshuffle\b/, 'shuffle'],
  [/\brepeat\b/, 'repeat'],
  [/\b(volume|sound|speaker|audio)\b/, 'speaker.wave.2.fill', 'pink'],
  [/\bdownloads?\b/, 'arrow.down.circle', 'blue'],
  [/\bupload\b/, 'arrow.up.circle'],
  [/\bfilter\b/, 'line.3.horizontal.decrease.circle'],
  [/\bsort\b/, 'arrow.up.arrow.down'],
  [/\b(zoom in)\b/, 'plus.magnifyingglass'],
  [/\b(zoom out)\b/, 'minus.magnifyingglass'],
  [/\b(full ?screen|maximi[sz]e)\b/, 'arrow.up.left.and.arrow.down.right'],
  [/\b(search|find)\b/, 'magnifyingglass'],
  [/\b(favou?rites?|star)\b/, 'star.fill', 'yellow'],
  [/\bbookmarks?\b/, 'bookmark.fill', 'blue'],
  [/\bhistory\b/, 'clock.arrow.circlepath', 'blue'],
  [/\bextensions?\b|\badd-?ins?\b|\bplugins?\b/, 'puzzlepiece.extension.fill', 'gray'],
  [/\btabs\b/, 'square.on.square'],
  [/\bsidebar\b/, 'sidebar.left'],
  [/\b(terminal|console|command prompt|powershell)\b/, 'terminal.fill', 'gray'],
  [/\b(source control|git|branch)\b/, 'arrow.triangle.branch', 'orange'],
  [/\b(code|developer)\b/, 'chevron.left.forwardslash.chevron.right', 'gray'],
  [/\b(debug|run)\b/, 'play.circle'],
  [/\bbluetooth\b/, 'dot.radiowaves.left.and.right', 'blue'],
  [/\b(wi-?fi|network|internet|ethernet|vpn)\b/, 'wifi', 'blue'],
  [/\b(battery|power|sleep)\b/, 'bolt.fill', 'green'],
  [/\b(display|screen|monitor|brightness)\b/, 'display', 'blue'],
  [/\bkeyboard\b/, 'keyboard', 'gray'],
  [/\b(mouse|touchpad|pointer)\b/, 'computermouse.fill', 'gray'],
  [/\b(windows )?update\b/, 'arrow.triangle.2.circlepath', 'cyan'],
  [/\b(privacy|permissions)\b/, 'hand.raised.fill', 'blue'],
  [/\bsecurity\b|\bdefender\b|\bfirewall\b/, 'lock.shield.fill', 'blue'],
  [/\baccessibility\b|\bease of access\b/, 'accessibility', 'blue'],
  [/\b(time|clock|date)\b/, 'clock.fill', 'teal'],
  [/\b(language|region|globe)\b/, 'globe', 'teal'],
  [/\bapps?\b|\bprograms?\b|\bapplications?\b/, 'square.grid.2x2.fill', 'indigo'],
  [/\b(gaming|games?|xbox)\b/, 'gamecontroller.fill', 'pink'],
  [/\b(personali[sz]ation|themes?|colou?rs?|background|wallpaper|appearance)\b/, 'paintbrush.fill', 'orange'],
  [/\b(storage|disk|drive)\b/, 'internaldrive.fill', 'gray'],
  [/\b(notifications?|alerts?|activity|bell)\b/, 'bell.badge.fill', 'red'],
  [/\b(focus|do not disturb)\b/, 'moon.fill', 'indigo'],
  [/\b(accounts?|profile|user|sign in|me)\b/, 'person.crop.circle.fill', 'green'],
  [/\b(people|contacts|members|friends|team)\b/, 'person.2.fill', 'blue'],
  [/\b(devices?|printers? & scanners)\b/, 'laptopcomputer.and.iphone', 'blue'],
  [/\b(system|about this pc|this pc|computer)\b/, 'desktopcomputer', 'gray'],
  [/\b(mail|email|inbox|outlook)\b/, 'envelope.fill', 'blue'],
  [/\b(sent( items)?|outbox)\b/, 'paperplane', 'blue'],
  [/\b(drafts?)\b/, 'doc.text', 'gray'],
  [/\b(junk|spam)\b/, 'xmark.bin', 'gray'],
  [/\barchive\b/, 'archivebox.fill', 'brown'],
  [/\bcalendar\b/, 'calendar', 'red'],
  [/\b(chat|messages?|conversations?|direct messages?)\b/, 'bubble.left.and.bubble.right.fill', 'green'],
  [/\b(channels?|threads?)\b/, 'number', 'gray'],
  [/\b(pictures?|photos?|images?|gallery)\b/, 'photo.fill', 'orange'],
  [/\b(music|songs?|library)\b/, 'music.note', 'pink'],
  [/\b(videos?|movies?|films?)\b/, 'film.fill', 'purple'],
  [/\bdesktop\b/, 'menubar.dock.rectangle', 'blue'],
  [/\bdocuments?\b/, 'doc.fill', 'blue'],
  [/\b(onedrive|icloud|dropbox|google drive|cloud)\b/, 'cloud.fill', 'blue'],
  [/\b(recent|quick access)\b/, 'clock.fill', 'blue'],
  [/\bhome\b/, 'house.fill', 'blue'],
  [/\bfolders?\b/, 'folder.fill', 'blue'],
  [/\b(files?|explorer)\b/, 'doc', 'blue'],
  [/\b(help|support|feedback|get started|tips)\b/, 'questionmark.circle', 'blue'],
  [/\b(info|about|details|properties)\b/, 'info.circle', 'gray'],
  [/\b(settings|preferences|options|customi[sz]e|manage)\b/, 'gearshape.fill', 'gray'],
  [/\b(lock|locked)\b/, 'lock.fill', 'gray'],
  [/\bunlock\b/, 'lock.open.fill', 'gray'],
  [/\bpin(ned)?\b/, 'pin.fill', 'orange'],
  [/\bflag(ged)?\b/, 'flag.fill', 'orange'],
  [/\b(more|more options|overflow|see more|…)$/, 'ellipsis.circle'],
  [/\b(menu|hamburger|navigation)\b/, 'line.3.horizontal'],
  [/\b(close|dismiss|cancel)\b/, 'xmark'],
  [/\b(minimi[sz]e)\b/, 'minus'],
  [/\b(view|layout)\b/, 'rectangle.grid.2x2'],
  [/\b(sync)\b/, 'arrow.triangle.2.circlepath'],
];

function match(text: string): Rule | undefined {
  const s = text.toLowerCase();
  if (!s) return undefined;
  for (const rule of RULES) if (rule[0].test(s)) return rule;
  return undefined;
}

/** SF Symbol for a command, if its name (or automation id) is recognisable. */
export function symbolFor(name: string, aid?: string): string | undefined {
  return match(name)?.[1] ?? (aid ? match(aid.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' '))?.[1] : undefined);
}

/** iOS-Settings-style colored tile for a navigation row. */
export function tileFor(name: string, aid?: string): Icon | undefined {
  const rule = match(name) ?? (aid ? match(aid.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')) : undefined);
  if (!rule) return undefined;
  return { symbol: rule[1], color: rule[2] ?? 'gray', style: 'tile' };
}

/**
 * Icons for a whole navigation list: only when most rows get one, so lists never look
 * half-decorated. Returns one entry per name (undefined = no icon).
 */
export function tilesForList(names: string[]): Array<Icon | undefined> {
  const tiles = names.map((n) => tileFor(n));
  const hits = tiles.filter(Boolean).length;
  if (names.length === 0 || hits / names.length < 0.6) return names.map(() => undefined);
  return tiles.map((t) => t ?? { symbol: 'circle.grid.2x2.fill', color: 'gray', style: 'tile' });
}

/** Icon for a file name by its extension. */
export function fileIcon(name: string, isDir: boolean): Icon {
  if (isDir) return { symbol: 'folder.fill', color: 'blue', style: 'plain' };
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const by: Record<string, [string, string]> = {
    pdf: ['doc.richtext.fill', 'red'],
    doc: ['doc.text.fill', 'blue'],
    docx: ['doc.text.fill', 'blue'],
    xls: ['tablecells.fill', 'green'],
    xlsx: ['tablecells.fill', 'green'],
    csv: ['tablecells', 'green'],
    ppt: ['rectangle.on.rectangle.angled.fill', 'orange'],
    pptx: ['rectangle.on.rectangle.angled.fill', 'orange'],
    txt: ['doc.plaintext', 'gray'],
    md: ['doc.plaintext', 'gray'],
    png: ['photo.fill', 'orange'],
    jpg: ['photo.fill', 'orange'],
    jpeg: ['photo.fill', 'orange'],
    gif: ['photo.fill', 'orange'],
    heic: ['photo.fill', 'orange'],
    webp: ['photo.fill', 'orange'],
    mp4: ['film.fill', 'purple'],
    mov: ['film.fill', 'purple'],
    mkv: ['film.fill', 'purple'],
    mp3: ['music.note', 'pink'],
    wav: ['waveform', 'pink'],
    zip: ['doc.zipper', 'gray'],
    '7z': ['doc.zipper', 'gray'],
    rar: ['doc.zipper', 'gray'],
    exe: ['app.fill', 'gray'],
    msi: ['shippingbox.fill', 'brown'],
    lnk: ['arrow.up.forward.app', 'gray'],
  };
  const hit = by[ext];
  if (hit) return { symbol: hit[0], color: hit[1], style: 'plain' };
  if (/^(js|ts|tsx|jsx|py|cs|cpp|c|h|java|go|rs|swift|json|html|css|xml|yml|yaml|sh|ps1|bat)$/.test(ext)) {
    return {
      symbol: 'chevron.left.forwardslash.chevron.right',
      color: 'gray',
      style: 'plain',
    };
  }
  return { symbol: 'doc', color: 'gray', style: 'plain' };
}
