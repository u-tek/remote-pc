/**
 * Phone UI protocol, version 1.
 *
 * Every app shown on the phone — rewritten automatically from Windows UI Automation, hand-tuned
 * by an adapter, or written with the SDK — is described with these types. The phone renders them
 * with real iOS controls. The phone never interprets what an action does on the PC: it sends the
 * action's `ref` (plus a value for inputs) back, and whoever produced the view handles it.
 *
 * This file is the source of truth for sdk/PROTOCOL.md and ios/.../PhoneUI.swift.
 */

export const PROTOCOL_VERSION = 1;

/** Everything the phone needs to draw one app. Sent whole whenever it changes. */
export interface AppView {
  v: 1;
  app: AppInfo;
  /** Navigation stack, root first. The phone pushes/pops with native animations when it changes. */
  screens: Screen[];
  /** A dialog or popup, shown as a sheet above the stack. */
  sheet?: Screen;
  /** A simple message box. */
  alert?: Alert;
  /** A short message shown briefly at the bottom. */
  toast?: string;
}

export interface AppInfo {
  id: string;
  name: string;
  icon?: Icon;
  /** Accent color for the app's controls: a named color (see Icon.color) or #RRGGBB. */
  tint?: string;
  /** Where the UI came from. */
  source: 'auto' | 'adapter' | 'sdk';
  adapter?: string;
}

export type ScreenStyle =
  | 'form' // grouped settings-style list
  | 'list' // plain list (files, mail, search results)
  | 'grid' // tiles
  | 'chat' // message bubbles with a composer
  | 'article' // readable flowing content (web pages, emails)
  | 'document' // a text document that can be edited
  | 'browser'; // article plus an address bar and browser toolbar

export interface Screen {
  /** Stable while the screen is "the same place"; a new id means a new screen. */
  id: string;
  title: string;
  subtitle?: string;
  style?: ScreenStyle;
  largeTitle?: boolean;
  search?: SearchField;
  /** Segmented control under the title (an app's tabs). */
  segments?: Segments;
  /** Navigation bar buttons; the phone shows up to two and folds the rest into the ⋯ menu. */
  actions?: Action[];
  /** The ⋯ menu: menu bar, ribbon, overflow commands. */
  menu?: MenuItem[];
  /** Bottom toolbar (browser back/forward, formatting tools). */
  bottomBar?: Action[];
  sections: Section[];
  /** Message box pinned to the bottom (chat apps, quick input). */
  composer?: Composer;
  /** The list continues: the phone triggers this when the user nears the end. */
  more?: Action;
  /** Sent when the user leaves this screen with Back (an app's own back button). */
  back?: Action;
  /** Address bar for browser-style screens. */
  address?: Address;
  /** Body text for document-style screens. */
  document?: DocumentBody;
  /** Shown when there are no sections. */
  empty?: { title: string; message?: string; symbol?: string };
  /** Pull to refresh sends this. */
  refresh?: Action;
}

export interface Section {
  id: string;
  header?: string;
  footer?: string;
  /** grouped = inset rounded group (default), plain = edge to edge, grid = tiles, cards = large cards. */
  style?: 'grouped' | 'plain' | 'grid' | 'cards';
  items: Item[];
}

export type Item =
  | NavItem
  | ToggleItem
  | ChoiceItem
  | SliderItem
  | StepperItem
  | FieldItem
  | ButtonItem
  | CheckItem
  | TextItem
  | HeadingItem
  | ParagraphItem
  | ImageItem
  | ProgressItem
  | ListItem
  | TileItem
  | MessageItem
  | RecordItem
  | KeypadItem
  | ButtonRowItem
  | ProfileItem
  | LiveItem
  | DividerItem;

interface Base {
  /** Stable id (used for animations and optimistic updates). */
  id: string;
}

/** A row that opens something (settings category, folder, channel). */
export interface NavItem extends Base {
  kind: 'nav';
  title: string;
  subtitle?: string;
  /** Trailing value, e.g. "On" or "Wi-Fi name". */
  value?: string;
  icon?: Icon;
  badge?: string;
  selected?: boolean;
  /** Nesting level (folder trees in a sidebar). */
  level?: number;
  tap: Action;
}

export interface ToggleItem extends Base {
  kind: 'toggle';
  title: string;
  subtitle?: string;
  icon?: Icon;
  on: boolean;
  /** Sent with value true/false. */
  ref: string;
  disabled?: boolean;
}

export interface Choice {
  id: string;
  title: string;
  symbol?: string;
  /** If set, choosing this option sends this ref instead of the item's ref + option id. */
  ref?: string;
}

