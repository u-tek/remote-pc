import type { WindowsHelper } from '../pc/helper.js';
import type { USnapshot } from './uia.js';

export interface WindowInfo {
  hwnd: number;
  title: string;
  process: string;
  pid: number;
  minimized: boolean;
  maximized: boolean;
  foreground: boolean;
}

/** Everything the app sessions need from Windows. Tests swap in a fake. */
export interface UiBackend {
  windows(): Promise<WindowInfo[]>;
  snapshot(hwnd: number): Promise<USnapshot>;
  /** Run a UI Automation action on a control (see UiaOp), returns what happened. */
  act(hwnd: number, id: string, op: string, value?: string): Promise<string>;
  /** Press keys in the window (virtual-key codes, held together). */
  windowKeys(hwnd: number, vks: number[]): Promise<void>;
  windowText(hwnd: number, text: string): Promise<void>;
  tap(hwnd: number, x: number, y: number, button?: 'left' | 'right', count?: number): Promise<void>;
  wheel(hwnd: number, x: number, y: number, dy: number): Promise<void>;
  /** A piece of the window (relative rect) as an image. */
  crop(hwnd: number, rect: [number, number, number, number], width: number, format: 'png' | 'jpeg'): Promise<Buffer>;
  /** Drop the cached picture of a window after it changed. */
  invalidate(hwnd: number): Promise<void>;
  windowIcon(hwnd: number): Promise<Buffer | null>;
  screenReader(on: boolean): Promise<void>;
}

/** The real backend: the UI helper (assets/ui.ps1) plus the general helper for window lists and icons. */
export class HelperBackend implements UiBackend {
  constructor(
    private readonly ui: WindowsHelper,
    private readonly helper: WindowsHelper,
  ) {}

  windows(): Promise<WindowInfo[]> {
    return this.helper.call<WindowInfo[]>('windows');
  }

  snapshot(hwnd: number): Promise<USnapshot> {
    return this.ui.call<USnapshot>('snap', { hwnd }, 30_000);
  }

  act(hwnd: number, id: string, op: string, value?: string): Promise<string> {
    return this.ui.call<string>('act', { hwnd, id, op, value: value ?? '' }, 20_000);
  }

  async windowKeys(hwnd: number, vks: number[]): Promise<void> {
    await this.ui.call('winkeys', { hwnd, value: vks.join(',') });
  }

  async windowText(hwnd: number, text: string): Promise<void> {
    await this.ui.call('wintext', { hwnd, text });
  }

  async tap(hwnd: number, x: number, y: number, button: 'left' | 'right' = 'left', count = 1): Promise<void> {
    await this.ui.call('tap', { hwnd, x: Math.round(x), y: Math.round(y), button, count });
  }

  async wheel(hwnd: number, x: number, y: number, dy: number): Promise<void> {
    await this.ui.call('wheel', { hwnd, x: Math.round(x), y: Math.round(y), dy: Math.round(dy) });
  }

  async crop(hwnd: number, rect: [number, number, number, number], width: number, format: 'png' | 'jpeg'): Promise<Buffer> {
    const [x, y, w, h] = rect.map((v) => Math.round(v));
    const b64 = await this.ui.call<string>('crop', { hwnd, x, y, w, h, width, format });
    return Buffer.from(b64, 'base64');
  }

  async invalidate(hwnd: number): Promise<void> {
    await this.ui.call('invalidate', { hwnd });
  }

  async windowIcon(hwnd: number): Promise<Buffer | null> {
    const b64 = await this.helper.call<string | null>('winicon', { hwnd, size: 128 }).catch(() => null);
    return b64 ? Buffer.from(b64, 'base64') : null;
  }

  async screenReader(on: boolean): Promise<void> {
    await this.ui.call('reader', { on });
  }
}
