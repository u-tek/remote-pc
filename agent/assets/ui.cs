// UI Automation side of the Remote PC agent: reads any window's accessibility tree in one
// cross-process call (cache request), serializes it compactly for the rules engine, and performs
// actions on controls through UI Automation patterns, falling back to real input only when needed.
// Compiled together with helper.cs (for Input and Win.Init); C# 5 so Windows PowerShell can build it.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

namespace RemotePC
{
    public static class Ui
    {
        [StructLayout(LayoutKind.Sequential)]
        struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

        delegate bool EnumProc(IntPtr h, IntPtr l);

        [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
        [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action, uint param, IntPtr vparam, uint winIni);
        [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmGetWindowRect(IntPtr h, int attr, out RECT val, int size);

        const int NODE_BUDGET = 4000;
        const int POPUP_BUDGET = 800;
        const int MAX_DEPTH = 48;
        const int MAX_VALUE = 4000;
        const int MAX_TEXT = 200000;

        static CacheRequest request;
        static readonly object gate = new object();
        /// Elements from the latest snapshots by runtime id, so actions don't need to search.
        static Dictionary<string, AutomationElement> elements = new Dictionary<string, AutomationElement>();
        static readonly Dictionary<long, CapturedWindow> captures = new Dictionary<long, CapturedWindow>();

        class CapturedWindow
        {
            public Bitmap Bitmap;
            public DateTime At;
        }

        static readonly AutomationProperty[] Props = new AutomationProperty[]
        {
            AutomationElement.RuntimeIdProperty,
            AutomationElement.ControlTypeProperty,
            AutomationElement.NameProperty,
            AutomationElement.AutomationIdProperty,
            AutomationElement.ClassNameProperty,
            AutomationElement.FrameworkIdProperty,
            AutomationElement.LocalizedControlTypeProperty,
            AutomationElement.BoundingRectangleProperty,
            AutomationElement.IsEnabledProperty,
            AutomationElement.IsOffscreenProperty,
            AutomationElement.HasKeyboardFocusProperty,
            AutomationElement.IsKeyboardFocusableProperty,
            AutomationElement.IsPasswordProperty,
            AutomationElement.HelpTextProperty,
            AutomationElement.ItemStatusProperty,
            AutomationElement.AcceleratorKeyProperty,
            AutomationElement.NativeWindowHandleProperty,
            AutomationElement.IsInvokePatternAvailableProperty,
            AutomationElement.IsValuePatternAvailableProperty,
            AutomationElement.IsTogglePatternAvailableProperty,
            AutomationElement.IsSelectionItemPatternAvailableProperty,
            AutomationElement.IsExpandCollapsePatternAvailableProperty,
            AutomationElement.IsRangeValuePatternAvailableProperty,
            AutomationElement.IsScrollPatternAvailableProperty,
            AutomationElement.IsScrollItemPatternAvailableProperty,
            AutomationElement.IsTextPatternAvailableProperty,
            AutomationElement.IsGridPatternAvailableProperty,
            AutomationElement.IsSelectionPatternAvailableProperty,
            AutomationElement.IsWindowPatternAvailableProperty,
            ValuePattern.ValueProperty,
            ValuePattern.IsReadOnlyProperty,
            TogglePattern.ToggleStateProperty,
            SelectionItemPattern.IsSelectedProperty,
            ExpandCollapsePattern.ExpandCollapseStateProperty,
            RangeValuePattern.MinimumProperty,
            RangeValuePattern.MaximumProperty,
            RangeValuePattern.ValueProperty,
            RangeValuePattern.SmallChangeProperty,
            RangeValuePattern.IsReadOnlyProperty,
            ScrollPattern.VerticalScrollPercentProperty,
            ScrollPattern.VerticallyScrollableProperty,
            GridPattern.RowCountProperty,
            GridPattern.ColumnCountProperty,
            SelectionPattern.CanSelectMultipleProperty,
            WindowPattern.IsModalProperty,
        };

        static CacheRequest Request()
        {
            if (request != null) return request;
            CacheRequest r = new CacheRequest();
            r.TreeScope = TreeScope.Subtree;
            r.TreeFilter = Automation.ControlViewCondition;
            r.AutomationElementMode = AutomationElementMode.Full;
            foreach (AutomationProperty p in Props) r.Add(p);
            request = r;
            return r;
        }

        /// Tell apps a screen reader is running so Chromium/Electron build their full accessibility trees.
        public static bool ScreenReaderFlag(bool on)
        {
            // SPI_SETSCREENREADER = 0x0047, SPIF_SENDCHANGE = 0x2
            return SystemParametersInfo(0x0047, on ? 1u : 0u, IntPtr.Zero, 0x2);
        }

        // ---------------- snapshot ----------------

        static object Cached(AutomationElement e, AutomationProperty p)
        {
            try
            {
                object v = e.GetCachedPropertyValue(p, true);
                if (v == AutomationElement.NotSupported) return null;
                return v;
            }
            catch
            {
                return null;
            }
        }

        static bool Flag(AutomationElement e, AutomationProperty p)
        {
            object v = Cached(e, p);
            return v is bool && (bool)v;
        }

        static string Str(AutomationElement e, AutomationProperty p)
        {
            object v = Cached(e, p);
            return v as string;
        }

        static string IdOf(AutomationElement e)
        {
            int[] rid = Cached(e, AutomationElement.RuntimeIdProperty) as int[];
            if (rid == null || rid.Length == 0) return null;
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < rid.Length; i++)
            {
                if (i > 0) sb.Append('.');
                sb.Append(rid[i].ToString(CultureInfo.InvariantCulture));
            }
            return sb.ToString();
        }

        static void Esc(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        static void Key(StringBuilder sb, string k)
        {
            sb.Append(',').Append('"').Append(k).Append("\":");
        }

        static void Prop(StringBuilder sb, string k, string v)
        {
            if (string.IsNullOrEmpty(v)) return;
            Key(sb, k);
            Esc(sb, v);
        }

        static void One(StringBuilder sb, string k, bool v)
        {
            if (!v) return;
            Key(sb, k);
            sb.Append('1');
        }

        static string Num(double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d)) return "0";
            return Math.Round(d, 3).ToString(CultureInfo.InvariantCulture);
        }

