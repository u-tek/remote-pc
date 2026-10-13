import { browser } from './browser.js';
import { chat } from './chat.js';
import { explorer } from './explorer.js';
import { office } from './office.js';
import { settings } from './settings.js';
import type { Adapter } from './types.js';

/** Hand-tuned adapters, most specific first. Everything else gets the generic rules. */
export function defaultAdapters(): Adapter[] {
  return [browser, chat, explorer, settings, office];
}
