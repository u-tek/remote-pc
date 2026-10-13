import { el, grid, win } from './dsl.js';

const XAML = { fw: 'XAML' } as const;

/** Windows 11 Settings, System › Display. */
export function settingsDisplay() {
  const nav = [
    'Home',
    'System',
    'Bluetooth & devices',
    'Network & internet',
    'Personalization',
    'Apps',
    'Accounts',
    'Time & language',
    'Gaming',
    'Accessibility',
    'Privacy & security',
    'Windows Update',
  ];
  return win(
    'SystemSettings',
    'Settings',
    [1200, 800],
    [
      el('Button', 'Back', [10, 40, 40, 40], {
        inv: 1,
        aid: 'BackButton',
        ...XAML,
      }),
      el('Text', 'Settings', [60, 50, 100, 20], XAML),
      el('Button', 'Open Navigation', [10, 90, 40, 40], { inv: 1, ...XAML }),
      el('Group', 'Alex Doe', [16, 100, 300, 90], XAML, [
        el('Image', 'Account picture', [24, 110, 64, 64], XAML),
        el('Text', 'Alex Doe', [100, 120, 200, 20], XAML),
        el('Text', 'alex@outlook.com', [100, 145, 200, 20], XAML),
      ]),
      el('Edit', 'Find a setting', [16, 200, 300, 36], {
        val: '',
        kf: 1,
        ...XAML,
      }),
      el(
        'List',
        'Navigation',
        [0, 250, 320, 540],
        { aid: 'NavigationViewMenuItems', ...XAML },
        nav.map((n, i) =>
          el('ListItem', n, [8, 250 + i * 44, 300, 40], {
            sel: n === 'System' ? 1 : 0,
            ...XAML,
          }),
        ),
      ),
      el('Pane', '', [330, 40, 860, 750], { scr: [0, 1], ...XAML }, [
        el('Group', '', [340, 50, 600, 50], { aid: 'BreadcrumbBar', ...XAML }, [
          el('ListItem', 'System', [340, 50, 120, 50], { inv: 1, ...XAML }),
          el('ListItem', 'Display', [470, 50, 140, 50], XAML),
        ]),
        el('Text', 'Brightness & color', [340, 110, 300, 20], XAML),
        el('Group', 'Brightness', [340, 135, 840, 70], XAML, [
          el('Text', 'Brightness', [360, 145, 200, 20], XAML),
          el('Text', 'Adjust the brightness of the built-in display', [360, 170, 400, 18], XAML),
          el('Slider', 'Brightness', [900, 155, 260, 30], {
            rng: [0, 100, 70, 1],
            ...XAML,
          }),
        ]),
        el('Group', 'Night light', [340, 210, 840, 70], XAML, [
          el('Text', 'Night light', [360, 220, 200, 20], XAML),
          el('Text', 'Use warmer colors to help block blue light', [360, 245, 400, 18], XAML),
          el('Text', 'Off', [1060, 235, 30, 20], XAML),
          el('Button', 'Night light', [1100, 230, 60, 30], {
            tog: 0,
            lct: 'toggle switch',
            ...XAML,
          }),
        ]),
        el('Button', 'HDR', [340, 285, 840, 70], { inv: 1, ...XAML }, [
          el('Text', 'HDR', [360, 295, 200, 20], XAML),
          el('Text', 'More about HDR', [360, 320, 300, 18], XAML),
        ]),
        el('Text', 'Scale & layout', [340, 370, 300, 20], XAML),
        el('Group', 'Scale', [340, 395, 840, 70], XAML, [
          el('Text', 'Scale', [360, 405, 200, 20], XAML),
          el('Text', 'Change the size of text, apps, and other items', [360, 430, 400, 18], XAML),
          el('ComboBox', 'Scale', [900, 415, 260, 32], {
            val: '150% (Recommended)',
            exp: 0,
            ...XAML,
          }),
        ]),
        el('Group', 'Display resolution', [340, 470, 840, 70], XAML, [
          el('Text', 'Display resolution', [360, 480, 200, 20], XAML),
          el('Text', 'Adjust the resolution to fit your connected display', [360, 505, 400, 18], XAML),
          el('ComboBox', 'Display resolution', [900, 490, 260, 32], { exp: 0, ...XAML }, [el('Text', '1920 × 1080', [910, 495, 200, 20], XAML)]),
        ]),
        el('Text', 'Related settings', [340, 560, 300, 20], XAML),
        el('Button', 'Advanced display', [340, 585, 840, 70], { inv: 1, ...XAML }, [
          el('Text', 'Advanced display', [360, 595, 200, 20], XAML),
          el('Text', 'Display information, refresh rate', [360, 620, 300, 18], XAML),
        ]),
        el('Button', 'Graphics', [340, 660, 840, 60], { inv: 1, ...XAML }),
      ]),
    ],
  );
}

