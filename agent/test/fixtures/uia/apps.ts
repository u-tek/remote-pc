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

const CH = { fw: 'Chrome' } as const;
const VIEWS = { fw: 'Views' } as const;

/** Chrome with two tabs on an article. */
export function chromeArticle() {
  return win(
    'chrome',
    'Rust 1.80 released - The Rust Blog - Google Chrome',
    [1280, 900],
    [
      el('Pane', 'Google Chrome', [0, 0, 1280, 90], VIEWS, [
        el('Tab', '', [0, 0, 900, 40], VIEWS, [
          el('TabItem', 'Rust 1.80 released - The Rust Blog', [0, 0, 240, 40], { sel: 1, ...VIEWS }, [
            el('Image', '', [10, 12, 16, 16], VIEWS),
            el('Button', 'Close', [210, 10, 20, 20], { inv: 1, ...VIEWS }),
          ]),
          el('TabItem', 'Inbox (3) - Gmail', [240, 0, 240, 40], { sel: 0, ...VIEWS }, [el('Button', 'Close', [450, 10, 20, 20], { inv: 1, ...VIEWS })]),
          el('Button', 'New Tab', [490, 6, 28, 28], { inv: 1, ...VIEWS }),
        ]),
        el('ToolBar', '', [0, 40, 1280, 50], VIEWS, [
          el('Button', 'Back', [8, 46, 36, 36], { inv: 1, ...VIEWS }),
          el('Button', 'Forward', [48, 46, 36, 36], { inv: 1, dis: 1, ...VIEWS }),
          el('Button', 'Reload', [88, 46, 36, 36], { inv: 1, ...VIEWS }),
          el('Edit', 'Address and search bar', [140, 48, 900, 32], { val: 'blog.rust-lang.org/2024/07/25/Rust-1.80.0.html', ...VIEWS }),
          el('Button', 'Chrome', [1240, 46, 36, 36], { inv: 1, exp: 0, ...VIEWS }),
        ]),
      ]),
      el('Document', 'Rust 1.80 released', [0, 90, 1280, 810], { val: 'https://blog.rust-lang.org/2024/07/25/Rust-1.80.0.html', ...CH }, [
        el('Text', 'Announcing Rust 1.80.0', [200, 120, 800, 48], { lct: 'heading', ...CH }),
        el('Group', '', [200, 180, 800, 60], CH, [
          el('Text', 'The Rust team is happy to announce a new version of Rust, 1.80.0. You can get it with', [200, 180, 700, 20], CH),
          el('Hyperlink', 'rustup', [900, 180, 60, 20], { inv: 1, ...CH }),
          el('Text', '.', [960, 180, 6, 20], CH),
        ]),
        el('Text', "What's in 1.80.0 stable", [200, 260, 800, 32], { lct: 'heading', ...CH }),
        el('Text', 'LazyCell and LazyLock are new "lazy" types that delay initialization of their data until first access.', [200, 300, 800, 40], CH),
      ]),
    ],
  );
}

/** Discord: servers, channels, messages and the message box. */
export function discordChannel() {
  const channels = ['welcome (text channel)', 'general (text channel)', 'random (text channel)', 'Lounge (voice channel)'];
  return win(
    'Discord',
    '#general | Rust Friends - Discord',
    [1400, 900],
    [
      el('Document', 'Discord', [0, 32, 1400, 868], CH, [
        el('Tree', 'Servers sidebar', [0, 40, 72, 860], CH, [
          el('TreeItem', 'Rust Friends', [12, 60, 48, 48], { sel: 1, ...CH }),
          el('TreeItem', 'Home', [12, 120, 48, 48], { sel: 0, ...CH }),
        ]),
        el(
          'List',
          'Channels',
          [72, 90, 240, 700],
          CH,
          channels.map((c, i) => el('ListItem', c, [80, 100 + i * 34, 220, 32], { sel: c.startsWith('general') ? 1 : 0, ...CH })),
        ),
        el('Group', 'User area', [72, 840, 240, 52], CH, [
          el('Image', 'avatar', [80, 848, 32, 32], CH),
          el('Text', 'alex', [120, 848, 100, 18], CH),
          el('Text', 'Online', [120, 866, 100, 16], CH),
        ]),
        el('Text', 'general', [330, 46, 200, 24], { lct: 'heading', ...CH }),
        el('Button', 'Start Voice Call', [1200, 44, 32, 32], { inv: 1, ...CH }),
        el('List', 'Messages in general', [320, 90, 1080, 690], CH, [
          el('Group', '', [320, 100, 1080, 24], CH, [el('Text', 'January 5, 2024', [800, 100, 120, 20], CH)]),
          el('ListItem', '', [320, 130, 1080, 60], CH, [
            el('Image', 'Sam', [336, 136, 40, 40], CH),
            el('Hyperlink', 'Sam', [392, 134, 40, 20], { inv: 1, ...CH }),
            el('Text', 'Today at 3:14 PM', [440, 136, 120, 16], CH),
            el('Text', 'anyone tried the new LazyLock?', [392, 158, 400, 20], CH),
          ]),
          el('ListItem', '', [320, 192, 1080, 24], CH, [el('Text', 'it replaces once_cell for me', [392, 194, 400, 20], CH)]),
          el('ListItem', '', [320, 220, 1080, 70], CH, [
            el('Image', 'alex', [336, 226, 40, 40], CH),
            el('Hyperlink', 'alex', [392, 224, 40, 20], { inv: 1, ...CH }),
            el('Text', 'Today at 3:16 PM', [440, 226, 120, 16], CH),
            el('Text', 'yes! works great', [392, 248, 400, 20], CH),
            el('Button', '👍, 2 reactions, press to react', [392, 270, 40, 20], { inv: 1, ...CH }),
          ]),
        ]),
        el('Button', 'Upload a File', [330, 812, 32, 32], { inv: 1, ...CH }),
        el('Edit', 'Message #general', [370, 806, 1000, 44], { val: '', kf: 1, ...CH }),
      ]),
    ],
  );
}

