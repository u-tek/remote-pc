// Remote PC SDK for Node.js (>= 22, no dependencies): put your program on the iPhone as a native app.
// Protocol: ../PROTOCOL.md
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROTOCOL_VERSION = 1;

/** Where the agent says how to reach it (written by the agent on start). */
export function discover() {
  if (process.env.REMOTE_PC_SDK_URL && process.env.REMOTE_PC_SDK_TOKEN) {
    return { url: process.env.REMOTE_PC_SDK_URL, token: process.env.REMOTE_PC_SDK_TOKEN };
  }
  const dir =
    process.env.REMOTE_PC_HOME ??
    (process.platform === 'win32'
      ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'RemotePC')
      : path.join(os.homedir(), '.config', 'remote-pc'));
  const file = path.join(dir, 'sdk.json');
  try {
    const info = JSON.parse(readFileSync(file, 'utf8'));
    return { url: info.url, token: info.token };
  } catch {
    throw new Error(`Remote PC agent not found (${file} is missing). Start the agent, or set REMOTE_PC_SDK_URL and REMOTE_PC_SDK_TOKEN.`);
  }
}

// ---------------------------------------------------------------------------------------------
// Building views. Callbacks are turned into refs while rendering; the refs are derived from the
// element's id/title so they stay the same between renders.

let ctx = null;