/** Calculator (UWP), standard mode, "12 + 3". */
export function calculator() {
  const keys = grid(
    [
      ['Percent', 'Clear entry', 'Clear', 'Backspace'],
      ['Reciprocal', 'Square', 'Square root', 'Divide by'],
      ['Seven', 'Eight', 'Nine', 'Multiply by'],
      ['Four', 'Five', 'Six', 'Minus'],
      ['One', 'Two', 'Three', 'Plus'],
      ['Positive negative', 'Zero', 'Decimal separator', 'Equals'],
    ],
    4,
    240,
    80,
    52,
    XAML,
  );
  const byName = (names: string[]) => keys.filter((k) => names.includes(k.n!));
  return win(
    'ApplicationFrameHost',
    'Calculator',
    [328, 560],
    [
      el('Button', 'Open Navigation', [4, 36, 40, 40], { inv: 1, ...XAML }),
      el('Text', 'Standard', [50, 40, 120, 30], { aid: 'Header', ...XAML }),
      el('Button', 'Keep on top', [180, 40, 32, 32], { inv: 1, ...XAML }),
      el('Text', 'Expression is 12 +', [10, 90, 300, 20], {
        aid: 'CalculatorExpression',
        ...XAML,
      }),
      el('Text', 'Display is 3', [10, 115, 300, 60], {
        aid: 'CalculatorResults',
        ...XAML,
      }),
      el('Group', 'Memory controls', [4, 200, 320, 32], XAML, [
        el('Button', 'Clear all memory', [4, 200, 50, 30], {
          inv: 1,
          dis: 1,
          ...XAML,
        }),
        el('Button', 'Memory recall', [56, 200, 50, 30], {
          inv: 1,
          dis: 1,
          ...XAML,
        }),
        el('Button', 'Memory add', [108, 200, 50, 30], { inv: 1, ...XAML }),
        el('Button', 'Memory subtract', [160, 200, 50, 30], {
          inv: 1,
          ...XAML,
        }),
        el('Button', 'Memory store', [212, 200, 50, 30], { inv: 1, ...XAML }),
      ]),
      el(
        'Group',
        'Standard functions',
        [4, 240, 320, 104],
        XAML,
        byName(['Percent', 'Clear entry', 'Clear', 'Backspace', 'Reciprocal', 'Square', 'Square root']),
      ),
      el('Group', 'Standard operators', [244, 240, 80, 312], XAML, byName(['Divide by', 'Multiply by', 'Minus', 'Plus', 'Equals'])),
      el(
        'Group',
        'Number pad',
        [4, 344, 240, 208],
        XAML,
        byName(['Seven', 'Eight', 'Nine', 'Four', 'Five', 'Six', 'One', 'Two', 'Three', 'Positive negative', 'Zero', 'Decimal separator']),
      ),
    ],
  );
}

/** Windows 11 Notepad with one tab. */
export function notepad(extra: { popups?: ReturnType<typeof el>[] } = {}) {
  return win(
    'Notepad',
    'Untitled - Notepad',
    [900, 600],
    [
      el('MenuBar', '', [0, 70, 300, 30], { fw: 'XAML' }, [
        el('MenuItem', 'File', [0, 70, 50, 30], { exp: 0, ...XAML }),
        el('MenuItem', 'Edit', [50, 70, 50, 30], { exp: 0, ...XAML }),
        el('MenuItem', 'View', [100, 70, 50, 30], { exp: 0, ...XAML }),
      ]),
      el('Tab', '', [0, 32, 600, 38], XAML, [
        el('TabItem', 'Untitled', [0, 32, 200, 38], { sel: 1, ...XAML }),
        el('Button', 'Add New Tab', [205, 36, 30, 30], { inv: 1, ...XAML }),
      ]),
      el('Document', 'Text editor', [0, 100, 900, 470], {
        txt: 1,
        val: 'Hello world',
        tx: 'Hello world',
        cls: 'RichEditD2DPT',
        fw: 'Win32',
      }),
      el('StatusBar', '', [0, 570, 900, 30], XAML, [
        el('Text', 'Ln 1, Col 12', [10, 575, 100, 20], XAML),
        el('Text', '11 characters', [120, 575, 100, 20], XAML),
        el('Text', 'UTF-8', [800, 575, 80, 20], XAML),
      ]),
    ],
    { popups: extra.popups ?? [] },
  );
}