/** Word with a short document. */
export function wordDocument() {
  return win(
    'WINWORD',
    'Report.docx - Word',
    [1400, 900],
    [
      el('Pane', 'Ribbon', [0, 32, 1400, 150], { aid: 'Ribbon', fw: 'Win32' }, [
        el('Tab', 'Ribbon Tabs', [0, 32, 1400, 30], { fw: 'Win32' }, [
          el('TabItem', 'Home', [60, 32, 60, 30], { sel: 1, fw: 'Win32' }),
          el('TabItem', 'Insert', [120, 32, 60, 30], { sel: 0, fw: 'Win32' }),
        ]),
        el('ToolBar', 'Lower Ribbon', [0, 62, 1400, 120], { fw: 'Win32' }, [
          el('Group', 'Clipboard', [0, 62, 120, 120], { fw: 'Win32' }, [
            el('SplitButton', 'Paste', [4, 66, 50, 80], { inv: 1, exp: 0, fw: 'Win32' }),
            el('Button', 'Cut', [60, 66, 50, 24], { inv: 1, fw: 'Win32' }),
          ]),
          el('Group', 'Font', [120, 62, 300, 120], { fw: 'Win32' }, [
            el('Button', 'Bold', [124, 120, 24, 24], { tog: 0, fw: 'Win32' }),
            el('Button', 'Italic', [150, 120, 24, 24], { tog: 1, fw: 'Win32' }),
            el('Button', 'Underline', [176, 120, 24, 24], { tog: 0, fw: 'Win32' }),
          ]),
        ]),
      ]),
      el('Document', 'Page 1 content', [100, 190, 1200, 680], { cls: '_WwG', txt: 1, tx: 'Quarterly report\rSales grew 12%.', fw: 'Win32' }),
    ],
  );
}

/** Excel with a small table. */
export function excelSheet() {
  const cells: Array<[string, string]> = [
    ['A1', 'Name'],
    ['B1', 'Amount'],
    ['A2', 'Coffee'],
    ['B2', '4.50'],
    ['A3', 'Lunch'],
    ['B3', '12.00'],
  ];
  return win(
    'EXCEL',
    'Budget.xlsx - Excel',
    [1400, 900],
    [
      el('Edit', 'Name Box', [0, 190, 100, 24], { val: 'A2', fw: 'Win32' }),
      el('Edit', 'Formula Bar', [120, 190, 1200, 24], { val: 'Coffee', fw: 'Win32' }),
      el(
        'DataGrid',
        'Grid',
        [0, 220, 1400, 600],
        { fw: 'Win32' },
        cells.map(([n, v], i) =>
          el('DataItem', `${n}`, [(i % 2) * 100, 220 + Math.floor(i / 2) * 20, 100, 20], { val: v, sel: n === 'A2' ? 1 : 0, fw: 'Win32' }),
        ),
      ),
      el('TabItem', 'Sheet1', [0, 840, 80, 24], { sel: 1, fw: 'Win32' }),
      el('TabItem', 'Sheet2', [80, 840, 80, 24], { sel: 0, fw: 'Win32' }),
    ],
  );
}