/** Pick one of several options (combo box, radio group, dropdown). */
export interface ChoiceItem extends Base {
  kind: 'choice';
  title: string;
  subtitle?: string;
  icon?: Icon;
  /** Text of the current value, shown even before options are known. */
  value?: string;
  options?: Choice[];
  selected?: string;
  /** Sent with the chosen option id as value. */
  ref: string;
  /** Options are not known yet: send this to have them filled in. */
  load?: Action;
  style?: 'menu' | 'inline' | 'segmented';
  disabled?: boolean;
}

export interface SliderItem extends Base {
  kind: 'slider';
  title: string;
  icon?: Icon;
  min: number;
  max: number;
  step?: number;
  value: number;
  ref: string;
  disabled?: boolean;
}

export interface StepperItem extends Base {
  kind: 'stepper';
  title: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  ref: string;
}

export interface FieldItem extends Base {
  kind: 'field';
  title?: string;
  placeholder?: string;
  value: string;
  /** Sent with the new text when editing ends (and while typing for search-like fields). */
  ref: string;
  secure?: boolean;
  multiline?: boolean;
  readOnly?: boolean;
  keyboard?: 'default' | 'number' | 'decimal' | 'email' | 'url' | 'phone';
  /** Return key / submit button. */
  submit?: Action;
}

export interface ButtonItem extends Base {
  kind: 'button';
  action: Action;
  /** row = full-width list row, prominent = filled button, bordered = outlined, link = text link. */
  style?: 'row' | 'prominent' | 'bordered' | 'link';
}

/** Checkbox or radio button shown as a checkmark row. */
export interface CheckItem extends Base {
  kind: 'check';
  title: string;
  subtitle?: string;
  on: boolean;
  ref: string;
  radio?: boolean;
  disabled?: boolean;
}

export interface TextItem extends Base {
  kind: 'text';
  text: string;
  /** display = very large, trailing-aligned figures (calculator result). */
  style?: 'body' | 'secondary' | 'caption' | 'footnote' | 'headline' | 'title' | 'largeTitle' | 'mono' | 'display';
  /** Optional label in front of the value, like "Version   23H2". */
  label?: string;
  /** Long-press copies the text. */
  copyable?: boolean;
}