/** "Do you want to save changes to Untitled?" */
export function saveChangesBox() {
  return el('Window', 'Notepad', [250, 200, 400, 180], { cls: '#32770', modal: 1, fw: 'Win32' }, [
    el('Text', 'Do you want to save changes to Untitled?', [20, 40, 360, 40], { fw: 'Win32' }),
    el('Button', 'Save', [60, 120, 90, 30], { inv: 1, fw: 'Win32' }),
    el('Button', "Don't save", [160, 120, 90, 30], { inv: 1, fw: 'Win32' }),
    el('Button', 'Cancel', [260, 120, 90, 30], { inv: 1, fw: 'Win32' }),
  ]);
}

const WF = { fw: 'WinForm' } as const;

/** A WinForms login dialog; children arrive in reverse z-order like real WinForms trees. */
export function winformsLogin() {
  return win(
    'Contoso.Client',
    'Connect - Contoso',
    [420, 260],
    [
      el('Button', 'Cancel', [300, 200, 90, 30], { inv: 1, ...WF }),
      el('Button', 'OK', [200, 200, 90, 30], { inv: 1, ...WF }),
      el('CheckBox', 'Remember password', [120, 160, 200, 24], {
        tog: 1,
        ...WF,
      }),
      el('Edit', 'Password:', [120, 120, 260, 24], { val: '', pw: 1, ...WF }),
      el('Text', 'Password:', [20, 122, 90, 20], WF),
      el('Edit', 'User name:', [120, 80, 260, 24], { val: 'alex', ...WF }),
      el('Text', 'User name:', [20, 82, 90, 20], WF),
      el('ComboBox', 'Server:', [120, 40, 260, 24], { val: 'prod-1', exp: 0, ...WF }, [
        el('List', '', [120, 64, 260, 0], WF, [
          el('ListItem', 'prod-1', [0, 0, 0, 0], { sel: 1, ...WF }),
          el('ListItem', 'prod-2', [0, 0, 0, 0], { sel: 0, ...WF }),
          el('ListItem', 'staging', [0, 0, 0, 0], { sel: 0, ...WF }),
        ]),
      ]),
      el('Text', 'Server:', [20, 42, 90, 20], WF),
    ],
  );
}

const DUI = { fw: 'DirectUI' } as const;

