/** Clean a UI Automation name for display: accelerators, shortcuts, whitespace. */
export function cleanName(raw: string): string {
  if (!raw) return '';
  let s = raw;
  // "Save\tCtrl+S" → "Save"
  const tab = s.indexOf('\t');
  if (tab >= 0) s = s.slice(0, tab);
  // Accelerator markers: "&File" → "File", "Fish && Chips" → "Fish & Chips"
  s = s
    .replace(/&&/g, '\u0000')
    .replace(/&(?=\S)/g, '')
    .replace(/\u0000/g, '&');
  // Invisible and bidi control characters some apps put in names.
  s = s.replace(/[​-‏‪-‮⁦-⁩﻿]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\.\.\.$/, '…');
  return s;
}

/** "User name:" → "User name" */
export function asLabel(s: string): string {
  return s.replace(/\s*[:：]\s*$/, '').trim();
}

/** Shorten ALL CAPS headers to Title Case; leave normal text alone. */
export function asHeader(s: string): string {
  const clean = asLabel(s);
  if (clean.length > 3 && clean === clean.toUpperCase() && /[A-Z]/.test(clean)) {
    return clean.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase());
  }
  return clean;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}

const TIME_RE =
  /^(?:(?:today|yesterday|tomorrow)(?: at)?\s*)?\d{1,2}[:.]\d{2}(?:\s?[ap]\.?m\.?)?$|^\d{1,2}\s?[ap]m$|^(?:just now|now)$|^\d+\s?(?:s|sec|m|min|h|hr|d|w|mo|y)s?(?: ago)?$|^(?:today|yesterday)$|^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}(?:,?\s+\d{1,2}[:.]\d{2}(?:\s?[ap]m)?)?$|^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:,?\s+\d{1,2}[:.]\d{2}(?:\s?[ap]m)?)?$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(?:,? \d{4})?$/i;

/** Looks like a timestamp a chat or mail app would show. */
export function isTimeLike(s: string): boolean {
  const t = s.trim().replace(/^[—–-]\s*/, '');
  return t.length <= 40 && TIME_RE.test(t);
}

const SIZE_RE = /^\d[\d.,]*\s?(?:bytes?|[KMGT]i?B|KB|MB|GB|TB)$/i;
export const isSizeLike = (s: string) => SIZE_RE.test(s.trim());

/** Friendly app names for common processes. */
const APP_NAMES: Record<string, string> = {
  chrome: 'Chrome',
  msedge: 'Edge',
  firefox: 'Firefox',
  brave: 'Brave',
  opera: 'Opera',
  vivaldi: 'Vivaldi',
  explorer: 'File Explorer',
  notepad: 'Notepad',
  winword: 'Word',
  excel: 'Excel',
  powerpnt: 'PowerPoint',
  outlook: 'Outlook',
  olk: 'Outlook',
  onenote: 'OneNote',
  'ms-teams': 'Teams',
  teams: 'Teams',
  slack: 'Slack',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  spotify: 'Spotify',
  code: 'VS Code',
  systemsettings: 'Settings',
  calculatorapp: 'Calculator',
  calculator: 'Calculator',
  mspaint: 'Paint',
  taskmgr: 'Task Manager',
  windowsterminal: 'Terminal',
  cmd: 'Command Prompt',
  powershell: 'PowerShell',
  pwsh: 'PowerShell',
  vlc: 'VLC',
  steam: 'Steam',
  obs64: 'OBS Studio',
};

export function appNameFor(process: string, windowTitle: string): string {
  const key = process.toLowerCase();
  if (APP_NAMES[key]) return APP_NAMES[key];
  if (key === 'applicationframehost') {
    // UWP apps are hosted; the window title is the app name.
    const parts = splitTitle(windowTitle);
    return parts[parts.length - 1] || windowTitle || 'App';
  }
  const parts = splitTitle(windowTitle);
  if (parts.length > 1) return parts[parts.length - 1];
  return process ? process.charAt(0).toUpperCase() + process.slice(1) : windowTitle || 'App';
}

export function splitTitle(title: string): string[] {
  return title
    .split(/\s+[-–—|]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * The document/page part of a window title, without the app name:
 * "report.docx - Word" → "report.docx", "Inbox - me@x.com - Outlook" → "Inbox".
 */
export function documentTitle(title: string, appName: string): string {
  const parts = splitTitle(title);
  if (parts.length === 0) return appName;
  const app = appName.toLowerCase();
  const filtered = parts.filter((p) => {
    const l = p.toLowerCase();
    return !(l === app || l.endsWith(app) || app.endsWith(l) || /^(google chrome|microsoft edge|mozilla firefox|personal|work)$/.test(l));
  });
  return filtered[0] ?? parts[0];
}

/** "Display is 1,234" → "1,234" (Calculator and similar "X is Y" labels). */
export function valueFromIsLabel(s: string): string | undefined {
  const m = /^(?:display|result|expression|value)\s+is\s+(.+)$/i.exec(s);
  return m ? m[1].trim() : undefined;
}
