// Remote PC SDK for C# — one file, no dependencies, C# 5 so it also works from Windows PowerShell
// (Add-Type -Path RemotePhone.cs). Put your program on the iPhone as a native app.
//
//   var count = 0;
//   var app = new PhoneApp("counter", "Counter", a => Ui.Screen("Counter",
//       Ui.Text(count.ToString(), style: "display"),
//       Ui.Button("Add one", () => count++)));
//   app.Run();
//
// Protocol: ../PROTOCOL.md
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.WebSockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace RemotePC.Sdk
{
    /// <summary>A JSON object in a view (screens, sections, items are all plain dictionaries).</summary>
    public class Node : Dictionary<string, object>
    {
        public Node Set(string key, object value)
        {
            if (value != null) this[key] = value;
            return this;
        }
    }

    // ------------------------------------------------------------------------------------------
    // Minimal JSON (objects, arrays, strings, numbers, booleans, null).

    public static class Json
    {
        public static string Write(object value)
        {
            StringBuilder sb = new StringBuilder();
            WriteValue(sb, value);
            return sb.ToString();
        }

        static void WriteValue(StringBuilder sb, object v)
        {
            if (v == null) { sb.Append("null"); return; }
            string s = v as string;
            if (s != null) { WriteString(sb, s); return; }
            if (v is bool) { sb.Append((bool)v ? "true" : "false"); return; }
            if (v is int || v is long || v is double || v is float || v is decimal || v is short)
            {
                sb.Append(Convert.ToDouble(v, CultureInfo.InvariantCulture).ToString("R", CultureInfo.InvariantCulture));
                return;
            }
            IDictionary dict = v as IDictionary;
            if (dict != null)
            {
                sb.Append('{');
                bool first = true;
                foreach (DictionaryEntry e in dict)
                {
                    if (e.Value == null) continue;
                    if (!first) sb.Append(',');
                    first = false;
                    WriteString(sb, Convert.ToString(e.Key, CultureInfo.InvariantCulture));
                    sb.Append(':');
                    WriteValue(sb, e.Value);
                }
                sb.Append('}');
                return;
            }
            IEnumerable list = v as IEnumerable;
            if (list != null)
            {
                sb.Append('[');
                bool first = true;
                foreach (object o in list)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteValue(sb, o);
                }
                sb.Append(']');
                return;
            }
            WriteString(sb, Convert.ToString(v, CultureInfo.InvariantCulture));
        }

        static void WriteString(StringBuilder sb, string s)
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
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        public static object Read(string text)
        {
            int i = 0;
            object v = ReadValue(text, ref i);
            return v;
        }

        static void Skip(string t, ref int i)
        {
            while (i < t.Length && char.IsWhiteSpace(t[i])) i++;
        }

        static object ReadValue(string t, ref int i)
        {
            Skip(t, ref i);
            if (i >= t.Length) throw new FormatException("Unexpected end of JSON");
            char c = t[i];
            if (c == '{')
            {
                Dictionary<string, object> d = new Dictionary<string, object>();
                i++;
                Skip(t, ref i);
                if (t[i] == '}') { i++; return d; }
                while (true)
                {
                    Skip(t, ref i);
                    string key = ReadString(t, ref i);
                    Skip(t, ref i);
                    i++; // :
                    d[key] = ReadValue(t, ref i);
                    Skip(t, ref i);
                    if (t[i] == ',') { i++; continue; }
                    i++; // }
                    return d;
                }
            }
            if (c == '[')
            {
                List<object> l = new List<object>();
                i++;
                Skip(t, ref i);
                if (t[i] == ']') { i++; return l; }
                while (true)
                {
                    l.Add(ReadValue(t, ref i));
                    Skip(t, ref i);
                    if (t[i] == ',') { i++; continue; }
                    i++; // ]
                    return l;
                }
            }
            if (c == '"') return ReadString(t, ref i);
            if (t.Substring(i).StartsWith("true")) { i += 4; return true; }
            if (t.Substring(i).StartsWith("false")) { i += 5; return false; }
            if (t.Substring(i).StartsWith("null")) { i += 4; return null; }
            int start = i;
            while (i < t.Length && "+-0123456789.eE".IndexOf(t[i]) >= 0) i++;
            return double.Parse(t.Substring(start, i - start), CultureInfo.InvariantCulture);
        }

        static string ReadString(string t, ref int i)
        {
            StringBuilder sb = new StringBuilder();
            i++; // opening quote
            while (t[i] != '"')
            {
                char c = t[i++];
                if (c != '\\') { sb.Append(c); continue; }
                char e = t[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u': sb.Append((char)Convert.ToInt32(t.Substring(i, 4), 16)); i += 4; break;
                    default: sb.Append(e); break;
                }
            }
            i++; // closing quote
            return sb.ToString();
        }
    }

    // ------------------------------------------------------------------------------------------
    // Building views. Callbacks become refs while rendering; refs come from ids/titles so they
    // stay the same between renders.

    public static class Ui
    {
        internal class Context
        {
            public Dictionary<string, Action<object>> Handlers = new Dictionary<string, Action<object>>();
            public Dictionary<string, int> Seen = new Dictionary<string, int>();
            public Dictionary<string, int> Ids = new Dictionary<string, int>();
        }

        [ThreadStatic] internal static Context Current;

        static string Slug(string s)
        {
            string v = Regex.Replace((s ?? "").ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
            return v.Length > 40 ? v.Substring(0, 40) : v;
        }

        static string Bind(Action<object> fn, string hint)
        {
            if (fn == null) return null;
            if (Current == null) throw new InvalidOperationException("UI elements with callbacks must be built inside a render function");
            int n;
            Current.Seen.TryGetValue(hint, out n);
            n++;
            Current.Seen[hint] = n;
            string r = n == 1 ? hint : hint + "#" + n;
            Current.Handlers[r] = fn;
            return r;
        }

        static string Id(string kind, string title, string given)
        {
            if (!string.IsNullOrEmpty(given)) return given;
            string slug = Slug(title);
            string b = kind + "-" + (slug.Length > 0 ? slug : "x");
            if (Current == null) return b;
            int n;
            Current.Ids.TryGetValue(b, out n);
            n++;
            Current.Ids[b] = n;
            return n == 1 ? b : b + "-" + n;
        }

        static Action<object> Wrap(Action fn) { return fn == null ? null : new Action<object>(_ => fn()); }
        static Action<object> Wrap(Action<bool> fn) { return fn == null ? null : new Action<object>(v => fn(v is bool && (bool)v)); }
        static Action<object> Wrap(Action<string> fn) { return fn == null ? null : new Action<object>(v => fn(v == null ? "" : Convert.ToString(v, CultureInfo.InvariantCulture))); }
        static Action<object> Wrap(Action<double> fn) { return fn == null ? null : new Action<object>(v => fn(Convert.ToDouble(v ?? 0, CultureInfo.InvariantCulture))); }

        internal static Node Act(string title, Action<object> onTap, string id, string symbol = null, string role = null, string confirm = null)
        {
            return new Node().Set("ref", Bind(onTap, "a:" + id) ?? "noop:" + id).Set("title", title).Set("symbol", symbol).Set("role", role).Set("confirm", confirm);
        }

        public static Node Icon(string symbol, string color = "blue", string style = "tile")
        {
            return new Node().Set("symbol", symbol).Set("color", color).Set("style", style);
        }

        public static Node Initials(string text, string color = "gray")
        {
            return new Node().Set("text", text).Set("color", color).Set("style", "circle");
        }

        public static Node Action(string title, Action onTap, string symbol = null, string role = null)
        {
            return Act(title, Wrap(onTap), Slug(title), symbol, role);
        }

        public static Node Menu(string title, Action onTap, string symbol = null, bool? isChecked = null, string role = null)
        {
            return new Node().Set("title", title).Set("symbol", symbol).Set("action", Act(title, Wrap(onTap), "menu-" + Slug(title))).Set("checked", isChecked).Set("role", role);
        }

        public static Node Submenu(string title, params Node[] children)
        {
            return new Node().Set("title", title).Set("children", children.ToList());
        }

        /// <summary>A screen. Content is sections, or items (put into one section).</summary>
        public static Node Screen(string title, params Node[] content)
        {
            return ScreenWith(title, null, content);
        }

        public static Node ScreenWith(string title, ScreenOptions options, params Node[] content)
        {
            ScreenOptions o = options ?? new ScreenOptions();
            List<Node> sections = content.Length > 0 && content[0].ContainsKey("items") ? content.ToList() : new List<Node> { Section(content) };
            string id = o.Id ?? "screen-" + Slug(title);
            Node s = new Node()
                .Set("id", id).Set("title", title).Set("subtitle", o.Subtitle).Set("style", o.Style).Set("largeTitle", o.LargeTitle)
                .Set("actions", o.Actions).Set("menu", o.Menu).Set("bottomBar", o.BottomBar)
                .Set("sections", sections.Where(x => ((IList)x["items"]).Count > 0).ToList());
            if (o.OnSearch != null || o.SearchPlaceholder != null)
                s.Set("search", new Node().Set("ref", Bind(Wrap(o.OnSearch), "search:" + id) ?? "search:" + id).Set("placeholder", o.SearchPlaceholder ?? "Search").Set("value", o.SearchValue ?? ""));
            if (o.OnSend != null)
                s.Set("composer", new Node().Set("ref", Bind(Wrap(o.OnSend), "send:" + id)).Set("placeholder", o.ComposerPlaceholder ?? "Message"));
            if (o.Document != null)
                s.Set("document", new Node().Set("text", o.Document).Set("ref", Bind(Wrap(o.OnDocumentChange), "doc:" + id)));
            if (o.OnRefresh != null) s.Set("refresh", Act("Refresh", Wrap(o.OnRefresh), "refresh-" + id));
            if (o.EmptyTitle != null) s.Set("empty", new Node().Set("title", o.EmptyTitle).Set("message", o.EmptyMessage).Set("symbol", o.EmptySymbol));
            return s;
        }

        public static Node Section(params Node[] items)
        {
            return SectionWith(null, null, items);
        }

        public static Node SectionWith(string header, string footer, params Node[] items)
        {
            List<Node> list = items.Where(x => x != null).ToList();
            string first = list.Count > 0 && list[0].ContainsKey("id") ? (string)list[0]["id"] : "main";
            return new Node().Set("id", "section-" + Slug(header ?? first)).Set("header", header).Set("footer", footer).Set("items", list);
        }

        public static Node Nav(string title, Action onTap, string subtitle = null, string value = null, Node icon = null, string id = null)
        {
            string i = Id("nav", title, id);
            return new Node().Set("id", i).Set("kind", "nav").Set("title", title).Set("subtitle", subtitle).Set("value", value).Set("icon", icon).Set("tap", Act(title, Wrap(onTap), i));
        }

        public static Node Toggle(string title, bool on, Action<bool> onChange, string subtitle = null, Node icon = null, string id = null)
        {
            string i = Id("toggle", title, id);
            return new Node().Set("id", i).Set("kind", "toggle").Set("title", title).Set("subtitle", subtitle).Set("icon", icon).Set("on", on).Set("ref", Bind(Wrap(onChange), "t:" + i) ?? "noop:" + i);
        }

        public static Node Choice(string title, IEnumerable<string> options, string selected, Action<string> onChange, string style = null, string id = null)
        {
            string i = Id("choice", title, id);
            List<Node> opts = options.Select(o => new Node().Set("id", o).Set("title", o)).ToList();
            return new Node().Set("id", i).Set("kind", "choice").Set("title", title).Set("value", selected).Set("options", opts).Set("selected", selected).Set("style", style).Set("ref", Bind(Wrap(onChange), "c:" + i) ?? "noop:" + i);
        }

        public static Node Slider(string title, double value, Action<double> onChange, double min = 0, double max = 100, double? step = null, string id = null)
        {
            string i = Id("slider", title, id);
            return new Node().Set("id", i).Set("kind", "slider").Set("title", title).Set("min", min).Set("max", max).Set("step", step).Set("value", value).Set("ref", Bind(Wrap(onChange), "s:" + i) ?? "noop:" + i);
        }

        public static Node Stepper(string title, double value, Action<double> onChange, double? min = null, double? max = null, double step = 1, string id = null)
        {
            string i = Id("stepper", title, id);
            return new Node().Set("id", i).Set("kind", "stepper").Set("title", title).Set("value", value).Set("min", min).Set("max", max).Set("step", step).Set("ref", Bind(Wrap(onChange), "n:" + i) ?? "noop:" + i);
        }

        public static Node Field(string title, string value, Action<string> onChange, string placeholder = null, bool secure = false, bool multiline = false, string keyboard = null, Action onSubmit = null, string id = null)
        {
            string i = Id("field", title ?? placeholder, id);
            Node n = new Node().Set("id", i).Set("kind", "field").Set("title", title).Set("placeholder", placeholder).Set("value", value ?? "").Set("ref", Bind(Wrap(onChange), "f:" + i) ?? "noop:" + i).Set("keyboard", keyboard);
            if (secure) n.Set("secure", true);
            if (multiline) n.Set("multiline", true);
            if (onSubmit != null) n.Set("submit", Act("Go", Wrap(onSubmit), "submit-" + i));
            return n;
        }

        public static Node Button(string title, Action onTap, string style = null, string role = null, string symbol = null, string confirm = null, string id = null)
        {
            string i = Id("button", title, id);
            return new Node().Set("id", i).Set("kind", "button").Set("action", Act(title, Wrap(onTap), i, symbol, role, confirm)).Set("style", style);
        }

        public static Node Check(string title, bool on, Action<bool> onChange, string subtitle = null, bool radio = false, string id = null)
        {
            string i = Id("check", title, id);
            Node n = new Node().Set("id", i).Set("kind", "check").Set("title", title).Set("subtitle", subtitle).Set("on", on).Set("ref", Bind(Wrap(onChange), "k:" + i) ?? "noop:" + i);
            if (radio) n.Set("radio", true);
            return n;
        }

        public static Node Text(string text, string style = null, string label = null, string id = null)
        {
            return new Node().Set("id", Id("text", label ?? text, id)).Set("kind", "text").Set("text", text ?? "").Set("style", style).Set("label", label);
        }

        public static Node Label(string label, string value, string id = null)
        {
            return Text(value, null, label, id);
        }

        public static Node Heading(string text, int level = 2, string id = null)
        {
            return new Node().Set("id", Id("heading", text, id)).Set("kind", "heading").Set("text", text).Set("level", level);
        }

        public static Node Paragraph(string text, string bullet = null, string id = null)
        {
            return new Node().Set("id", Id("para", text, id)).Set("kind", "paragraph").Set("runs", new List<Node> { new Node().Set("text", text) }).Set("bullet", bullet);
        }

        public static Node Image(string image, string caption = null, double? aspect = null, string id = null)
        {
            return new Node().Set("id", Id("image", caption ?? "image", id)).Set("kind", "image").Set("image", image).Set("caption", caption).Set("aspect", aspect);
        }

        public static Node Progress(double? value, string title = null, string label = null, string id = null)
        {
            return new Node().Set("id", Id("progress", title, id)).Set("kind", "progress").Set("title", title).Set("value", value).Set("label", label);
        }

        public static Node Item(string title, string subtitle = null, string detail = null, string meta = null, Node icon = null, Action onTap = null, bool chevron = false, bool unread = false, string id = null)
        {
            string i = Id("item", title, id);
            Node n = new Node().Set("id", i).Set("kind", "item").Set("title", title).Set("subtitle", subtitle).Set("detail", detail).Set("meta", meta).Set("icon", icon);
            if (onTap != null) n.Set("tap", Act(title, Wrap(onTap), i));
            if (chevron) n.Set("chevron", true);
            if (unread) n.Set("unread", true);
            return n;
        }

        public static Node Tile(string title, Node icon = null, string image = null, Action onTap = null, string id = null)
        {
            string i = Id("tile", title, id);
            Node n = new Node().Set("id", i).Set("kind", "tile").Set("title", title).Set("icon", icon).Set("image", image);
            if (onTap != null) n.Set("tap", Act(title, Wrap(onTap), i));
            return n;
        }

        public static Node Message(string text, string author = null, string time = null, bool outgoing = false, bool system = false, string id = null)
        {
            Node n = new Node().Set("id", Id("msg", (author ?? "") + (time ?? "") + text, id)).Set("kind", "message").Set("text", text).Set("author", author).Set("time", time);
            if (outgoing) n.Set("outgoing", true);
            if (system) n.Set("system", true);
            return n;
        }

        public static Node Record(string title, IDictionary<string, string> fields, Action onTap = null, string id = null)
        {
            string i = Id("record", title, id);
            Node n = new Node().Set("id", i).Set("kind", "record").Set("title", title).Set("fields", fields.Select(kv => new Node().Set("label", kv.Key).Set("value", kv.Value)).ToList());
            if (onTap != null) n.Set("tap", Act(title, Wrap(onTap), i));
            return n;
        }

        public static Node Profile(string title, string subtitle = null, Node icon = null, Action onTap = null, string id = null)
        {
            string i = Id("profile", title, id);
            Node n = new Node().Set("id", i).Set("kind", "profile").Set("title", title).Set("subtitle", subtitle).Set("icon", icon);
            if (onTap != null) n.Set("tap", Act(title, Wrap(onTap), i));
            return n;
        }

        public static Node Divider()
        {
            return new Node().Set("id", Id("divider", "d", null)).Set("kind", "divider");
        }
    }

    /// <summary>Optional parts of a screen.</summary>
    public class ScreenOptions
    {
        public string Id;
        public string Subtitle;
        public string Style;
        public bool? LargeTitle;
        public List<Node> Actions;
        public List<Node> Menu;
        public List<Node> BottomBar;
        public string SearchPlaceholder;
        public string SearchValue;
        public Action<string> OnSearch;
        public string ComposerPlaceholder;
        public Action<string> OnSend;
        public string Document;
        public Action<string> OnDocumentChange;
        public Action OnRefresh;
        public string EmptyTitle;
        public string EmptyMessage;
        public string EmptySymbol;
    }

    // ------------------------------------------------------------------------------------------

    /// <summary>A program shown on the phone. Render returns a screen; call Update() when state changes.</summary>
    public class PhoneApp
    {
        readonly Node info;
        readonly List<Func<PhoneApp, Node>> stack = new List<Func<PhoneApp, Node>>();
        readonly object gate = new object();
        Func<PhoneApp, Node> sheet;
        Node alert;
        Dictionary<string, Action<object>> handlers = new Dictionary<string, Action<object>>();
        ClientWebSocket ws;
        volatile bool closed;

        public int Viewers { get; private set; }
        public event Action Opened;
        public event Action Closed;
        public event Action Refreshing;

        public PhoneApp(string id, string name, Func<PhoneApp, Node> render = null, Node icon = null, string tint = null, string description = null)
        {
            info = new Node().Set("id", id).Set("name", name).Set("icon", icon).Set("tint", tint).Set("description", description);
            if (render != null) stack.Add(render);
        }

        public PhoneApp Render(Func<PhoneApp, Node> render)
        {
            lock (gate)
            {
                if (stack.Count == 0) stack.Add(render); else stack[0] = render;
            }
            Update();
            return this;
        }

        public void Push(Func<PhoneApp, Node> render) { lock (gate) stack.Add(render); Update(); }

        public void Pop() { lock (gate) if (stack.Count > 1) stack.RemoveAt(stack.Count - 1); Update(); }

        public void Sheet(Func<PhoneApp, Node> render) { sheet = render; Update(); }

        public void CloseSheet() { sheet = null; Update(); }

        /// <summary>A native alert. Buttons are (title, role, onTap) where role is null, "cancel", "destructive" or "primary".</summary>
        public void Alert(string title, string message, params Tuple<string, string, Action>[] buttons)
        {
            Node a = new Node().Set("title", title).Set("message", message);
            List<Tuple<string, string, Action>> list = buttons.Length > 0 ? buttons.ToList() : new List<Tuple<string, string, Action>> { Tuple.Create<string, string, Action>("OK", null, null) };
            a.Set("buttons", list);
            alert = a;
            Update();
        }

        public void Toast(string text)
        {
            Send(new Node().Set("type", "toast").Set("text", text));
        }

        /// <summary>The current view (also handy in tests).</summary>
        public Node View()
        {
            lock (gate)
            {
                Ui.Current = new Ui.Context();
                try
                {
                    List<Node> screens = new List<Node>();
                    for (int n = 0; n < stack.Count; n++)
                    {
                        Node s = stack[n](this);
                        s["id"] = n + ":" + (s.ContainsKey("id") ? s["id"] : s["title"]);
                        screens.Add(s);
                    }
                    Node view = new Node().Set("screens", screens);
                    if (sheet != null) view.Set("sheet", sheet(this));
                    if (alert != null)
                    {
                        List<Node> actions = new List<Node>();
                        int k = 0;
                        foreach (Tuple<string, string, Action> b in (List<Tuple<string, string, Action>>)alert["buttons"])
                        {
                            Action tap = b.Item3;
                            actions.Add(Ui.Act(b.Item1, _ => { alert = null; if (tap != null) tap(); }, "alert-" + k++, null, b.Item2));
                        }
                        view.Set("alert", new Node().Set("title", alert["title"]).Set("message", alert.ContainsKey("message") ? alert["message"] : null).Set("actions", actions));
                    }
                    handlers = Ui.Current.Handlers;
                    return view;
                }
                finally
                {
                    Ui.Current = null;
                }
            }
        }

        public void Update()
        {
            if (ws == null || ws.State != WebSocketState.Open || stack.Count == 0) return;
            Send(new Node().Set("type", "view").Set("view", View()));
        }

        readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);

        void Send(Node msg)
        {
            ClientWebSocket socket = ws;
            if (socket == null || socket.State != WebSocketState.Open) return;
            byte[] bytes = Encoding.UTF8.GetBytes(Json.Write(msg));
            sendLock.Wait();
            try { socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None).Wait(); }
            catch { }
            finally { sendLock.Release(); }
        }

        void Handle(Dictionary<string, object> msg)
        {
            string type = msg.ContainsKey("type") ? msg["type"] as string : null;
            switch (type)
            {
                case "welcome":
                    Send(new Node().Set("type", "hello").Set("protocol", 1).Set("app", info));
                    Update();
                    break;
                case "open":
                    Viewers = msg.ContainsKey("viewers") ? Convert.ToInt32(msg["viewers"]) : 1;
                    if (Opened != null) Opened();
                    Update();
                    break;
                case "close":
                    Viewers = 0;
                    if (Closed != null) Closed();
                    break;
                case "action":
                    {
                        Action<object> fn;
                        string r = msg.ContainsKey("ref") ? msg["ref"] as string : null;
                        if (r != null && handlers.TryGetValue(r, out fn))
                        {
                            try { fn(msg.ContainsKey("value") ? msg["value"] : null); }
                            catch (Exception e) { Toast(e.Message); }
                        }
                        Update();
                        break;
                    }
                case "pop":
                    {
                        int depth = Math.Max(1, msg.ContainsKey("depth") ? Convert.ToInt32(msg["depth"]) : 1);
                        lock (gate) while (stack.Count > depth) stack.RemoveAt(stack.Count - 1);
                        Update();
                        break;
                    }
                case "dismiss":
                    sheet = null;
                    alert = null;
                    Update();
                    break;
                case "refresh":
                    if (Refreshing != null) Refreshing();
                    Update();
                    break;
            }
        }

        /// <summary>Find the agent from sdk.json (or REMOTE_PC_SDK_URL / REMOTE_PC_SDK_TOKEN).</summary>
        public static Tuple<string, string> Discover()
        {
            string url = Environment.GetEnvironmentVariable("REMOTE_PC_SDK_URL");
            string token = Environment.GetEnvironmentVariable("REMOTE_PC_SDK_TOKEN");
            if (!string.IsNullOrEmpty(url) && !string.IsNullOrEmpty(token)) return Tuple.Create(url, token);
            string dir = Environment.GetEnvironmentVariable("REMOTE_PC_HOME");
            if (string.IsNullOrEmpty(dir))
            {
                bool windows = Environment.OSVersion.Platform == PlatformID.Win32NT;
                dir = windows
                    ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RemotePC")
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config", "remote-pc");
            }
            string file = Path.Combine(dir, "sdk.json");
            if (!File.Exists(file)) throw new InvalidOperationException("Remote PC agent not found (" + file + " is missing). Start the agent first.");
            Dictionary<string, object> j = (Dictionary<string, object>)Json.Read(File.ReadAllText(file));
            return Tuple.Create((string)j["url"], (string)j["token"]);
        }

        /// <summary>Connect and serve the phone until Close() (reconnects automatically). Blocks.</summary>
        public void Run()
        {
            Tuple<string, string> target = Discover();
            string url = target.Item1 + (target.Item1.Contains("?") ? "&" : "?") + "token=" + Uri.EscapeDataString(target.Item2);
            int delay = 500;
            while (!closed)
            {
                ClientWebSocket socket = new ClientWebSocket();
                try
                {
                    socket.ConnectAsync(new Uri(url), CancellationToken.None).Wait();
                    ws = socket;
                    delay = 500;
                    byte[] buffer = new byte[64 * 1024];
                    MemoryStream message = new MemoryStream();
                    while (!closed && socket.State == WebSocketState.Open)
                    {
                        WebSocketReceiveResult result = socket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None).Result;
                        if (result.MessageType == WebSocketMessageType.Close) break;
                        message.Write(buffer, 0, result.Count);
                        if (!result.EndOfMessage) continue;
                        string text = Encoding.UTF8.GetString(message.ToArray());
                        message.SetLength(0);
                        Dictionary<string, object> msg = Json.Read(text) as Dictionary<string, object>;
                        if (msg != null) Handle(msg);
                    }
                }
                catch (Exception)
                {
                    // agent not running yet or connection lost: retry below
                }
                finally
                {
                    ws = null;
                    socket.Dispose();
                }
                if (!closed)
                {
                    Thread.Sleep(delay);
                    delay = Math.Min(delay * 2, 10000);
                }
            }
        }

        /// <summary>Run in the background and return immediately.</summary>
        public Task Start()
        {
            return Task.Factory.StartNew(Run, TaskCreationOptions.LongRunning);
        }

        public void Close()
        {
            closed = true;
            ClientWebSocket socket = ws;
            if (socket != null)
            {
                try { socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None).Wait(1000); } catch { }
            }
        }
    }
}