function slug(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function bind(fn, hint) {
  if (typeof fn !== 'function') return undefined;
  if (!ctx) throw new Error('UI elements with callbacks must be built inside a render function');
  const base = hint || 'action';
  const n = (ctx.seen.get(base) ?? 0) + 1;
  ctx.seen.set(base, n);
  const ref = n === 1 ? base : `${base}#${n}`;
  ctx.handlers.set(ref, fn);
  return ref;
}

function idFor(kind, title, opts) {
  if (opts?.id) return String(opts.id);
  const base = `${kind}-${slug(title) || 'x'}`;
  if (!ctx) return base;
  const n = (ctx.ids.get(base) ?? 0) + 1;
  ctx.ids.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

function clean(obj) {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  return obj;
}

function act(title, onTap, opts = {}) {
  const id = opts.id ?? `${slug(title) || 'action'}`;
  return clean({ ref: opts.ref ?? bind(onTap, `a:${id}`) ?? `noop:${id}`, title, symbol: opts.symbol, role: opts.role, disabled: opts.disabled, confirm: opts.confirm });
}

export const ui = {
  icon(symbol, color = 'blue', style = 'tile') {
    return { symbol, color, style };
  },
  initials(text, color = 'gray') {
    return { text, color, style: 'circle' };
  },
  action: act,
  menu(title, target, opts = {}) {
    if (Array.isArray(target)) return clean({ title, symbol: opts.symbol, children: target });
    return clean({ title, symbol: opts.symbol, action: act(title, target, opts), checked: opts.checked, role: opts.role, disabled: opts.disabled });
  },

  screen(title, content = [], opts = {}) {
    const sections = content.length && content[0] && Array.isArray(content[0].items) ? content : [ui.section(content)];
    const s = clean({
      id: opts.id ?? `screen-${slug(title)}`,
      title,
      subtitle: opts.subtitle,
      style: opts.style,
      largeTitle: opts.largeTitle,
      actions: opts.actions,
      menu: opts.menu,
      bottomBar: opts.bottomBar,
      sections: sections.filter((x) => x.items.length > 0),
      empty: opts.empty,
    });
    if (opts.search) {
      const ref = bind(opts.search.onChange, `search:${s.id}`) ?? `search:${s.id}`;
      s.search = clean({ ref, placeholder: opts.search.placeholder ?? 'Search', value: opts.search.value ?? '', submit: opts.search.onSubmit ? act('Search', opts.search.onSubmit, { id: `submit-${s.id}` }) : undefined });
    }
    if (opts.segments) {
      const items = opts.segments.items.map((c) => (typeof c === 'string' ? { id: c, title: c } : c));
      s.segments = clean({ items, selected: opts.segments.selected, ref: bind(opts.segments.onChange, `segments:${s.id}`) });
    }
    if (opts.composer) {
      s.composer = clean({
        ref: bind(opts.composer.onSend, `send:${s.id}`) ?? `send:${s.id}`,
        placeholder: opts.composer.placeholder ?? 'Message',
        attach: opts.composer.onAttach ? act('Attach', opts.composer.onAttach, { symbol: 'plus', id: `attach-${s.id}` }) : undefined,
      });
    }
    if (opts.document !== undefined) {
      s.document = clean({ text: opts.document.text ?? '', ref: bind(opts.document.onChange, `doc:${s.id}`), format: opts.document.format });
    }
    if (opts.refresh) s.refresh = act('Refresh', opts.refresh, { id: `refresh-${s.id}` });
    if (opts.more) s.more = act('More', opts.more, { id: `more-${s.id}` });
    return s;
  },

  section(a, b, c) {
    // section(items) | section(header, items, opts) | section(items, opts)
    let header, items, opts;
    if (Array.isArray(a)) [items, opts] = [a, b ?? {}];
    else [header, items, opts] = [a, b ?? [], c ?? {}];
    const flat = items.flat().filter(Boolean);
    return clean({ id: opts.id ?? `section-${slug(header ?? flat[0]?.id ?? 'main')}`, header, footer: opts.footer, style: opts.style, items: flat });
  },

  nav(title, onTap, opts = {}) {
    const id = idFor('nav', title, opts);
    return clean({ id, kind: 'nav', title, subtitle: opts.subtitle, value: opts.value, icon: opts.icon, badge: opts.badge, tap: act(title, onTap, { id }) });
  },
  toggle(title, on, onChange, opts = {}) {
    const id = idFor('toggle', title, opts);
    return clean({ id, kind: 'toggle', title, subtitle: opts.subtitle, icon: opts.icon, on: Boolean(on), ref: bind(onChange, `t:${id}`) ?? `noop:${id}`, disabled: opts.disabled });
  },
  choice(title, options, selected, onChange, opts = {}) {
    const id = idFor('choice', title, opts);
    const list = options.map((o) => (typeof o === 'string' ? { id: o, title: o } : o));
    const chosen = list.find((o) => o.id === selected);
    return clean({ id, kind: 'choice', title, value: chosen?.title, options: list, selected, ref: bind(onChange, `c:${id}`) ?? `noop:${id}`, style: opts.style, subtitle: opts.subtitle, icon: opts.icon, disabled: opts.disabled });
  },
  slider(title, value, onChange, opts = {}) {
    const id = idFor('slider', title, opts);
    return clean({ id, kind: 'slider', title, min: opts.min ?? 0, max: opts.max ?? 100, step: opts.step, value, ref: bind(onChange, `s:${id}`) ?? `noop:${id}`, icon: opts.icon, disabled: opts.disabled });
  },
  stepper(title, value, onChange, opts = {}) {
    const id = idFor('stepper', title, opts);
    return clean({ id, kind: 'stepper', title, value, min: opts.min, max: opts.max, step: opts.step, ref: bind(onChange, `n:${id}`) ?? `noop:${id}` });
  },
  field(title, value, onChange, opts = {}) {
    const id = idFor('field', title ?? opts.placeholder, opts);
    return clean({
      id,
      kind: 'field',
      title,
      placeholder: opts.placeholder,
      value: value ?? '',
      ref: bind(onChange, `f:${id}`) ?? `noop:${id}`,
      secure: opts.secure,
      multiline: opts.multiline,
      readOnly: opts.readOnly,
      keyboard: opts.keyboard,
      submit: opts.onSubmit ? act('Go', opts.onSubmit, { id: `submit-${id}` }) : undefined,
    });
  },
  button(title, onTap, opts = {}) {
    const id = idFor('button', title, opts);
    return clean({ id, kind: 'button', action: act(title, onTap, { ...opts, id }), style: opts.style });
  },
  check(title, on, onChange, opts = {}) {
    const id = idFor('check', title, opts);
    return clean({ id, kind: 'check', title, subtitle: opts.subtitle, on: Boolean(on), ref: bind(onChange, `k:${id}`) ?? `noop:${id}`, radio: opts.radio });
  },
  text(text, opts = {}) {
    return clean({ id: idFor('text', opts.label ?? text, opts), kind: 'text', text: String(text), style: opts.style, label: opts.label, copyable: opts.copyable });
  },
  label(label, value, opts = {}) {
    return ui.text(value, { ...opts, label });
  },
  heading(text, level = 2, opts = {}) {
    return { id: idFor('heading', text, opts), kind: 'heading', text, level };
  },
  paragraph(content, opts = {}) {
    const runs = (Array.isArray(content) ? content : [content]).map((r) => (typeof r === 'string' ? { text: r } : clean({ text: r.text, bold: r.bold, italic: r.italic, code: r.code, link: r.onTap ? act(r.text, r.onTap) : undefined })));
    return clean({ id: idFor('para', runs[0]?.text, opts), kind: 'paragraph', runs, bullet: opts.bullet, quote: opts.quote });
  },
  image(image, opts = {}) {
    const id = idFor('image', opts.caption ?? 'image', opts);
    return clean({ id, kind: 'image', image, caption: opts.caption, aspect: opts.aspect, tap: opts.onTap ? act('Open', opts.onTap, { id }) : undefined });
  },
  progress(value, opts = {}) {
    return clean({ id: idFor('progress', opts.title, opts), kind: 'progress', title: opts.title, value, label: opts.label });
  },
  item(title, opts = {}) {
    const id = idFor('item', title, opts);
    const swipe = (list, side) => list?.map((s, i) => act(s.title, s.onTap, { ...s, id: `${id}-${side}${i}` }));
    return clean({
      id,
      kind: 'item',
      title,
      subtitle: opts.subtitle,
      detail: opts.detail,
      meta: opts.meta,
      icon: opts.icon,
      selected: opts.selected,
      unread: opts.unread,
      checked: opts.checked,
      chevron: opts.chevron,
      tap: opts.onTap ? act(title, opts.onTap, { id }) : undefined,
      menu: opts.menu,
      swipe: swipe(opts.swipe, 's'),
      leadingSwipe: swipe(opts.leadingSwipe, 'l'),
    });
  },
  tile(title, opts = {}) {
    const id = idFor('tile', title, opts);
    return clean({ id, kind: 'tile', title, subtitle: opts.subtitle, icon: opts.icon, image: opts.image, tap: opts.onTap ? act(title, opts.onTap, { id }) : undefined, menu: opts.menu });
  },
  message(text, opts = {}) {
    return clean({ id: opts.id ?? idFor('msg', `${opts.author ?? ''}${opts.time ?? ''}${text}`.slice(0, 30), opts), kind: 'message', text, author: opts.author, time: opts.time, avatar: opts.avatar, outgoing: opts.outgoing, images: opts.images, reactions: opts.reactions, system: opts.system });
  },
  record(title, fields, opts = {}) {
    const id = idFor('record', title, opts);
    const list = Array.isArray(fields) ? fields : Object.entries(fields).map(([label, value]) => ({ label, value: String(value) }));
    return clean({ id, kind: 'record', title, fields: list, tap: opts.onTap ? act(title, opts.onTap, { id }) : undefined, menu: opts.menu });
  },
  buttons(list, opts = {}) {
    const id = idFor('buttons', list.map((b) => b.title).join('-'), opts);
    return { id, kind: 'buttons', actions: list.map((b, i) => act(b.title, b.onTap, { ...b, id: `${id}-${i}` })) };
  },
  profile(title, opts = {}) {
    const id = idFor('profile', title, opts);
    return clean({ id, kind: 'profile', title, subtitle: opts.subtitle, icon: opts.icon, tap: opts.onTap ? act(title, opts.onTap, { id }) : undefined });
  },
  divider() {
    return { id: idFor('divider', 'd'), kind: 'divider' };
  },
};

// ---------------------------------------------------------------------------------------------

/**
 * A program shown on the phone. Give it a render function that returns a screen; call
 * `update()` whenever your state changes. Use push/pop for detail screens.
 */
export class PhoneApp {
  constructor(info, render) {
    if (!info?.id || !info?.name) throw new Error('PhoneApp needs { id, name }');
    this.info = info;
    this.stack = render ? [render] : [];
    this.sheetRender = null;
    this.alertSpec = null;
    this.handlers = new Map();
    this.viewers = 0;
    this.ws = null;
    this.closed = false;
    this.listeners = { open: [], close: [], refresh: [] };
  }

  /** Set the root screen's render function. */
  render(fn) {
    this.stack = [fn, ...this.stack.slice(1)];
    this.update();
    return this;
  }

  push(fn) {
    this.stack.push(fn);
    this.update();
  }

  pop() {
    if (this.stack.length > 1) this.stack.pop();
    this.update();
  }

  sheet(fn) {
    this.sheetRender = fn;
    this.update();
  }

  closeSheet() {
    this.sheetRender = null;
    this.update();
  }

  /** alert({ title, message, actions: [{ title, role, onTap }] }) */
  alert(spec) {
    this.alertSpec = spec;
    this.update();
  }

  toast(text) {
    this.send({ type: 'toast', text: String(text) });
  }

  on(event, fn) {
    this.listeners[event]?.push(fn);
    return this;
  }

  /** The current view (also useful for tests). */
  view() {
    ctx = { handlers: new Map(), seen: new Map(), ids: new Map() };
    try {
      // Depth-prefixed ids: pushing a screen never looks like replacing the one below it.
      const screens = this.stack.map((fn, i) => {
        const s = fn(this);
        s.id = `${i}:${s.id ?? s.title}`;
        return s;
      });
      const view = { screens };
      if (this.sheetRender) view.sheet = this.sheetRender(this);
      if (this.alertSpec) {
        const a = this.alertSpec;
        view.alert = clean({
          title: a.title,
          message: a.message,
          actions: (a.actions ?? [{ title: 'OK' }]).map((x, i) =>
            act(
              x.title,
              () => {
                this.alertSpec = null;
                return x.onTap?.();
              },
              { ...x, id: `alert-${i}` },
            ),
          ),
        });
      }
      this.handlers = ctx.handlers;
      return view;
    } finally {
      ctx = null;
    }
  }

  update() {
    if (!this.ws || this.ws.readyState !== 1 || this.stack.length === 0) return;
    this.send({ type: 'view', view: this.view() });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  async handle(msg) {
    switch (msg.type) {
      case 'welcome':
        this.send({ type: 'hello', protocol: PROTOCOL_VERSION, app: this.info });
        this.update();
        break;
      case 'open':
        this.viewers = msg.viewers ?? 1;
        for (const fn of this.listeners.open) fn();
        this.update();
        break;
      case 'close':
        this.viewers = 0;
        for (const fn of this.listeners.close) fn();
        break;
      case 'action': {
        const fn = this.handlers.get(msg.ref);
        if (fn) {
          try {
            await fn(msg.value);
          } catch (err) {
            this.toast(err?.message ?? String(err));
          }
        }
        this.update();
        break;
      }
      case 'pop':
        this.stack.length = Math.max(1, Math.min(this.stack.length, msg.depth ?? 1));
        this.update();
        break;
      case 'dismiss':
        this.sheetRender = null;
        this.alertSpec = null;
        this.update();
        break;
      case 'refresh':
        for (const fn of this.listeners.refresh) await fn();
        this.update();
        break;
    }
  }

  /** Connect to the agent (and keep reconnecting). Resolves once connected the first time. */
  connect(target = discover()) {
    this.closed = false;
    return new Promise((resolve) => {
      let first = true;
      let delay = 500;
      const open = () => {
        if (this.closed) return;
        const sep = target.url.includes('?') ? '&' : '?';
        const ws = new WebSocket(`${target.url}${sep}token=${encodeURIComponent(target.token)}`);
        this.ws = ws;
        ws.onopen = () => {
          delay = 500;
          if (first) {
            first = false;
            resolve(this);
          }
        };
        ws.onmessage = (e) => {
          try {
            void this.handle(JSON.parse(String(e.data)));
          } catch {
            // ignore malformed messages
          }
        };
        ws.onclose = () => {
          if (this.closed) return;
          setTimeout(open, delay);
          delay = Math.min(delay * 2, 10_000);
        };
        ws.onerror = () => undefined;
      };
      open();
    });
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}
