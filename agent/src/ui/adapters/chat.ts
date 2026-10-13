import { isTimeLike, truncate } from '../rules/text.js';
import { findAll, texts, walk, type Node } from '../rules/tree.js';
import type { Action, Icon, MessageItem, NavItem, Screen, Section } from '../schema.js';
import { ref } from '../uia.js';
import { action, button, largest, picture } from './kit.js';
import type { Adapter } from './types.js';

const CHAT_APPS =
  /^(discord|discordptb|discordcanary|slack|ms-teams|teams|whatsapp|whatsapp\.root|telegram|signal|element|messenger|skype|zoom|mattermost|beeper|caprine)$/i;
const COMPOSER = /\b(message|type|write|reply|chat|compose|send a|aa)\b/i;
const SEPARATOR =
  /^(today|yesterday|new( messages?)?|unread( messages)?|(mon|tues|wednes|thurs|fri|satur|sun)day|(january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}(, \d{4})?|\d{1,2}\/\d{1,2}\/\d{2,4})$/i;
const EMOJI_START = /^\p{Extended_Pictographic}/u;
const ROW_TYPES = new Set(['ListItem', 'Group', 'DataItem', 'Custom', 'Pane', 'Text']);

/** The box you type messages into: wide, near the bottom, editable. */
function findComposer(root: Node, W: number, H: number): Node | undefined {
  return largest(
    root,
    (n) =>
      (n.t === 'Edit' || n.t === 'Document' || n.t === 'Custom') &&
      n.raw.ro !== 1 &&
      (n.raw.kf === 1 || n.raw.val !== undefined || n.raw.txt === 1) &&
      n.y + n.h >= H * 0.6 &&
      n.w >= W * 0.25 &&
      n.h <= 200 &&
      (COMPOSER.test(`${n.name} ${n.raw.help ?? ''} ${n.raw.aid ?? ''}`) || n.t === 'Edit'),
  );
}

/** Rows of the message history: a container above the composer with the most message-like rows. */
function findHistory(root: Node, composer: Node): { list: Node; rows: Node[] } | undefined {
  let best: { list: Node; rows: Node[]; score: number } | undefined;
  walk(root, (n) => {
    if (n === composer) return false;
    if (!['List', 'Group', 'Pane', 'Document', 'Custom'].includes(n.t)) return true;
    if (n.y + n.h > composer.y + composer.h + 40 || n.x + n.w < composer.x || n.x > composer.x + composer.w) return true;
    const rows = n.kids.filter((k) => ROW_TYPES.has(k.t) && (texts(k).length > 0 || k.name));
    if (rows.length < 2) return true;
    const timed = rows.filter((r) => texts(r).some(isTimeLike) || /\d{1,2}:\d{2}/.test(r.name)).length;
    const score = rows.length + timed * 2 + (n.t === 'List' ? 3 : 0) + (/message|chat|conversation/i.test(`${n.name} ${n.raw.aid ?? ''}`) ? 10 : 0);
    if (!best || score > best.score) best = { list: n, rows, score };
    return true;
  });
  return best && best.score >= 4 ? best : undefined;
}

/** Text pieces of a row in reading order, links and short button labels included. */
function pieces(row: Node): Array<{ text: string; node: Node }> {
  const out: Array<{ text: string; node: Node }> = [];
  walk(row, (n) => {
    if (n === row) return true;
    if (n.t === 'Button' && EMOJI_START.test(n.name)) return false; // reactions
    if ((n.t === 'Text' || n.t === 'Hyperlink') && n.name) {
      out.push({ text: n.name, node: n });
      return false;
    }
    if (
      n.t === 'Button' &&
      n.name &&
      !n.kids.length &&
      n.name.length <= 40 &&
      !/^(more|reply|react|add reaction|edit|delete|forward|copy|pin)\b/i.test(n.name)
    ) {
      out.push({ text: n.name, node: n });
      return false;
    }
    return true;
  });
  return out;
}

