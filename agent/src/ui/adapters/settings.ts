import { findAll } from '../rules/tree.js';
import type { Item, Section } from '../schema.js';
import { ref } from '../uia.js';
import type { Adapter } from './types.js';

/** Windows Settings: already iOS-shaped; shows search results natively and keeps Settings blue. */
export const settings: Adapter = {
  id: 'settings',
  label: 'Settings',
  matches: (w) => /^systemsettings$/i.test(w.process) || (/^applicationframehost$/i.test(w.process) && /^settings$/i.test(w.title)),

  view(_snap, base) {
    const root = base.source.root;
    // Typing in "Find a setting" opens a suggestion list; show it at the top of the sidebar.
    const suggestions = findAll(
      root,
      (n) => n.t === 'ListItem' && Boolean(n.name) && /suggest|search/i.test(`${n.parent?.name ?? ''} ${n.parent?.raw.aid ?? ''}`),
    );
    let home = base.home;
    if (home && suggestions.length) {
      const results: Section = {
        id: 'results',
        header: 'Results',
        items: suggestions.slice(0, 12).map((s): Item => ({ id: s.id, kind: 'nav', title: s.name, tap: { ref: ref('nav', s.id) } })),
      };
      home = { ...home, sections: [results, ...home.sections] };
    }
    return { ...base, app: { ...base.app, tint: 'blue' }, home };
  },
};
