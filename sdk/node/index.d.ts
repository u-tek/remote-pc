// Types for the Remote PC SDK. The full protocol is in ../PROTOCOL.md (source: agent/src/ui/schema.ts).

export const PROTOCOL_VERSION: 1;

export interface Icon {
  symbol?: string;
  image?: string;
  text?: string;
  color?: string;
  style?: 'tile' | 'circle' | 'plain';
}
export interface Action {
  ref: string;
  title?: string;
  symbol?: string;
  role?: 'destructive' | 'cancel' | 'primary';
  disabled?: boolean;
  confirm?: string;
}
export interface MenuItem {
  title: string;
  symbol?: string;
  action?: Action;
  children?: MenuItem[];
  checked?: boolean;
  role?: 'destructive';
  disabled?: boolean;
}
export type Item = { id: string; kind: string; [key: string]: unknown };
export interface Section {
  id: string;
  header?: string;
  footer?: string;
  style?: 'grouped' | 'plain' | 'grid' | 'cards';
  items: Item[];
}
export interface Screen {
  id: string;
  title: string;
  sections: Section[];
  [key: string]: unknown;
}
export interface AppInfo {
  id: string;
  name: string;
  icon?: Icon;
  tint?: string;
  description?: string;
}

type Handler<T = void> = (value: T) => unknown | Promise<unknown>;
type Tap = () => unknown | Promise<unknown>;
interface Common {
  id?: string;
}
interface ActionOptions extends Common {
  symbol?: string;
  role?: 'destructive' | 'cancel' | 'primary';
  disabled?: boolean;
  confirm?: string;
}
interface SwipeAction extends ActionOptions {
  title: string;
  onTap: Tap;
}

export interface ScreenOptions extends Common {
  subtitle?: string;
  style?: 'form' | 'list' | 'grid' | 'chat' | 'article' | 'document' | 'browser';
  largeTitle?: boolean;
  actions?: Action[];
  menu?: MenuItem[];
  bottomBar?: Action[];
  empty?: { title: string; message?: string; symbol?: string };
  search?: { placeholder?: string; value?: string; onChange?: Handler<string>; onSubmit?: Tap };
  segments?: { items: Array<string | { id: string; title: string }>; selected?: string; onChange: Handler<string> };
  composer?: { placeholder?: string; onSend: Handler<string>; onAttach?: Tap };
  document?: { text: string; onChange?: Handler<string>; format?: 'plain' | 'markdown' };
  refresh?: Tap;
  more?: Tap;
}

export const ui: {
  icon(symbol: string, color?: string, style?: Icon['style']): Icon;
  initials(text: string, color?: string): Icon;
  action(title: string, onTap: Tap, opts?: ActionOptions): Action;
  menu(title: string, target: Tap | MenuItem[], opts?: ActionOptions & { checked?: boolean }): MenuItem;
  screen(title: string, content?: Array<Item | Item[] | Section>, opts?: ScreenOptions): Screen;
  section(items: Array<Item | Item[] | false | null | undefined>, opts?: { id?: string; footer?: string; style?: Section['style'] }): Section;
  section(header: string, items: Array<Item | Item[] | false | null | undefined>, opts?: { id?: string; footer?: string; style?: Section['style'] }): Section;
  nav(title: string, onTap: Tap, opts?: Common & { subtitle?: string; value?: string; icon?: Icon; badge?: string }): Item;
  toggle(title: string, on: boolean, onChange: Handler<boolean>, opts?: Common & { subtitle?: string; icon?: Icon; disabled?: boolean }): Item;
  choice(title: string, options: Array<string | { id: string; title: string }>, selected: string | undefined, onChange: Handler<string>, opts?: Common & { style?: 'menu' | 'inline' | 'segmented'; subtitle?: string; icon?: Icon; disabled?: boolean }): Item;
  slider(title: string, value: number, onChange: Handler<number>, opts?: Common & { min?: number; max?: number; step?: number; icon?: Icon; disabled?: boolean }): Item;
  stepper(title: string, value: number, onChange: Handler<number>, opts?: Common & { min?: number; max?: number; step?: number }): Item;
  field(title: string | undefined, value: string, onChange: Handler<string>, opts?: Common & { placeholder?: string; secure?: boolean; multiline?: boolean; readOnly?: boolean; keyboard?: 'default' | 'number' | 'decimal' | 'email' | 'url' | 'phone'; onSubmit?: Tap }): Item;
  button(title: string, onTap: Tap, opts?: ActionOptions & { style?: 'row' | 'prominent' | 'bordered' | 'link' }): Item;
  check(title: string, on: boolean, onChange: Handler<boolean>, opts?: Common & { subtitle?: string; radio?: boolean }): Item;
  text(text: string, opts?: Common & { style?: 'body' | 'secondary' | 'caption' | 'footnote' | 'headline' | 'title' | 'largeTitle' | 'mono' | 'display'; label?: string; copyable?: boolean }): Item;
  label(label: string, value: string, opts?: Common & { copyable?: boolean }): Item;
  heading(text: string, level?: 1 | 2 | 3 | 4 | 5 | 6, opts?: Common): Item;
  paragraph(content: string | Array<string | { text: string; bold?: boolean; italic?: boolean; code?: boolean; onTap?: Tap }>, opts?: Common & { bullet?: string; quote?: boolean }): Item;
  image(image: string, opts?: Common & { caption?: string; aspect?: number; onTap?: Tap }): Item;
  progress(value: number | undefined, opts?: Common & { title?: string; label?: string }): Item;
  item(title: string, opts?: Common & { subtitle?: string; detail?: string; meta?: string; icon?: Icon; selected?: boolean; unread?: boolean; checked?: boolean; chevron?: boolean; onTap?: Tap; menu?: MenuItem[]; swipe?: SwipeAction[]; leadingSwipe?: SwipeAction[] }): Item;
  tile(title: string, opts?: Common & { subtitle?: string; icon?: Icon; image?: string; onTap?: Tap; menu?: MenuItem[] }): Item;
  message(text: string, opts?: Common & { author?: string; time?: string; avatar?: Icon; outgoing?: boolean; images?: string[]; reactions?: string[]; system?: boolean }): Item;
  record(title: string, fields: Record<string, string | number> | Array<{ label: string; value: string }>, opts?: Common & { onTap?: Tap; menu?: MenuItem[] }): Item;
  buttons(list: Array<{ title: string; onTap: Tap } & ActionOptions>, opts?: Common): Item;
  profile(title: string, opts?: Common & { subtitle?: string; icon?: Icon; onTap?: Tap }): Item;
  divider(): Item;
};

export function discover(): { url: string; token: string };

export class PhoneApp {
  constructor(info: AppInfo, render?: (app: PhoneApp) => Screen);
  readonly viewers: number;
  render(fn: (app: PhoneApp) => Screen): this;
  push(fn: (app: PhoneApp) => Screen): void;
  pop(): void;
  sheet(fn: (app: PhoneApp) => Screen): void;
  closeSheet(): void;
  alert(spec: { title: string; message?: string; actions?: Array<{ title: string; role?: 'destructive' | 'cancel' | 'primary'; onTap?: Tap }> }): void;
  toast(text: string): void;
  /** 'open' when a phone starts showing the app, 'close' when none does, 'refresh' on pull to refresh. */
  on(event: 'open' | 'close' | 'refresh', fn: () => unknown): this;
  view(): { screens: Screen[]; sheet?: Screen; alert?: unknown };
  update(): void;
  connect(target?: { url: string; token: string }): Promise<this>;
  close(): void;
}
