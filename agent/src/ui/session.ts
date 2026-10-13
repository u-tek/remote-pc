import { log } from '../log.js';
import type { Adapter, AdapterContext } from './adapters/types.js';
import type { UiBackend } from './backend.js';
import { rewrite, type Rewritten } from './rules/build.js';
import type { AppView, Choice, ClientMessage, Item, Screen, ServerMessage } from './schema.js';
import { parseRef, type UNode, type USnapshot } from './uia.js';

/** UIA operations the phone may ask for directly by ref kind. */
const UIA_OPS = new Set([
  'invoke',
  'toggle',
  'select',
  'open',
  'expand',
  'collapse',
  'setValue',
  'setRange',
  'type',
  'submit',
  'keys',
  'focus',
  'scrollIntoView',
  'scroll',
  'click',
  'dclick',
  'rclick',
  'context',
]);

const ESCAPE = 0x1b;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function findNode(snap: USnapshot, id: string): UNode | undefined {
  const stack: UNode[] = [snap.root, ...snap.popups];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    if (n.c) stack.push(...n.c);
  }
  return undefined;
}

export interface SessionDeps {
  backend: UiBackend;
  adapters: Adapter[];
  pollMs: number;
  /** Remembered between phone visits: combo options per window. */
  memory?: Map<number, Record<string, Choice[]>>;
}

/**
 * One app window shown on one phone. Reads the window, rewrites it, sends native views when they
 * change, and turns the phone's taps back into UI Automation actions. The window stays where it is.
 */
export class WindowSession {
  readonly appId: string;
  private snap?: USnapshot;
  private last?: Rewritten;
  private lastView?: AppView;
  private lastSent = '';
  /** null = no adapter fits this app. */
  private adapter?: Adapter | null;
  private adapterState: Record<string, unknown> = {};
  /** Showing the page rather than the app's sidebar (only matters when there is one). */
  private inPage?: boolean;
  private options: Record<string, Choice[]>;
  private history = new Map<string, Screen>();
  private accumulate?: { pageId: string; items: Item[] };
  private timer?: NodeJS.Timeout;
  private fastUntil = 0;
  private busy = false;
  private again = false;
  private closed = false;
  private pendingToast?: string;
  private failures = 0;

  constructor(
    readonly hwnd: number,
    private readonly deps: SessionDeps,
    private readonly send: (m: ServerMessage) => void,
  ) {
    this.appId = `w${hwnd}`;
    const remembered = deps.memory?.get(hwnd);
    this.options = remembered ?? {};
    deps.memory?.set(hwnd, this.options);
  }

  get snapshot(): USnapshot | undefined {
    return this.snap;
  }

