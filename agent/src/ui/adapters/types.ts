import type { UiBackend } from '../backend.js';
import type { Rewritten } from '../rules/build.js';
import type { USnapshot } from '../uia.js';

export interface WindowLike {
  process: string;
  title: string;
  cls?: string;
}

export interface AdapterContext {
  hwnd: number;
  backend: UiBackend;
  /** The snapshot the current view was built from. */
  snapshot(): USnapshot | undefined;
  /** Per-session memory for the adapter (scroll positions, drafts, …). */
  state: Record<string, unknown>;
  /** Show a short message on the phone. */
  toast(text: string): void;
}

export interface ParsedAction {
  ref: string;
  kind: string;
  id: string;
  extra?: string;
}

/**
 * A hand-tuned rewrite for one family of apps. It starts from the generic rules' result (so
 * anything it doesn't handle still works) and reshapes it into the app's best phone form.
 */
export interface Adapter {
  id: string;
  /** Shown in the app list ("Tuned for Chrome"). */
  label: string;
  matches(w: WindowLike): boolean;
  view(snap: USnapshot, base: Rewritten, ctx: AdapterContext): Rewritten;
  /** Handle the adapter's own action refs; return false to fall through to the generic handling. */
  action?(a: ParsedAction, value: unknown, ctx: AdapterContext): Promise<boolean>;
  /** Open straight into the page instead of the app's sidebar. */
  startInPage?: boolean;
}