/** File Explorer, Documents, details view. */
export function explorerDocuments() {
  const files: Array<[string, string, string, string]> = [
    ['Projects', '3/14/2024 9:12 AM', 'File folder', ''],
    ['report.docx', '3/12/2024 4:40 PM', 'Microsoft Word Document', '24 KB'],
    ['notes.txt', '3/10/2024 8:02 AM', 'Text Document', '2 KB'],
    ['budget.xlsx', '2/28/2024 1:15 PM', 'Microsoft Excel Worksheet', '18 KB'],
    ['photo.jpg', '2/02/2024 6:30 PM', 'JPG File', '3.2 MB'],
  ];
  const nav = ['Home', 'Gallery', 'OneDrive', 'Desktop', 'Downloads', 'Documents', 'Pictures', 'Music', 'Videos', 'This PC', 'Network'];
  return win(
    'explorer',
    'Documents - File Explorer',
    [1200, 760],
    [
      el('Tab', '', [0, 0, 700, 40], XAML, [
        el('TabItem', 'Documents', [0, 0, 220, 40], { sel: 1, ...XAML }),
        el('Button', 'Add New Tab', [225, 4, 32, 32], { inv: 1, ...XAML }),
      ]),
      el('Button', 'Back', [8, 48, 36, 36], { inv: 1, dis: 1, ...XAML }),
      el('Edit', 'Search Documents', [900, 48, 290, 36], { val: '', ...XAML }),
      el('ToolBar', 'Command Bar', [0, 92, 1200, 48], XAML, [
        el('SplitButton', 'New', [8, 96, 80, 40], { inv: 1, exp: 0, ...XAML }),
        el('Button', 'Cut', [100, 96, 40, 40], { inv: 1, dis: 1, ...XAML }),
        el('Button', 'Copy', [140, 96, 40, 40], { inv: 1, dis: 1, ...XAML }),
        el('Button', 'Paste', [180, 96, 40, 40], { inv: 1, ...XAML }),
        el('Button', 'Rename', [220, 96, 40, 40], { inv: 1, dis: 1, ...XAML }),
        el('Button', 'Share', [260, 96, 40, 40], { inv: 1, dis: 1, ...XAML }),
        el('Button', 'Delete', [300, 96, 40, 40], { inv: 1, dis: 1, ...XAML }),
        el('Button', 'Sort', [360, 96, 70, 40], { inv: 1, exp: 0, ...XAML }),
        el('Button', 'View', [430, 96, 70, 40], { inv: 1, exp: 0, ...XAML }),
      ]),
      el(
        'Tree',
        'Navigation Pane',
        [0, 150, 250, 580],
        { cls: 'SysTreeView32', fw: 'Win32' },
        nav.map((n, i) =>
          el('TreeItem', n, [8, 150 + i * 32, 230, 30], {
            sel: n === 'Documents' ? 1 : 0,
            exp: n === 'This PC' ? 0 : 3,
            fw: 'Win32',
          }),
        ),
      ),
      el('List', 'Items View', [260, 150, 930, 560], { aid: 'ItemsView', scr: [0, 0], ...DUI }, [
        el(
          'Header',
          '',
          [260, 150, 930, 30],
          DUI,
          ['Name', 'Date modified', 'Type', 'Size'].map((h, i) => el('HeaderItem', h, [260 + i * 200, 150, 200, 30], DUI)),
        ),
        ...files.map(([name, date, type, size], i) =>
          el('ListItem', name, [260, 182 + i * 30, 930, 30], { sel: 0, ...DUI }, [
            el('Image', '', [264, 186 + i * 30, 20, 20], DUI),
            el('Edit', 'Name', [290, 182 + i * 30, 190, 30], {
              val: name,
              ro: 1,
              ...DUI,
            }),
            el('Edit', 'Date modified', [480, 182 + i * 30, 190, 30], {
              val: date,
              ro: 1,
              ...DUI,
            }),
            el('Edit', 'Type', [680, 182 + i * 30, 190, 30], {
              val: type,
              ro: 1,
              ...DUI,
            }),
            el('Edit', 'Size', [880, 182 + i * 30, 100, 30], {
              val: size,
              ro: 1,
              ...DUI,
            }),
          ]),
        ),
      ]),
      el('StatusBar', '', [0, 730, 1200, 30], DUI, [el('Text', '5 items', [8, 735, 100, 20], DUI)]),
    ],
  );
}

const WEB = { fw: 'Chrome' } as const;

/** A web page's content (as an Electron app or a browser tab would expose it). */
export function webArticle() {
  return win(
    'someapp',
    'Getting started - Some App',
    [1000, 800],
    [
      el('Document', 'Getting started', [0, 40, 1000, 760], { ...WEB, txt: 1 }, [
        el('Text', 'Getting started', [40, 60, 600, 40], {
          lct: 'heading',
          lvl: 1,
          ...WEB,
        }),
        el('Group', '', [40, 110, 900, 40], WEB, [
          el('Text', 'This guide shows you how to set up your first project. Read the', [40, 110, 600, 20], WEB),
          el('Hyperlink', 'installation notes', [640, 110, 140, 20], {
            inv: 1,
            ...WEB,
          }),
          el('Text', 'first.', [780, 110, 40, 20], WEB),
        ]),
        el('List', '', [40, 160, 900, 80], WEB, [
          el('ListItem', '', [40, 160, 900, 20], WEB, [el('Text', 'Install the app', [60, 160, 300, 20], WEB)]),
          el('ListItem', '', [40, 185, 900, 20], WEB, [
            el('Hyperlink', 'Create an account', [60, 185, 300, 20], {
              inv: 1,
              ...WEB,
            }),
          ]),
        ]),
        el('Image', 'Screenshot of the dashboard', [40, 250, 800, 400], WEB),
        el('Button', 'Continue', [40, 670, 120, 36], { inv: 1, ...WEB }),
      ]),
    ],
  );
}

/** A game or video player: nothing readable. */
export function opaqueGame() {
  return win('game', 'Space Game', [1280, 720], [el('Pane', '', [0, 32, 1280, 688], { cls: 'UnityWndClass', fw: 'Win32' })]);
}