export interface HeadingItem extends Base {
  kind: 'heading';
  text: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface Run {
  text: string;
  link?: Action;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

/** Flowing rich text with inline links (web pages, emails). */
export interface ParagraphItem extends Base {
  kind: 'paragraph';
  runs: Run[];
  /** Bulleted or numbered list entry. */
  bullet?: string;
  quote?: boolean;
}

export interface ImageItem extends Base {
  kind: 'image';
  /** Image URL on the agent (relative), e.g. /api/ui/image?... */
  image: string;
  caption?: string;
  /** width / height */
  aspect?: number;
  tap?: Action;
}

export interface ProgressItem extends Base {
  kind: 'progress';
  title?: string;
  /** 0…1; omit for an indeterminate spinner. */
  value?: number;
  label?: string;
}

/** A row in a list: file, email, search result, process, song… */
export interface ListItem extends Base {
  kind: 'item';
  title: string;
  subtitle?: string;
  /** Second line of secondary text (email preview). */
  detail?: string;
  /** Small trailing text, usually a date or size. */
  meta?: string;
  icon?: Icon;
  selected?: boolean;
  unread?: boolean;
  checked?: boolean;
  /** Show a disclosure chevron (tapping goes deeper). */
  chevron?: boolean;
  tap?: Action;
  /** Long-press / secondary actions. */
  menu?: MenuItem[];
  /** Trailing swipe actions (first is the full-swipe action). */
  swipe?: Action[];
  /** Leading swipe actions. */
  leadingSwipe?: Action[];
  /** Nesting level in a tree (0 = top). */
  level?: number;
  /** Tree rows: whether the row's children are showing; `expand` toggles it. */
  expanded?: boolean;
  expand?: Action;
}

export interface TileItem extends Base {
  kind: 'tile';
  title: string;
  subtitle?: string;
  icon?: Icon;
  image?: string;
  tap?: Action;
  menu?: MenuItem[];
}

export interface MessageItem extends Base {
  kind: 'message';
  text: string;
  author?: string;
  time?: string;
  avatar?: Icon;
  /** Sent by the PC's user (drawn on the right). */
  outgoing?: boolean;
  images?: string[];
  reactions?: string[];
  replyTo?: string;
  /** Join/leave notices, date separators. */
  system?: boolean;
  menu?: MenuItem[];
}

/** A table row shown as a card of label/value pairs. */
export interface RecordItem extends Base {
  kind: 'record';
  title: string;
  fields: Array<{ label: string; value: string }>;
  tap?: Action;
  menu?: MenuItem[];
}

/**
 * A grid of buttons laid out like the original (calculator, dial pad, numeric keypad).
 * rows[r][c]; null leaves a gap. span > 1 makes a cell wider.
 */
export interface KeypadItem extends Base {
  kind: 'keypad';
  rows: Array<Array<KeypadKey | null>>;
}

export interface KeypadKey extends Action {
  span?: number;
  /** primary = digits, secondary = functions, accent = operators and equals. */
  tone?: 'primary' | 'secondary' | 'accent';
}

/** A short row of buttons side by side (OK / Cancel / Apply, memory keys, quick actions). */
export interface ButtonRowItem extends Base {
  kind: 'buttons';
  actions: Action[];
}

/** The big "account" row at the top of Settings-like screens. */
export interface ProfileItem extends Base {
  kind: 'profile';
  title: string;
  subtitle?: string;
  icon?: Icon;
  tap?: Action;
}

/**
 * Part of the window that cannot be rebuilt natively (video, canvas, game), embedded as a
 * live picture. Touches on it are forwarded to that area on the PC.
 */
export interface LiveItem extends Base {
  kind: 'live';
  /** Opaque region token for the agent. */
  region: string;
  aspect: number;
  caption?: string;
  /** The whole window is live: the phone plays the window's real-time video stream instead of pictures. */
  stream?: { hwnd: number };
}

export interface DividerItem extends Base {
  kind: 'divider';
}

export interface Icon {
  /** SF Symbol name. */
  symbol?: string;
  /** Image URL on the agent (app icons, avatars, thumbnails). */
  image?: string;
  /** Initials for avatar circles. */
  text?: string;
  /** blue, green, red, orange, yellow, pink, purple, indigo, teal, cyan, mint, brown, gray, or #RRGGBB. */
  color?: string;
  /** tile = white symbol on a colored rounded square (iOS Settings), circle = avatar, plain = tinted symbol. */
  style?: 'tile' | 'circle' | 'plain';
}

export interface Action {
  /** Opaque token sent back to the agent. */
  ref: string;
  title?: string;
  symbol?: string;
  role?: 'destructive' | 'cancel' | 'primary';
  disabled?: boolean;
  /** Ask "Are you sure?" with this text first. */
  confirm?: string;
  /** Value sent with the ref (for fixed-value actions). */
  value?: string | number | boolean;
}

export interface MenuItem {
  title: string;
  symbol?: string;
  action?: Action;
  children?: MenuItem[];
  /** Children are not known yet: send this to have them filled in (lazy submenus). */
  load?: Action;
  checked?: boolean;
  role?: 'destructive';
  disabled?: boolean;
}

export interface SearchField {
  ref: string;
  placeholder: string;
  value: string;
  submit?: Action;
}

export interface Segments {
  items: Choice[];
  selected?: string;
  /** Sent with the chosen id when a choice has no ref of its own. */
  ref?: string;
}

export interface Composer {
  /** Sent with the text to send. */
  ref: string;
  placeholder: string;
  value?: string;
  attach?: Action;
}

export interface Address {
  value: string;
  /** Sent with the new address when the user edits it. */
  ref: string;
  secure?: boolean;
  title?: string;
}

export interface DocumentBody {
  text: string;
  /** If set, the user can edit; the full new text is sent with this ref. */
  ref?: string;
  /** Typing at the PC's cursor instead of replacing the text (rich documents). */
  typeRef?: string;
  format?: 'plain' | 'markdown';
}

export interface Alert {
  title: string;
  message?: string;
  actions: Action[];
}

// ---------- messages ----------

/** Phone → agent. */
export type ClientMessage = { type: 'action'; ref: string; value?: unknown } | { type: 'pop'; depth: number } | { type: 'refresh' } | { type: 'dismiss' };

/** Agent → phone. */
export type ServerMessage =
  | { type: 'view'; view: AppView }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | { type: 'ended'; message: string };

/** Entry in the phone's app list. */
export interface AppSummary {
  id: string;
  name: string;
  /** Window title or a short description. */
  title?: string;
  icon?: Icon;
  kind: 'window' | 'sdk' | 'system';
  /** Adapter that will draw it, if any ("browser", "chat", …). */
  adapter?: string;
  running: boolean;
  focused?: boolean;
}