        static string Clip(string s, int max)
        {
            if (s == null) return null;
            return s.Length > max ? s.Substring(0, max) : s;
        }

        class Walk
        {
            public int Budget;
            public bool Truncated;
            public double Ox;
            public double Oy;
            public Dictionary<string, AutomationElement> Map;
        }

        static void Node(StringBuilder sb, AutomationElement e, Walk w, int depth)
        {
            w.Budget--;
            string id = IdOf(e) ?? ("x" + w.Budget.ToString(CultureInfo.InvariantCulture));
            w.Map[id] = e;

            ControlType ct = Cached(e, AutomationElement.ControlTypeProperty) as ControlType;
            string t = ct == null ? "Custom" : ct.ProgrammaticName;
            if (t.StartsWith("ControlType.")) t = t.Substring(12);

            sb.Append("{\"id\":");
            Esc(sb, id);
            Key(sb, "t");
            Esc(sb, t);
            Prop(sb, "n", Clip(Str(e, AutomationElement.NameProperty), 1000));
            Prop(sb, "aid", Str(e, AutomationElement.AutomationIdProperty));
            Prop(sb, "cls", Str(e, AutomationElement.ClassNameProperty));
            Prop(sb, "fw", Str(e, AutomationElement.FrameworkIdProperty));
            string lct = Str(e, AutomationElement.LocalizedControlTypeProperty);
            if (!string.IsNullOrEmpty(lct) && !string.Equals(lct.Replace(" ", ""), t, StringComparison.OrdinalIgnoreCase)) Prop(sb, "lct", lct);

            object rect = Cached(e, AutomationElement.BoundingRectangleProperty);
            if (rect is System.Windows.Rect)
            {
                System.Windows.Rect r = (System.Windows.Rect)rect;
                if (!r.IsEmpty && !double.IsInfinity(r.X) && !double.IsNaN(r.X))
                {
                    Key(sb, "r");
                    sb.Append('[').Append(Num(Math.Round(r.X - w.Ox))).Append(',').Append(Num(Math.Round(r.Y - w.Oy))).Append(',')
                      .Append(Num(Math.Round(r.Width))).Append(',').Append(Num(Math.Round(r.Height))).Append(']');
                }
            }
            object enabled = Cached(e, AutomationElement.IsEnabledProperty);
            One(sb, "dis", enabled is bool && !(bool)enabled);
            One(sb, "off", Flag(e, AutomationElement.IsOffscreenProperty));
            One(sb, "foc", Flag(e, AutomationElement.HasKeyboardFocusProperty));
            One(sb, "kf", Flag(e, AutomationElement.IsKeyboardFocusableProperty));
            One(sb, "pw", Flag(e, AutomationElement.IsPasswordProperty));
            Prop(sb, "help", Clip(Str(e, AutomationElement.HelpTextProperty), 300));
            Prop(sb, "st", Clip(Str(e, AutomationElement.ItemStatusProperty), 200));
            Prop(sb, "acc", Str(e, AutomationElement.AcceleratorKeyProperty));

            One(sb, "inv", Flag(e, AutomationElement.IsInvokePatternAvailableProperty));
            if (Flag(e, AutomationElement.IsValuePatternAvailableProperty))
            {
                string v = Str(e, ValuePattern.ValueProperty) ?? "";
                Key(sb, "val");
                Esc(sb, Clip(v, MAX_VALUE));
                One(sb, "ro", Flag(e, ValuePattern.IsReadOnlyProperty));
            }
            if (Flag(e, AutomationElement.IsTogglePatternAvailableProperty))
            {
                object ts = Cached(e, TogglePattern.ToggleStateProperty);
                if (ts is ToggleState)
                {
                    Key(sb, "tog");
                    ToggleState s = (ToggleState)ts;
                    sb.Append(s == ToggleState.On ? '1' : s == ToggleState.Indeterminate ? '2' : '0');
                }
            }
            if (Flag(e, AutomationElement.IsSelectionItemPatternAvailableProperty))
            {
                Key(sb, "sel");
                sb.Append(Flag(e, SelectionItemPattern.IsSelectedProperty) ? '1' : '0');
            }
            if (Flag(e, AutomationElement.IsExpandCollapsePatternAvailableProperty))
            {
                object es = Cached(e, ExpandCollapsePattern.ExpandCollapseStateProperty);
                if (es is ExpandCollapseState)
                {
                    Key(sb, "exp");
                    sb.Append(((int)(ExpandCollapseState)es).ToString(CultureInfo.InvariantCulture));
                }
            }
            if (Flag(e, AutomationElement.IsRangeValuePatternAvailableProperty))
            {
                Key(sb, "rng");
                sb.Append('[').Append(Num(ToDouble(Cached(e, RangeValuePattern.MinimumProperty)))).Append(',')
                  .Append(Num(ToDouble(Cached(e, RangeValuePattern.MaximumProperty)))).Append(',')
                  .Append(Num(ToDouble(Cached(e, RangeValuePattern.ValueProperty)))).Append(',')
                  .Append(Num(ToDouble(Cached(e, RangeValuePattern.SmallChangeProperty)))).Append(']');
                One(sb, "rro", Flag(e, RangeValuePattern.IsReadOnlyProperty));
            }
            if (Flag(e, AutomationElement.IsScrollPatternAvailableProperty))
            {
                Key(sb, "scr");
                sb.Append('[').Append(Num(ToDouble(Cached(e, ScrollPattern.VerticalScrollPercentProperty)))).Append(',')
                  .Append(Flag(e, ScrollPattern.VerticallyScrollableProperty) ? '1' : '0').Append(']');
            }
            One(sb, "si", Flag(e, AutomationElement.IsScrollItemPatternAvailableProperty));
            bool text = Flag(e, AutomationElement.IsTextPatternAvailableProperty);
            One(sb, "txt", text);
            if (Flag(e, AutomationElement.IsGridPatternAvailableProperty))
            {
                Key(sb, "grid");
                sb.Append('[').Append(Num(ToDouble(Cached(e, GridPattern.RowCountProperty)))).Append(',')
                  .Append(Num(ToDouble(Cached(e, GridPattern.ColumnCountProperty)))).Append(']');
            }
            if (Flag(e, AutomationElement.IsSelectionPatternAvailableProperty)) One(sb, "multi", Flag(e, SelectionPattern.CanSelectMultipleProperty));
            if (Flag(e, AutomationElement.IsWindowPatternAvailableProperty)) One(sb, "modal", Flag(e, WindowPattern.IsModalProperty));

            // Full text of editors (Notepad, mail bodies). Web documents are read through their tree instead.
            string fw = Str(e, AutomationElement.FrameworkIdProperty) ?? "";
            if (text && (t == "Document" || t == "Edit") && fw != "Chrome" && rect is System.Windows.Rect && ((System.Windows.Rect)rect).Height >= 100)
            {
                string body = DocumentText(e);
                if (body != null)
                {
                    Key(sb, "tx");
                    Esc(sb, body);
                }
            }

            AutomationElementCollection kids = null;
            try { kids = e.CachedChildren; } catch { }
            if (kids != null && kids.Count > 0)
            {
                if (depth >= MAX_DEPTH || w.Budget <= 0)
                {
                    w.Truncated = true;
                }
                else
                {
                    Key(sb, "c");
                    sb.Append('[');
                    bool first = true;
                    foreach (AutomationElement k in kids)
                    {
                        if (w.Budget <= 0)
                        {
                            w.Truncated = true;
                            break;
                        }
                        if (!first) sb.Append(',');
                        first = false;
                        Node(sb, k, w, depth + 1);
                    }
                    sb.Append(']');
                }
            }
            sb.Append('}');
        }