  async start(): Promise<void> {
    this.send({ type: 'status', message: 'Opening…' });
    await this.refresh();
    this.schedule();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.closed) return;
    const delay = Date.now() < this.fastUntil ? 300 : this.deps.pollMs;
    this.timer = setTimeout(() => {
      void this.refresh().finally(() => this.schedule());
    }, delay);
  }

  /** After an action the app is likely changing: look again soon and often for a few seconds. */
  private burst(): void {
    this.fastUntil = Date.now() + 3000;
    setTimeout(() => void this.refresh(), 120);
  }

  private ctx(): AdapterContext {
    return {
      hwnd: this.hwnd,
      backend: this.deps.backend,
      snapshot: () => this.snap,
      state: this.adapterState,
      toast: (text) => (this.pendingToast = text),
    };
  }

  rewriteSnapshot(snap: USnapshot): Rewritten {
    const appId = this.appId;
    let rw = rewrite(snap, {
      appId,
      icon: { image: `/api/windows/${this.hwnd}/icon` },
      imageUrl: (id, size) => `/api/ui/image?app=${appId}&node=${encodeURIComponent(id)}&v=${size}`,
      region: (r) => r.map((v) => Math.round(v)).join(','),
      options: this.options,
    });
    if (this.adapter === undefined) this.adapter = this.deps.adapters.find((a) => a.matches(snap)) ?? null;
    if (this.adapter) {
      try {
        rw = this.adapter.view(snap, rw, this.ctx());
        rw.app.source = 'adapter';
        rw.app.adapter = this.adapter.id;
      } catch (err) {
        log.warn(`adapter ${this.adapter.id} failed; using the generic view`, err);
      }
    }
    if (rw.openOptions?.comboId && rw.openOptions.options.length) this.options[rw.openOptions.comboId] = rw.openOptions.options;
    // A window that can only be shown live plays as real-time video rather than pictures.
    const all = rw.page.sections.flatMap((s) => s.items);
    if (all.length === 1 && all[0].kind === 'live') all[0].stream = { hwnd: this.hwnd };
    return rw;
  }

  async refresh(): Promise<void> {
    if (this.closed) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      const snap = await this.deps.backend.snapshot(this.hwnd);
      this.failures = 0;
      this.snap = snap;
      const rw = this.rewriteSnapshot(snap);
      this.last = rw;
      this.push(this.compose(rw));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/gone|no longer exists|invalid window/i.test(message)) {
        this.send({ type: 'ended', message: 'The app was closed on the PC.' });
        this.close();
      } else if (++this.failures === 3) {
        this.send({ type: 'error', message: `Can't read this app right now: ${message}` });
      }
    } finally {
      this.busy = false;
      if (this.again && !this.closed) {
        this.again = false;
        void this.refresh();
      }
    }
  }

  private push(view: AppView): void {
    if (this.pendingToast) {
      view.toast = this.pendingToast;
      this.pendingToast = undefined;
    }
    const json = JSON.stringify(view);
    if (json === this.lastSent) return;
    this.lastSent = json;
    this.lastView = view;
    this.send({ type: 'view', view });
  }

  /** Build the phone's navigation stack: sidebar → breadcrumb levels → page. */
  compose(rw: Rewritten): AppView {
    if (this.inPage === undefined) {
      const start = this.adapter?.startInPage;
      const adapterSays = typeof start === 'function' ? start(rw) : start;
      this.inPage = !rw.home || (adapterSays ?? (rw.page.style !== 'form' && rw.page.style !== undefined));
    }
    const page = this.withAccumulated(rw.page);
    const screens: Screen[] = [];
    if (rw.home) screens.push(rw.home);
    if (!rw.home || this.inPage) {
      for (const title of rw.trail) screens.push(this.history.get(title) ?? { id: `trail:${title}`, title, sections: [] });
      screens.push(page);
    }
    this.history.set(page.title, page);
    if (this.history.size > 50) this.history.delete(this.history.keys().next().value!);
    const view: AppView = { v: 1, app: rw.app, screens };
    if (rw.sheet) view.sheet = rw.sheet;
    if (rw.alert) view.alert = rw.alert;
    return view;
  }

  /** Rows loaded by scrolling stay on the phone even after the PC list virtualizes them away. */
  private withAccumulated(page: Screen): Screen {
    const acc = this.accumulate;
    if (!acc) return page;
    if (acc.pageId !== page.id) {
      this.accumulate = undefined;
      return page;
    }
    const section = page.sections.find((s) => s.items.some((i) => i.kind === 'item'));
    if (!section) return page;
    const key = (i: Item) => ('title' in i ? `${i.title}|${'subtitle' in i ? (i.subtitle ?? '') : ''}` : i.id);
    const present = new Set(section.items.map(key));
    const earlier = acc.items.filter((i) => !present.has(key(i)));
    const items = [...earlier, ...section.items].slice(-1000);
    acc.items = items;
    return { ...page, sections: page.sections.map((s) => (s === section ? { ...s, items } : s)) };
  }

  async handle(msg: ClientMessage): Promise<void> {
    try {
      if (msg.type === 'refresh') await this.refresh();
      else if (msg.type === 'pop') await this.pop(msg.depth);
      else if (msg.type === 'dismiss') await this.dismiss();
      else if (msg.type === 'action') await this.action(msg.ref, msg.value);
    } catch (err) {
      this.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      this.burst();
    }
  }

  private async action(ref: string, value: unknown): Promise<void> {
    const b = this.deps.backend;
    const parsed = parseRef(ref);
    const { kind, id, extra } = parsed;
    if (this.adapter?.action && (await this.adapter.action({ ref, kind, id, extra }, value, this.ctx()))) {
      await b.invalidate(this.hwnd).catch(() => undefined);
      this.burst();
      return;
    }
    switch (kind) {
      case 'nav':
        await b.act(this.hwnd, id, 'select').catch(() => b.act(this.hwnd, id, 'invoke'));
        this.inPage = true;
        break;
      case 'options':
        await this.loadOptions(id);
        break;
      case 'choose':
        await this.choose(id, String(value ?? extra ?? ''));
        break;
      case 'menu':
        await b.act(this.hwnd, id, 'expand');
        break;
      case 'more':
        if (this.last) {
          const section = this.lastView?.screens.at(-1)?.sections.find((s) => s.items.some((i) => i.kind === 'item'));
          this.accumulate = { pageId: this.last.page.id, items: section?.items ?? [] };
        }
        await b.act(this.hwnd, id, 'scroll', 'down');
        break;
      case 'live':
        await this.live(id, value);
        break;
      default:
        if (!UIA_OPS.has(kind)) throw new Error(`Unknown action: ${kind}`);
        await b.act(this.hwnd, id, kind, value === undefined || value === null ? undefined : String(value));
    }
    await b.invalidate(this.hwnd).catch(() => undefined);
    this.burst();
  }

  /** Open a dropdown on the PC just long enough to read its options, then close it again. */
  private async loadOptions(comboId: string): Promise<void> {
    const b = this.deps.backend;
    await b.act(this.hwnd, comboId, 'expand');
    let options: Choice[] = [];
    for (let i = 0; i < 3 && options.length === 0; i++) {
      await sleep(200 + i * 200);
      const snap = await b.snapshot(this.hwnd);
      const rw = rewrite(snap, { appId: this.appId, imageUrl: () => '', region: () => '', options: {} });
      options = rw.openOptions?.options ?? [];
      if (!options.length) {
        const combo = findNode(snap, comboId);
        options = collectNames(combo, 'ListItem').map((n) => ({ id: n, title: n }));
      }
    }
    this.options[comboId] = options;
    await b.act(this.hwnd, comboId, 'collapse').catch(() => b.windowKeys(this.hwnd, [ESCAPE]));
  }

  private async choose(comboId: string, title: string): Promise<void> {
    const b = this.deps.backend;
    // Win32 combo boxes expose their items even when closed.
    const combo = this.snap ? findNode(this.snap, comboId) : undefined;
    const direct = findByName(combo, 'ListItem', title);
    if (direct) {
      await b.act(this.hwnd, direct.id, 'select');
      return;
    }
    await b.act(this.hwnd, comboId, 'expand');
    for (let i = 0; i < 3; i++) {
      await sleep(200 + i * 200);
      const snap = await b.snapshot(this.hwnd);
      const inCombo = findByName(findNode(snap, comboId), 'ListItem', title);
      const inPopup = snap.popups.map((p) => findByName(p, 'ListItem', title)).find(Boolean);
      const anywhere = inCombo ?? inPopup ?? findByName(snap.root, 'ListItem', title);
      if (anywhere) {
        await b.act(this.hwnd, anywhere.id, 'select').catch(() => b.act(this.hwnd, anywhere.id, 'invoke'));
        await sleep(150);
        const after = await b.snapshot(this.hwnd);
        if (findNode(after, comboId)?.exp === 1) await b.act(this.hwnd, comboId, 'collapse').catch(() => undefined);
        return;
      }
    }
    await b.windowKeys(this.hwnd, [ESCAPE]).catch(() => undefined);
    throw new Error(`“${title}” is not available any more.`);
  }

  /** Taps, scrolls and typing on a live picture go to that spot in the window. */
  private async live(region: string, value: unknown): Promise<void> {
    const [rx, ry, rw, rh] = region.split(',').map(Number);
    const v = (value ?? {}) as { x?: number; y?: number; kind?: string; dy?: number; text?: string };
    const x = rx + Math.min(1, Math.max(0, v.x ?? 0.5)) * rw;
    const y = ry + Math.min(1, Math.max(0, v.y ?? 0.5)) * rh;
    const b = this.deps.backend;
    if (v.kind === 'scroll') await b.wheel(this.hwnd, x, y, v.dy ?? -120);
    else if (v.kind === 'text') await b.windowText(this.hwnd, v.text ?? '');
    else await b.tap(this.hwnd, x, y, v.kind === 'secondary' ? 'right' : 'left', v.kind === 'double' ? 2 : 1);
  }

  /** The phone went back to `depth` screens. */
  private async pop(depth: number): Promise<void> {
    const rw = this.last;
    const shown = this.lastView?.screens.length ?? 0;
    if (!rw || depth >= shown) return;
    if (rw.home && depth <= 1) {
      // Back to the sidebar is a phone-only move; the PC keeps showing the page.
      this.inPage = false;
      this.lastSent = '';
      this.push(this.compose(rw));
      return;
    }
    let levels = shown - depth;
    let current: Rewritten | undefined = rw;
    while (levels-- > 0 && current?.up) {
      await this.deps.backend.act(this.hwnd, parseRef(current.up.ref).id, parseRef(current.up.ref).kind);
      await sleep(250);
      await this.refresh();
      current = this.last;
    }
    this.burst();
  }

  /** The phone closed a sheet or alert without choosing: cancel it on the PC too. */
  private async dismiss(): Promise<void> {
    const rw = this.last;
    if (!rw) return;
    const b = this.deps.backend;
    // Sheets the adapter drew itself (tab switcher…) close without touching the PC.
    if (rw.sheet?.id.startsWith('local:')) {
      await this.adapter?.action?.({ ref: 'dismiss', kind: 'dismiss', id: '' }, undefined, this.ctx());
      this.lastSent = '';
      await this.refresh();
      return;
    }
    const cancel = rw.alert?.actions.find((a) => a.role === 'cancel') ?? rw.sheet?.actions?.find((a) => a.role === 'cancel');
    if (cancel && !rw.sheet?.id.startsWith('menu:')) {
      const p = parseRef(cancel.ref);
      await b.act(this.hwnd, p.id, p.kind).catch(() => b.windowKeys(this.hwnd, [ESCAPE]));
    } else {
      await b.windowKeys(this.hwnd, [ESCAPE]);
    }
    this.burst();
  }
}

function collectNames(root: UNode | undefined, type: string): string[] {
  const out: string[] = [];
  const stack = root ? [root] : [];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.t === type && n.n) out.push(n.n);
    if (n.c) stack.push(...n.c);
  }
  return out;
}

function findByName(root: UNode | undefined, type: string, name: string): UNode | undefined {
  const stack = root ? [root] : [];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.t === type && n.n === name) return n;
    if (n.c) stack.push(...n.c);
  }
  return undefined;
}
