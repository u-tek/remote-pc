import { HttpError } from '../http.js';

/** Windows virtual-key codes for the names the phone sends. */
export const VK: Record<string, number> = {
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  shift: 0x10,
  ctrl: 0x11,
  alt: 0x12,
  pause: 0x13,
  capslock: 0x14,
  esc: 0x1b,
  space: 0x20,
  pageup: 0x21,
  pagedown: 0x22,
  end: 0x23,
  home: 0x24,
  left: 0x25,
  up: 0x26,
  right: 0x27,
  down: 0x28,
  printscreen: 0x2c,
  insert: 0x2d,
  delete: 0x2e,
  win: 0x5b,
  menu: 0x5d,
  volumemute: 0xad,
  volumedown: 0xae,
  volumeup: 0xaf,
  nexttrack: 0xb0,
  prevtrack: 0xb1,
  playpause: 0xb3,
};
for (let i = 0; i < 26; i++) VK[String.fromCharCode(97 + i)] = 0x41 + i;
for (let i = 0; i <= 9; i++) VK[String(i)] = 0x30 + i;
for (let i = 1; i <= 12; i++) VK[`f${i}`] = 0x70 + i - 1;
Object.assign(VK, {
  ';': 0xba,
  '=': 0xbb,
  ',': 0xbc,
  '-': 0xbd,
  '.': 0xbe,
  '/': 0xbf,
  '`': 0xc0,
  '[': 0xdb,
  '\\': 0xdc,
  ']': 0xdd,
  "'": 0xde,
});

/** Turn ["ctrl", "shift", "esc"] into virtual-key codes, pressed in that order. */
export function keyCodes(names: unknown): number[] {
  if (!Array.isArray(names) || names.length === 0 || names.length > 6) throw new HttpError(400, 'keys must be a list of 1-6 key names');
  return names.map((n) => {
    const code = VK[String(n).toLowerCase()];
    if (code === undefined) throw new HttpError(400, `Unknown key: ${n}`);
    return code;
  });
}