/** "Alice, Today at 3:14 PM, see you there" (rows that only carry an accessible name). */
function splitLabel(name: string): string[] {
  return name
    .split(/,\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseMessages(rows: Node[], me: string | undefined, iconFor: (n: Node) => Icon | undefined): MessageItem[] {
  const out: MessageItem[] = [];
  let lastAuthor: string | undefined;
  let lastAvatar: Icon | undefined;
  const lefts: number[] = [];
  for (const row of rows) {
    let parts = row.t === 'Text' ? [row.name] : pieces(row).map((p) => p.text);
    if (parts.length === 0 && row.name) parts = splitLabel(row.name);
    if (parts.length === 0) continue;

    if (parts.length === 1 && (SEPARATOR.test(parts[0]) || (isTimeLike(parts[0]) && parts[0].length > 5))) {
      out.push({ id: row.id, kind: 'message', text: parts[0], system: true });
      lastAuthor = undefined;
      continue;
    }
    const timeIdx = parts.findIndex(isTimeLike);
    const time = timeIdx >= 0 ? parts[timeIdx].replace(/^[—–-]\s*/, '') : undefined;
    let author: string | undefined;
    let body: string[];
    if (timeIdx >= 1 && parts[0].length <= 40) {
      author = parts[0].replace(/:$/, '');
      body = parts.filter((_, i) => i !== 0 && i !== timeIdx);
    } else if (timeIdx === 0 && parts.length >= 3 && parts[1].length <= 40 && /:$/.test(parts[1])) {
      author = parts[1].replace(/:$/, '');
      body = parts.slice(2);
    } else {
      body = parts.filter((_, i) => i !== timeIdx);
    }
    const reactions = findAll(row, (n) => n.t === 'Button' && EMOJI_START.test(n.name)).map((n) => reaction(n.name));
    const images = findAll(row, (n) => n.t === 'Image' && n.w >= 100 && n.h >= 60)
      .map((n) => iconFor(n)?.image)
      .filter((s): s is string => Boolean(s));
    const avatarNode = findAll(row, (n) => n.t === 'Image' && n.w >= 20 && n.w <= 64 && Math.abs(n.w - n.h) <= 4)[0];
    const text = body
      .join(' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .trim();
    if (!text && images.length === 0) continue;

    const grouped = !author;
    if (author) {
      lastAuthor = author;
      lastAvatar = avatarNode ? { ...iconFor(avatarNode), style: 'circle' } : { text: initials(author), style: 'circle', color: colorFor(author) };
    }
    const msg: MessageItem = { id: row.id, kind: 'message', text };
    if (!grouped) {
      msg.author = author;
      msg.avatar = lastAvatar;
    } else if (lastAuthor) {
      msg.author = undefined;
    }
    if (time) msg.time = time;
    if (images.length) msg.images = images;
    if (reactions.length) msg.reactions = reactions;
    if (me && (author ?? lastAuthor) === me) msg.outgoing = true;
    const bodyNode = pieces(row).find((p) => p.text === body[0])?.node;
    lefts.push(bodyNode && bodyNode.w > 0 ? bodyNode.x - row.x : -1);
    out.push(msg);
  }
  // Apps that right-align your own messages (Teams, WhatsApp): use the layout when names don't tell.
  if (!out.some((m) => m.outgoing)) {
    const known = lefts.filter((x) => x >= 0);
    const width = Math.max(...rows.map((r) => r.w), 1);
    if (known.some((x) => x > width * 0.35) && known.some((x) => x < width * 0.2)) {
      let i = 0;
      for (const m of out) {
        if (m.system) continue;
        if ((lefts[i] ?? -1) > width * 0.35) m.outgoing = true;
        i++;
      }
    }
  }
  return out;
}

/** "👍, 3 reactions, press to react" → "👍 3". */
function reaction(name: string): string {
  const m = /^(\S+?)[,\s]+(?:(\d+)\b)?/u.exec(name);
  if (!m) return name;
  return m[2] ? `${m[1]} ${m[2]}` : m[1];
}

/** Your own name from the account panel chat apps keep in a corner (Discord's bottom-left user area). */
function whoAmI(root: Node, W: number, H: number): string | undefined {
  const panel = findAll(
    root,
    (n) =>
      ['Group', 'Pane', 'Button', 'Custom'].includes(n.t) &&
      (/user (area|panel|settings)|account|profile|^me$/i.test(`${n.name} ${n.raw.aid ?? ''}`) || (n.y > H * 0.8 && n.x < W * 0.35)) &&
      findAll(n, (k) => k.t === 'Image').length > 0 &&
      texts(n).length >= 1 &&
      texts(n).length <= 4,
  )[0];
  return panel ? texts(panel)[0] : undefined;
}

function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

const COLORS = ['blue', 'green', 'orange', 'pink', 'purple', 'indigo', 'teal', 'red', 'mint', 'cyan'];
function colorFor(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** "general (text channel)" → "general"; "Alice, Last message hi, 3:14 PM" → title/subtitle/value. */
function tidyNav(item: NavItem): NavItem {
  let title = item.title.replace(/\s*\((text|voice|announcement|forum|stage) channel\)$/i, '').replace(/,?\s*(unread|mentions?|muted)\b.*$/i, '');
  if (title.length > 28 && title.includes(', ')) {
    const parts = splitLabel(title);
    title = parts[0];
    const time = parts.find((p, i) => i > 0 && isTimeLike(p));
    const rest = parts.slice(1).filter((p) => p !== time && !/^(last message|message)$/i.test(p));
    return { ...item, title, subtitle: item.subtitle ?? (rest.join(', ').replace(/^last message:?\s*/i, '') || undefined), value: time ?? item.value };
  }
  return { ...item, title };
}

/** Discord, Slack, Teams, WhatsApp…: conversations list + bubbles + a message box. */
export const chat: Adapter = {
  id: 'chat',
  label: 'Chat',
  startInPage: true,
  matches: (w) => CHAT_APPS.test(w.process.replace(/\.exe$/i, '')),

  view(snap, base) {
    const root = base.source.root;
    const [W, H] = [snap.rect[2], snap.rect[3]];
    const composer = findComposer(root, W, H);
    if (!composer) return base;
    const history = findHistory(root, composer);
    if (!history) return base;

    const profile = base.home?.sections.find((s) => s.id === 'profile')?.items[0];
    const me = profile && profile.kind === 'profile' ? profile.title : whoAmI(root, W, H);
    const messages = parseMessages(history.rows, me, (n) => picture(base, n));

    // Conversation header: the biggest short text above the history (channel or person name).
    const header = findAll(
      root,
      (n) =>
        (n.t === 'Text' || n.t === 'Hyperlink') &&
        n.y < history.list.y &&
        n.x >= Math.min(composer.x, history.list.x) - 20 &&
        n.name.length > 0 &&
        n.name.length <= 60 &&
        !isTimeLike(n.name),
    ).sort((a, b) => b.h - a.h || a.y - b.y)[0];
    const selectedNav = base.home?.sections.flatMap((s) => s.items).find((i) => i.kind === 'nav' && i.selected);
    const title = header?.name ?? (selectedNav && selectedNav.kind === 'nav' ? tidyNav(selectedNav).title : base.page.title);

    const headerButtons = findAll(
      root,
      (n) => n.t === 'Button' && n.y < history.list.y && n.x >= composer.x && /\b(call|video|voice|start (a )?call|huddle|meet)\b/i.test(n.name),
    );
    const actions = headerButtons.slice(0, 2).map((n) => action(n)!) as Action[];
    const attach = button(root, /\b(attach|upload|add (a )?file|add an attachment|plus|more options)\b/i);

    const page: Screen = {
      id: `chat:${title}`,
      title: truncate(title.replace(/^#\s*/, '# '), 50),
      style: 'chat',
      sections: [{ id: 'messages', style: 'plain', items: messages }],
      composer: {
        ref: ref('chat-send', composer.id),
        placeholder: truncate(composer.name || composer.raw.help || 'Message', 40),
        attach: attach && attach.y > history.list.y ? { ref: ref('invoke', attach.id), symbol: 'plus' } : undefined,
      },
      actions: actions.length ? actions : undefined,
      menu: base.page.menu,
    };
    if (messages.length === 0) page.empty = { title: 'No messages yet', symbol: 'bubble.left.and.bubble.right' };

    let home = base.home;
    if (home) {
      const sections: Section[] = home.sections.map((s) => ({ ...s, items: s.items.map((i) => (i.kind === 'nav' ? tidyNav(i) : i)) }));
      home = { ...home, sections };
    }
    return { ...base, home, trail: [], page };
  },

  async action(a, value, ctx) {
    if (a.kind !== 'chat-send') return false;
    const text = String(value ?? '');
    if (!text.trim()) return true;
    // Enter sends in chat apps, so new lines are typed as Shift+Enter.
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await ctx.backend.act(ctx.hwnd, a.id, 'type', lines[i]);
      if (i < lines.length - 1) await ctx.backend.act(ctx.hwnd, a.id, 'keys', '16,13');
    }
    await ctx.backend.act(ctx.hwnd, a.id, 'submit');
    return true;
  },
};