        static double ToDouble(object o)
        {
            if (o == null) return 0;
            try { return Convert.ToDouble(o, CultureInfo.InvariantCulture); } catch { return 0; }
        }

        static string DocumentText(AutomationElement e)
        {
            try
            {
                TextPattern tp = e.GetCurrentPattern(TextPattern.Pattern) as TextPattern;
                if (tp == null) return null;
                return tp.DocumentRange.GetText(MAX_TEXT);
            }
            catch
            {
                return null;
            }
        }

        static RECT WindowRect(IntPtr h)
        {
            RECT r;
            if (DwmGetWindowRect(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
            return r;
        }

        static string ClassOf(IntPtr h)
        {
            StringBuilder sb = new StringBuilder(256);
            GetClassName(h, sb, 256);
            return sb.ToString();
        }

        static string TitleOf(IntPtr h)
        {
            StringBuilder sb = new StringBuilder(512);
            GetWindowText(h, sb, 512);
            return sb.ToString();
        }

        static uint PidOf(IntPtr h)
        {
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            return pid;
        }

        static string ProcessName(uint pid, out string path)
        {
            path = null;
            try
            {
                Process p = Process.GetProcessById((int)pid);
                try { path = p.MainModule.FileName; } catch { }
                return p.ProcessName;
            }
            catch
            {
                return "";
            }
        }

        /// UWP apps live inside ApplicationFrameHost; the real app owns the CoreWindow child.
        static uint HostedPid(IntPtr frame, uint framePid)
        {
            uint found = framePid;
            EnumChildWindows(frame, delegate (IntPtr c, IntPtr l)
            {
                if (ClassOf(c) == "Windows.UI.Core.CoreWindow")
                {
                    uint p = PidOf(c);
                    if (p != framePid)
                    {
                        found = p;
                        return false;
                    }
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        static readonly string[] IgnoredPopupClasses = new string[] { "IME", "MSCTFIME UI", "tooltips_class32", "Xaml_WindowedPopupClass_Shadow", "SysShadow", "Chrome_RenderWidgetHostHWND" };

        static string Tree(AutomationElement live, Walk w)
        {
            AutomationElement cached;
            using (Request().Activate())
            {
                cached = live.GetUpdatedCache(Request());
            }
            StringBuilder sb = new StringBuilder(64 * 1024);
            Node(sb, cached, w, 0);
            return sb.ToString();
        }

        /// The whole accessibility tree of a window plus its open popups (menus, dropdowns, dialogs).
        public static string Snapshot(long hwnd)
        {
            IntPtr h = new IntPtr(hwnd);
            if (!IsWindow(h)) throw new ArgumentException("That window is gone.");
            Stopwatch sw = Stopwatch.StartNew();
            RECT wr = WindowRect(h);
            uint pid = PidOf(h);
            string processPath;
            string process = ProcessName(pid, out processPath);
            uint appPid = pid;
            if (string.Equals(process, "ApplicationFrameHost", StringComparison.OrdinalIgnoreCase))
            {
                appPid = HostedPid(h, pid);
                if (appPid != pid) process = ProcessName(appPid, out processPath);
            }

            Dictionary<string, AutomationElement> map = new Dictionary<string, AutomationElement>();
            Walk w = new Walk();
            w.Budget = NODE_BUDGET;
            w.Ox = wr.Left;
            w.Oy = wr.Top;
            w.Map = map;
            string root = Tree(AutomationElement.FromHandle(h), w);

            // Popups: other visible top-level windows of the same process(es).
            List<string> popups = new List<string>();
            List<IntPtr> handles = new List<IntPtr>();
            EnumWindows(delegate (IntPtr c, IntPtr l)
            {
                if (c == h || !IsWindowVisible(c) || IsIconic(c)) return true;
                uint p = PidOf(c);
                if (p != pid && p != appPid) return true;
                string cls = ClassOf(c);
                foreach (string ig in IgnoredPopupClasses) if (cls == ig) return true;
                RECT r = WindowRect(c);
                if (r.Right - r.Left < 8 || r.Bottom - r.Top < 8) return true;
                handles.Add(c);
                return handles.Count < 6;
            }, IntPtr.Zero);
            foreach (IntPtr c in handles)
            {
                try
                {
                    Walk pw = new Walk();
                    pw.Budget = POPUP_BUDGET;
                    pw.Ox = wr.Left;
                    pw.Oy = wr.Top;
                    pw.Map = map;
                    string tree = Tree(AutomationElement.FromHandle(c), pw);
                    // Only owned popups and dialogs matter, not the app's other main windows.
                    string cls = ClassOf(c);
                    bool popup = cls == "#32768" || cls == "#32770" || cls.IndexOf("Popup", StringComparison.OrdinalIgnoreCase) >= 0 || cls.IndexOf("DropDown", StringComparison.OrdinalIgnoreCase) >= 0 || cls.IndexOf("Menu", StringComparison.OrdinalIgnoreCase) >= 0 || IsOwnedBy(c, h);
                    if (popup) popups.Add(tree);
                }
                catch { }
            }

            lock (gate)
            {
                foreach (KeyValuePair<string, AutomationElement> kv in map) elements[kv.Key] = kv.Value;
                if (elements.Count > 40000) elements = map;
            }

            StringBuilder sb = new StringBuilder(root.Length + 1024);
            sb.Append("{\"hwnd\":").Append(hwnd.ToString(CultureInfo.InvariantCulture));
            sb.Append(",\"pid\":").Append(appPid.ToString(CultureInfo.InvariantCulture));
            Key(sb, "process");
            Esc(sb, process);
            if (processPath != null)
            {
                Key(sb, "path");
                Esc(sb, processPath);
            }
            Key(sb, "title");
            Esc(sb, TitleOf(h));
            Key(sb, "cls");
            Esc(sb, ClassOf(h));
            Key(sb, "rect");
            sb.Append('[').Append(wr.Left).Append(',').Append(wr.Top).Append(',').Append(wr.Right - wr.Left).Append(',').Append(wr.Bottom - wr.Top).Append(']');
            Key(sb, "root");
            sb.Append(root);
            Key(sb, "popups");
            sb.Append('[').Append(string.Join(",", popups.ToArray())).Append(']');
            if (w.Truncated) sb.Append(",\"truncated\":true");
            sb.Append(",\"ms\":").Append(sw.ElapsedMilliseconds.ToString(CultureInfo.InvariantCulture));
            sb.Append('}');
            return sb.ToString();
        }

        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);

        static bool IsOwnedBy(IntPtr c, IntPtr owner)
        {
            for (IntPtr o = GetWindow(c, 4); o != IntPtr.Zero; o = GetWindow(o, 4)) if (o == owner) return true;
            return false;
        }

        // ---------------- actions ----------------

        static AutomationElement Find(long hwnd, string id)
        {
            AutomationElement e;
            lock (gate)
            {
                if (elements.TryGetValue(id, out e)) return e;
            }
            // Not seen yet (or the cache was reset): take a fresh snapshot and look again.
            Snapshot(hwnd);
            lock (gate)
            {
                if (elements.TryGetValue(id, out e)) return e;
            }
            throw new ArgumentException("That control is no longer on screen.");
        }

        static object Pattern(AutomationElement e, AutomationPattern p)
        {
            object o;
            if (e.TryGetCurrentPattern(p, out o)) return o;
            return null;
        }

        static void Foreground(long hwnd)
        {
            IntPtr h = new IntPtr(hwnd);
            if (IsIconic(h)) ShowWindow(h, 9);
            if (GetForegroundWindow() == h) return;
            // Windows only lets the foreground process change focus; a no-op Alt press satisfies it.
            keybd_event(0x12, 0, 0, UIntPtr.Zero);
            keybd_event(0x12, 0, 2, UIntPtr.Zero);
            SetForegroundWindow(h);
            Thread.Sleep(60);
        }

        static int[] Center(AutomationElement e)
        {
            System.Windows.Rect r = e.Current.BoundingRectangle;
            if (r.IsEmpty) throw new InvalidOperationException("That control is not visible.");
            return new int[] { (int)Math.Round(r.X + r.Width / 2), (int)Math.Round(r.Y + r.Height / 2) };
        }

        static void Click(long hwnd, AutomationElement e, string button, int count)
        {
            Foreground(hwnd);
            object si = Pattern(e, ScrollItemPattern.Pattern);
            if (si != null) { try { ((ScrollItemPattern)si).ScrollIntoView(); } catch { } }
            int[] c = Center(e);
            Input.Do("click", true, c[0], c[1], button, count, null, null);
        }

        static void Focus(long hwnd, AutomationElement e)
        {
            Foreground(hwnd);
            try { e.SetFocus(); } catch { Click(hwnd, e, "left", 1); }
        }

        static int[] Vks(string value)
        {
            if (string.IsNullOrEmpty(value)) return new int[0];
            string[] parts = value.Split(',');
            int[] vks = new int[parts.Length];
            for (int i = 0; i < parts.Length; i++) vks[i] = int.Parse(parts[i].Trim(), CultureInfo.InvariantCulture);
            return vks;
        }

        /// Perform one action. Patterns first (they work without bringing the window forward).
        public static string Act(long hwnd, string id, string op, string value)
        {
            AutomationElement e = Find(hwnd, id);
            object p;
            switch (op)
            {
                case "invoke":
                    p = Pattern(e, InvokePattern.Pattern);
                    if (p != null) { ((InvokePattern)p).Invoke(); return "invoked"; }
                    p = Pattern(e, TogglePattern.Pattern);
                    if (p != null) { ((TogglePattern)p).Toggle(); return "toggled"; }
                    p = Pattern(e, SelectionItemPattern.Pattern);
                    if (p != null) { ((SelectionItemPattern)p).Select(); return "selected"; }
                    p = Pattern(e, ExpandCollapsePattern.Pattern);
                    if (p != null) { ExpandToggle((ExpandCollapsePattern)p); return "expanded"; }
                    Click(hwnd, e, "left", 1);
                    return "clicked";
                case "toggle":
                    p = Pattern(e, TogglePattern.Pattern);
                    if (p != null)
                    {
                        TogglePattern tp = (TogglePattern)p;
                        if (string.IsNullOrEmpty(value)) { tp.Toggle(); return "toggled"; }
                        ToggleState want = value == "true" || value == "1" ? ToggleState.On : ToggleState.Off;
                        for (int i = 0; i < 3 && tp.Current.ToggleState != want; i++) tp.Toggle();
                        return "toggled";
                    }
                    return Act(hwnd, id, "invoke", null);
                case "select":
                    p = Pattern(e, SelectionItemPattern.Pattern);
                    if (p != null) { ((SelectionItemPattern)p).Select(); return "selected"; }
                    return Act(hwnd, id, "invoke", null);
                case "open":
                    // List rows: Invoke when supported (Explorer opens the item), else double-click.
                    p = Pattern(e, InvokePattern.Pattern);
                    if (p != null) { ((InvokePattern)p).Invoke(); return "invoked"; }
                    p = Pattern(e, SelectionItemPattern.Pattern);
                    if (p != null) { try { ((SelectionItemPattern)p).Select(); } catch { } }
                    Click(hwnd, e, "left", 2);
                    return "opened";
                case "expand":
                case "collapse":
                    p = Pattern(e, ExpandCollapsePattern.Pattern);
                    if (p != null)
                    {
                        ExpandCollapsePattern ec = (ExpandCollapsePattern)p;
                        if (op == "expand") ec.Expand(); else ec.Collapse();
                        return op + "ed";
                    }
                    return Act(hwnd, id, "invoke", null);
                case "setValue":
                    p = Pattern(e, ValuePattern.Pattern);
                    if (p != null && !((ValuePattern)p).Current.IsReadOnly)
                    {
                        try { ((ValuePattern)p).SetValue(value ?? ""); return "set"; } catch { }
                    }
                    Focus(hwnd, e);
                    Input.Keys(new int[] { 0x11, 0x41 });
                    if (string.IsNullOrEmpty(value)) Input.Keys(new int[] { 0x2E }); else Input.Text(value);
                    return "typed";
                case "type":
                    Focus(hwnd, e);
                    Input.Text(value ?? "");
                    return "typed";
                case "submit":
                    Focus(hwnd, e);
                    Input.Keys(new int[] { 0x0D });
                    return "submitted";
                case "keys":
                    Focus(hwnd, e);
                    Input.Keys(Vks(value));
                    return "pressed";
                case "setRange":
                    p = Pattern(e, RangeValuePattern.Pattern);
                    if (p != null)
                    {
                        RangeValuePattern rp = (RangeValuePattern)p;
                        double v = double.Parse(value ?? "0", CultureInfo.InvariantCulture);
                        rp.SetValue(Math.Max(rp.Current.Minimum, Math.Min(rp.Current.Maximum, v)));
                        return "set";
                    }
                    throw new InvalidOperationException("That control has no adjustable value.");
                case "focus":
                    Focus(hwnd, e);
                    return "focused";
                case "scrollIntoView":
                    p = Pattern(e, ScrollItemPattern.Pattern);
                    if (p != null) ((ScrollItemPattern)p).ScrollIntoView();
                    return "scrolled";
                case "more":
                case "scroll":
                    p = Pattern(e, ScrollPattern.Pattern);
                    if (p != null)
                    {
                        ScrollPattern sp = (ScrollPattern)p;
                        ScrollAmount amount = value == "up" ? ScrollAmount.LargeDecrement : ScrollAmount.LargeIncrement;
                        if (sp.Current.VerticallyScrollable) sp.ScrollVertical(amount);
                        return "scrolled";
                    }
                    {
                        int[] c = Center(e);
                        Foreground(hwnd);
                        Input.Do("move", true, c[0], c[1], null, 0, null, null);
                        Input.Do("scroll", false, 0, value == "up" ? 360 : -360, null, 0, null, null);
                    }
                    return "scrolled";
                case "click":
                    Click(hwnd, e, "left", 1);
                    return "clicked";
                case "dclick":
                    Click(hwnd, e, "left", 2);
                    return "clicked";
                case "rclick":
                case "context":
                    Click(hwnd, e, "right", 1);
                    return "clicked";
                default:
                    throw new ArgumentException("Unknown action: " + op);
            }
        }

        static void ExpandToggle(ExpandCollapsePattern p)
        {
            if (p.Current.ExpandCollapseState == ExpandCollapseState.Expanded) p.Collapse();
            else p.Expand();
        }

        /// Send keys to the window itself (Escape to close a menu, Ctrl+S, …).
        public static string WindowKeys(long hwnd, string value)
        {
            Foreground(hwnd);
            Input.Keys(Vks(value));
            return "pressed";
        }

        /// Tap at a point inside the window (live fallback), coordinates relative to the window.
        public static string Tap(long hwnd, int x, int y, string button, int count)
        {
            IntPtr h = new IntPtr(hwnd);
            RECT r = WindowRect(h);
            Foreground(hwnd);
            Input.Do("click", true, r.Left + x, r.Top + y, string.IsNullOrEmpty(button) ? "left" : button, Math.Max(1, count), null, null);
            return "tapped";
        }

        /// Mouse wheel at a point inside the window (live fallback).
        public static string Wheel(long hwnd, int x, int y, int dy)
        {
            IntPtr h = new IntPtr(hwnd);
            RECT r = WindowRect(h);
            Foreground(hwnd);
            Input.Do("move", true, r.Left + x, r.Top + y, null, 0, null, null);
            Input.Do("scroll", false, 0, dy, null, 0, null, null);
            return "scrolled";
        }

        /// Type text into whatever has focus in the window (live fallback keyboard).
        public static string WindowText(long hwnd, string text)
        {
            Foreground(hwnd);
            Input.Text(text ?? "");
            return "typed";
        }

        // ---------------- pictures ----------------

        static Bitmap Capture(long hwnd)
        {
            lock (captures)
            {
                CapturedWindow c;
                if (captures.TryGetValue(hwnd, out c) && (DateTime.UtcNow - c.At).TotalMilliseconds < 1500) return c.Bitmap;
                IntPtr h = new IntPtr(hwnd);
                RECT r;
                GetWindowRect(h, out r);
                RECT vis = WindowRect(h);
                int w = Math.Max(1, r.Right - r.Left), ht = Math.Max(1, r.Bottom - r.Top);
                Bitmap full = new Bitmap(w, ht, PixelFormat.Format32bppArgb);
                using (Graphics g = Graphics.FromImage(full))
                {
                    IntPtr hdc = g.GetHdc();
                    try { PrintWindow(h, hdc, 2); } finally { g.ReleaseHdc(hdc); }
                }
                // Crop the invisible resize border so (0,0) matches the snapshot's window origin.
                Rectangle inner = new Rectangle(vis.Left - r.Left, vis.Top - r.Top, Math.Max(1, vis.Right - vis.Left), Math.Max(1, vis.Bottom - vis.Top));
                inner.Intersect(new Rectangle(0, 0, w, ht));
                Bitmap bmp = full.Clone(inner, full.PixelFormat);
                full.Dispose();
                if (c != null && c.Bitmap != null) c.Bitmap.Dispose();
                c = new CapturedWindow();
                c.Bitmap = bmp;
                c.At = DateTime.UtcNow;
                captures[hwnd] = c;
                return bmp;
            }
        }

        /// A piece of the window (relative rect) as base64 PNG (icons) or JPEG (photos, live regions).
        public static string Crop(long hwnd, int x, int y, int w, int h, int maxWidth, string format)
        {
            lock (captures)
            {
                Bitmap src = Capture(hwnd);
                Rectangle rect = new Rectangle(x, y, Math.Max(1, w), Math.Max(1, h));
                rect.Intersect(new Rectangle(0, 0, src.Width, src.Height));
                if (rect.Width <= 0 || rect.Height <= 0) throw new ArgumentException("That part of the window is not visible.");
                int outW = maxWidth > 0 && rect.Width > maxWidth ? maxWidth : rect.Width;
                int outH = Math.Max(1, (int)Math.Round(rect.Height * (outW / (double)rect.Width)));
                using (Bitmap dst = new Bitmap(outW, outH, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(dst))
                    {
                        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                        g.DrawImage(src, new Rectangle(0, 0, outW, outH), rect, GraphicsUnit.Pixel);
                    }
                    using (MemoryStream ms = new MemoryStream())
                    {
                        if (format == "png") dst.Save(ms, ImageFormat.Png);
                        else
                        {
                            ImageCodecInfo jpeg = null;
                            foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders()) if (codec.MimeType == "image/jpeg") jpeg = codec;
                            EncoderParameters ep = new EncoderParameters(1);
                            ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 82L);
                            dst.Save(ms, jpeg, ep);
                        }
                        return Convert.ToBase64String(ms.ToArray());
                    }
                }
            }
        }

        /// Forget a window's cached picture (after an action, so the next crop is fresh).
        public static bool Invalidate(long hwnd)
        {
            lock (captures)
            {
                CapturedWindow c;
                if (captures.TryGetValue(hwnd, out c))
                {
                    if (c.Bitmap != null) c.Bitmap.Dispose();
                    captures.Remove(hwnd);
                }
            }
            return true;
        }

        public static string Raw(int id, string json)
        {
            return "{\"id\":" + id.ToString(CultureInfo.InvariantCulture) + ",\"ok\":true,\"result\":" + json + "}";
        }
    }
}
