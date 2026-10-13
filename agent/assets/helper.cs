// Win32 helpers for the Remote PC agent. Compiled at runtime by Windows PowerShell 5.1
// (Add-Type), which only understands C# 5: no string interpolation, no ?. operator,
// no expression-bodied members, no `out var`.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace RemotePC
{
    public class WindowInfo
    {
        public long hwnd { get; set; }
        public string title { get; set; }
        public string process { get; set; }
        public int pid { get; set; }
        public bool minimized { get; set; }
        public bool maximized { get; set; }
        public bool foreground { get; set; }
    }

    public class Rect
    {
        public int x { get; set; }
        public int y { get; set; }
        public int width { get; set; }
        public int height { get; set; }
        public bool minimized { get; set; }
    }

    public class OutputInfo
    {
        public int index { get; set; }
        public string name { get; set; }
        public int x { get; set; }
        public int y { get; set; }
        public int width { get; set; }
        public int height { get; set; }
        public bool primary { get; set; }
        public bool dxgi { get; set; }
    }

    public class SystemStatus
    {
        public int volume { get; set; }
        public bool muted { get; set; }
        public bool hasBattery { get; set; }
        public int battery { get; set; }
        public bool charging { get; set; }
        public string user { get; set; }
        public long uptimeSeconds { get; set; }
    }

    public class AppEntry
    {
        public string name { get; set; }
        public string id { get; set; }
        public AppEntry() { }
        public AppEntry(string name, string id) { this.name = name; this.id = id; }
    }

    public class ProcInfo
    {
        public int pid { get; set; }
        public string name { get; set; }
        public double cpu { get; set; }
        public long memory { get; set; }
        public string title { get; set; }
        public bool hasWindow { get; set; }
    }

    public class ProcSnapshot
    {
        public double cpu { get; set; }
        public long memTotal { get; set; }
        public long memUsed { get; set; }
        public int cores { get; set; }
        public List<ProcInfo> processes { get; set; }
    }

    public class ClipContent
    {
        public string text { get; set; }
        public string image { get; set; }
        public string[] files { get; set; }
    }

    public static class Json
    {
        static JavaScriptSerializer Make()
        {
            JavaScriptSerializer s = new JavaScriptSerializer();
            s.MaxJsonLength = int.MaxValue;
            s.RecursionLimit = 64;
            return s;
        }

        public static string Ok(int id, object result)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["id"] = id;
            d["ok"] = true;
            d["result"] = result;
            return Make().Serialize(d);
        }

        public static string OkString(int id, string result)
        {
            return Ok(id, (object)result);
        }

        public static string Err(int id, string message)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["id"] = id;
            d["ok"] = false;
            d["error"] = message;
            return Make().Serialize(d);
        }
    }

    public static class Win
    {
        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextLength(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
        [DllImport("user32.dll", EntryPoint = "GetWindowLong")] static extern int GetWindowLong32(IntPtr h, int idx);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")] static extern IntPtr GetWindowLongPtr64(IntPtr h, int idx);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
        [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int ht, uint flags);
        [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT wp);
        [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr h, ref WINDOWPLACEMENT wp);
        [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmGetWindowRect(IntPtr h, int attr, out RECT val, int size);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct WINDOWPLACEMENT
        {
            public int length;
            public int flags;
            public int showCmd;
            public POINT ptMinPosition;
            public POINT ptMaxPosition;
            public RECT rcNormalPosition;
        }
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);

        const uint GW_OWNER = 4;
        const int GWL_EXSTYLE = -20;
        const long WS_EX_TOOLWINDOW = 0x80;
        const int DWMWA_CLOAKED = 14;
        const uint WM_CLOSE = 0x0010;

        public static void Init()
        {
            // Per-monitor v2 (-4): coordinates are physical pixels everywhere, like DXGI and ffmpeg.
            bool ok = false;
            try { ok = SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            if (!ok) { try { SetProcessDPIAware(); } catch { } }
        }

        /// Visible window bounds (without the invisible resize border), in physical pixels.
        public static Rect Bounds(long hwnd)
        {
            IntPtr h = new IntPtr(hwnd);
            if (!IsWindow(h)) throw new ArgumentException("That window no longer exists.");
            RECT r;
            if (DwmGetWindowRect(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
            Rect o = new Rect();
            o.x = r.Left; o.y = r.Top; o.width = r.Right - r.Left; o.height = r.Bottom - r.Top;
            o.minimized = IsIconic(h);
            return o;
        }

        public static int[] GetPlacement(long hwnd)
        {
            WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
            wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
            if (!GetWindowPlacement(new IntPtr(hwnd), ref wp)) throw new ArgumentException("Could not read the window position.");
            return new int[] { wp.showCmd, wp.rcNormalPosition.Left, wp.rcNormalPosition.Top, wp.rcNormalPosition.Right, wp.rcNormalPosition.Bottom };
        }

        public static bool SetPlacement(long hwnd, int[] p)
        {
            IntPtr h = new IntPtr(hwnd);
            if (!IsWindow(h) || p == null || p.Length < 5) return false;
            WINDOWPLACEMENT wp = new WINDOWPLACEMENT();
            wp.length = Marshal.SizeOf(typeof(WINDOWPLACEMENT));
            GetWindowPlacement(h, ref wp);
            wp.showCmd = p[0] == 2 ? 1 : p[0]; // never restore into minimized
            wp.rcNormalPosition.Left = p[1]; wp.rcNormalPosition.Top = p[2];
            wp.rcNormalPosition.Right = p[3]; wp.rcNormalPosition.Bottom = p[4];
            return SetWindowPlacement(h, ref wp);
        }

        /// Restore, move and resize a window, then bring it to the front.
        public static Rect Place(long hwnd, int x, int y, int w, int ht)
        {
            IntPtr h = new IntPtr(hwnd);
            if (!IsWindow(h)) throw new ArgumentException("That window no longer exists.");
            if (IsIconic(h) || IsZoomed(h)) ShowWindow(h, 9);
            SetWindowPos(h, IntPtr.Zero, x, y, w, ht, 0x0004 | 0x0040); // NOZORDER | SHOWWINDOW
            Act(hwnd, "focus");
            Thread.Sleep(150);
            return Bounds(hwnd);
        }

        static long ExStyle(IntPtr h)
        {
            if (IntPtr.Size == 8) return GetWindowLongPtr64(h, GWL_EXSTYLE).ToInt64();
            return GetWindowLong32(h, GWL_EXSTYLE);
        }

        public static List<WindowInfo> ListWindows()
        {
            List<WindowInfo> list = new List<WindowInfo>();
            IntPtr fg = GetForegroundWindow();
            Dictionary<uint, string> names = new Dictionary<uint, string>();
            EnumWindowsProc cb = delegate (IntPtr h, IntPtr l)
            {
                if (!IsWindowVisible(h)) return true;
                int len = GetWindowTextLength(h);
                if (len == 0) return true;
                if (GetWindow(h, GW_OWNER) != IntPtr.Zero) return true;
                if ((ExStyle(h) & WS_EX_TOOLWINDOW) != 0) return true;
                int cloaked;
                if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true;
                StringBuilder sb = new StringBuilder(len + 1);
                GetWindowText(h, sb, sb.Capacity);
                uint pid;
                GetWindowThreadProcessId(h, out pid);
                string pname;
                if (!names.TryGetValue(pid, out pname))
                {
                    try { pname = Process.GetProcessById((int)pid).ProcessName; } catch { pname = ""; }
                    names[pid] = pname;
                }
                WindowInfo w = new WindowInfo();
                w.hwnd = h.ToInt64();
                w.title = sb.ToString();
                w.process = pname;
                w.pid = (int)pid;
                w.minimized = IsIconic(h);
                w.maximized = IsZoomed(h);
                w.foreground = h == fg;
                list.Add(w);
                return true;
            };
            EnumWindows(cb, IntPtr.Zero);
            GC.KeepAlive(cb);
            return list;
        }

        public static bool Act(long hwnd, string action)
        {
            IntPtr h = new IntPtr(hwnd);
            if (!IsWindow(h)) throw new ArgumentException("That window no longer exists.");
            switch (action)
            {
                case "focus":
                    if (IsIconic(h)) ShowWindow(h, 9);
                    // Tapping Alt lets a background process take the foreground.
                    keybd_event(0x12, 0, 0, UIntPtr.Zero);
                    keybd_event(0x12, 0, 2, UIntPtr.Zero);
                    BringWindowToTop(h);
                    return SetForegroundWindow(h);
                case "minimize": return ShowWindow(h, 6);
                case "maximize": return ShowWindow(h, 3);
                case "restore": return ShowWindow(h, 9);
                case "close": return PostMessage(h, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                default: throw new ArgumentException("Unknown window action: " + action);
            }
        }

        /// JPEG thumbnail of a window as base64, or null when it cannot be captured (e.g. minimized).
        public static string Thumbnail(long hwnd, int maxWidth)
        {
            IntPtr h = new IntPtr(hwnd);
            if (!IsWindow(h) || IsIconic(h)) return null;
            RECT r;
            if (!GetWindowRect(h, out r)) return null;
            int w = r.Right - r.Left;
            int ht = r.Bottom - r.Top;
            if (w <= 0 || ht <= 0) return null;
            if (maxWidth <= 0) maxWidth = 480;
            using (Bitmap bmp = new Bitmap(w, ht, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    IntPtr hdc = g.GetHdc();
                    try { PrintWindow(h, hdc, 2); }
                    finally { g.ReleaseHdc(hdc); }
                }
                return Jpeg(bmp, maxWidth);
            }
        }

        public static string Jpeg(Bitmap bmp, int maxWidth)
        {
            double scale = Math.Min(1.0, (double)maxWidth / bmp.Width);
            int tw = Math.Max(1, (int)(bmp.Width * scale));
            int th = Math.Max(1, (int)(bmp.Height * scale));
            using (Bitmap thumb = new Bitmap(tw, th, PixelFormat.Format24bppRgb))
            {
                using (Graphics g2 = Graphics.FromImage(thumb))
                {
                    g2.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g2.DrawImage(bmp, 0, 0, tw, th);
                }
                using (MemoryStream ms = new MemoryStream())
                {
                    thumb.Save(ms, ImageFormat.Jpeg);
                    return Convert.ToBase64String(ms.ToArray());
                }
            }
        }
    }

    public static class Sys
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        class MEMORYSTATUSEX
        {
            public uint dwLength;
            public uint dwMemoryLoad;
            public ulong ullTotalPhys;
            public ulong ullAvailPhys;
            public ulong ullTotalPageFile;
            public ulong ullAvailPageFile;
            public ulong ullTotalVirtual;
            public ulong ullAvailVirtual;
            public ulong ullAvailExtendedVirtual;
            public MEMORYSTATUSEX() { dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX)); }
        }

        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX buf);
        [DllImport("kernel32.dll")] static extern bool GetSystemTimes(out long idle, out long kernel, out long user);

        static Dictionary<int, TimeSpan> lastCpu;
        static DateTime lastSampleAt;
        static long lastIdle, lastKernel, lastUser;

        static Dictionary<int, TimeSpan> SampleCpu(Process[] procs)
        {
            Dictionary<int, TimeSpan> d = new Dictionary<int, TimeSpan>();
            foreach (Process p in procs)
            {
                try { d[p.Id] = p.TotalProcessorTime; } catch { }
            }
            return d;
        }

        static double SystemCpu()
        {
            long idle, kernel, user;
            if (!GetSystemTimes(out idle, out kernel, out user)) return 0;
            long dIdle = idle - lastIdle, dKernel = kernel - lastKernel, dUser = user - lastUser;
            lastIdle = idle; lastKernel = kernel; lastUser = user;
            long total = dKernel + dUser; // kernel time includes idle time
            if (total <= 0) return 0;
            return Math.Max(0, Math.Min(100, (total - dIdle) * 100.0 / total));
        }

        public static ProcSnapshot Processes()
        {
            Process[] procs = Process.GetProcesses();
            if (lastCpu == null)
            {
                lastCpu = SampleCpu(procs);
                lastSampleAt = DateTime.UtcNow;
                SystemCpu();
                Thread.Sleep(500);
                procs = Process.GetProcesses();
            }
            DateTime now = DateTime.UtcNow;
            double elapsedMs = Math.Max(1, (now - lastSampleAt).TotalMilliseconds);
            Dictionary<int, TimeSpan> cur = SampleCpu(procs);
            int cores = Environment.ProcessorCount;
            // One window enumeration instead of Process.MainWindowHandle per process (which is slow).
            Dictionary<int, string> windowTitles = new Dictionary<int, string>();
            foreach (WindowInfo w in Win.ListWindows())
            {
                if (!windowTitles.ContainsKey(w.pid)) windowTitles[w.pid] = w.title;
            }
            List<ProcInfo> list = new List<ProcInfo>();
            foreach (Process p in procs)
            {
                if (p.Id == 0) continue;
                ProcInfo pi = new ProcInfo();
                pi.pid = p.Id;
                pi.name = p.ProcessName;
                TimeSpan a, b;
                if (cur.TryGetValue(p.Id, out a) && lastCpu.TryGetValue(p.Id, out b))
                {
                    pi.cpu = Math.Round(Math.Max(0, (a - b).TotalMilliseconds / (elapsedMs * cores) * 100.0), 1);
                }
                try { pi.memory = p.WorkingSet64; } catch { }
                string title;
                if (windowTitles.TryGetValue(p.Id, out title))
                {
                    pi.hasWindow = true;
                    pi.title = title;
                }
                list.Add(pi);
            }
            lastCpu = cur;
            lastSampleAt = now;
            ProcSnapshot snap = new ProcSnapshot();
            snap.processes = list;
            snap.cores = cores;
            snap.cpu = Math.Round(SystemCpu(), 1);
            MEMORYSTATUSEX m = new MEMORYSTATUSEX();
            if (GlobalMemoryStatusEx(m))
            {
                snap.memTotal = (long)m.ullTotalPhys;
                snap.memUsed = (long)(m.ullTotalPhys - m.ullAvailPhys);
            }
            return snap;
        }
    }

    public static class Clip
    {
        static T Retry<T>(Func<T> f)
        {
            Exception last = null;
            for (int i = 0; i < 5; i++)
            {
                try { return f(); }
                catch (ExternalException e) { last = e; Thread.Sleep(100); }
            }
            throw last;
        }

        public static ClipContent Get()
        {
            return Retry(delegate
            {
                ClipContent c = new ClipContent();
                if (System.Windows.Forms.Clipboard.ContainsText())
                    c.text = System.Windows.Forms.Clipboard.GetText();
                if (System.Windows.Forms.Clipboard.ContainsImage())
                {
                    using (Image img = System.Windows.Forms.Clipboard.GetImage())
                    {
                        if (img != null)
                        {
                            using (MemoryStream ms = new MemoryStream())
                            {
                                img.Save(ms, ImageFormat.Png);
                                c.image = Convert.ToBase64String(ms.ToArray());
                            }
                        }
                    }
                }
                if (System.Windows.Forms.Clipboard.ContainsFileDropList())
                {
                    System.Collections.Specialized.StringCollection files = System.Windows.Forms.Clipboard.GetFileDropList();
                    string[] arr = new string[files.Count];
                    files.CopyTo(arr, 0);
                    c.files = arr;
                }
                return c;
            });
        }

        public static bool SetText(string text)
        {
            return Retry(delegate
            {
                if (string.IsNullOrEmpty(text)) System.Windows.Forms.Clipboard.Clear();
                else System.Windows.Forms.Clipboard.SetText(text);
                return true;
            });
        }

        public static bool SetImage(string base64)
        {
            byte[] bytes = Convert.FromBase64String(base64);
            return Retry(delegate
            {
                using (MemoryStream ms = new MemoryStream(bytes))
                using (Image img = Image.FromStream(ms))
                {
                    System.Windows.Forms.Clipboard.SetImage(img);
                }
                return true;
            });
        }
    }

    public static class Shell
    {
        [StructLayout(LayoutKind.Sequential)]
        struct SIZE { public int cx; public int cy; }

        [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IShellItemImageFactory
        {
            [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm);
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
        static extern void SHCreateItemFromParsingName(
            string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
            [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);

        const int SIIGBF_ICONONLY = 0x4;

        /// PNG icon (base64) for a Start menu app id, or null.
        public static string AppIcon(string appId, int size)
        {
            if (size <= 0) size = 96;
            IShellItemImageFactory factory;
            try
            {
                SHCreateItemFromParsingName("shell:AppsFolder\\" + appId, IntPtr.Zero,
                    typeof(IShellItemImageFactory).GUID, out factory);
            }
            catch { return null; }
            SIZE sz = new SIZE();
            sz.cx = size;
            sz.cy = size;
            IntPtr hbm;
            if (factory.GetImage(sz, SIIGBF_ICONONLY, out hbm) != 0 || hbm == IntPtr.Zero) return null;
            try
            {
                using (Bitmap bmp = WithAlpha(hbm))
                using (MemoryStream ms = new MemoryStream())
                {
                    bmp.Save(ms, ImageFormat.Png);
                    return Convert.ToBase64String(ms.ToArray());
                }
            }
            finally { DeleteObject(hbm); }
        }

        // Image.FromHbitmap drops the alpha channel; copy the raw 32-bit pixels instead.
        static Bitmap WithAlpha(IntPtr hbm)
        {
            Bitmap src = Image.FromHbitmap(hbm);
            if (Image.GetPixelFormatSize(src.PixelFormat) < 32) return src;
            Rectangle rect = new Rectangle(0, 0, src.Width, src.Height);
            BitmapData data = src.LockBits(rect, ImageLockMode.ReadOnly, src.PixelFormat);
            try
            {
                byte[] raw = new byte[Math.Abs(data.Stride) * data.Height];
                Marshal.Copy(data.Scan0, raw, 0, raw.Length);
                bool anyAlpha = false;
                for (int i = 3; i < raw.Length; i += 4) { if (raw[i] != 0) { anyAlpha = true; break; } }
                if (!anyAlpha) return new Bitmap(src);
                using (Bitmap view = new Bitmap(data.Width, data.Height, data.Stride, PixelFormat.Format32bppArgb, data.Scan0))
                {
                    return new Bitmap(view);
                }
            }
            finally
            {
                src.UnlockBits(data);
                src.Dispose();
            }
        }

        public static bool Recycle(string path)
        {
            if (Directory.Exists(path))
            {
                Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(path,
                    Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
                    Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                return true;
            }
            if (File.Exists(path))
            {
                Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(path,
                    Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
                    Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
                return true;
            }
            throw new FileNotFoundException("Not found: " + path);
        }

        public static Dictionary<string, string> KnownFolders()
        {
            Dictionary<string, string> d = new Dictionary<string, string>();
            d["home"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            d["desktop"] = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            d["documents"] = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            d["pictures"] = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
            d["music"] = Environment.GetFolderPath(Environment.SpecialFolder.MyMusic);
            d["videos"] = Environment.GetFolderPath(Environment.SpecialFolder.MyVideos);
            d["downloads"] = Path.Combine(d["home"], "Downloads");
            return d;
        }
    }

    /// Monitors in the same order ffmpeg's ddagrab numbers them (outputs of the default DXGI adapter).
    public static class Display
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct DXGI_OUTPUT_DESC
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
            public Win.RECT DesktopCoordinates;
            public int AttachedToDesktop;
            public int Rotation;
            public IntPtr Monitor;
        }

        [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IDXGIFactory1
        {
            [PreserveSig] int SetPrivateData(ref Guid name, uint size, IntPtr data);
            [PreserveSig] int SetPrivateDataInterface(ref Guid name, IntPtr unknown);
            [PreserveSig] int GetPrivateData(ref Guid name, ref uint size, IntPtr data);
            [PreserveSig] int GetParent(ref Guid riid, out IntPtr parent);
            [PreserveSig] int EnumAdapters(uint index, out IDXGIAdapter adapter);
        }

        [ComImport, Guid("2411e7e1-12ac-4ccf-bd14-9798e8534dc0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IDXGIAdapter
        {
            [PreserveSig] int SetPrivateData(ref Guid name, uint size, IntPtr data);
            [PreserveSig] int SetPrivateDataInterface(ref Guid name, IntPtr unknown);
            [PreserveSig] int GetPrivateData(ref Guid name, ref uint size, IntPtr data);
            [PreserveSig] int GetParent(ref Guid riid, out IntPtr parent);
            [PreserveSig] int EnumOutputs(uint index, out IDXGIOutput output);
        }

        [ComImport, Guid("ae02eedb-c735-4690-8d52-5a8dc20213aa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IDXGIOutput
        {
            [PreserveSig] int SetPrivateData(ref Guid name, uint size, IntPtr data);
            [PreserveSig] int SetPrivateDataInterface(ref Guid name, IntPtr unknown);
            [PreserveSig] int GetPrivateData(ref Guid name, ref uint size, IntPtr data);
            [PreserveSig] int GetParent(ref Guid riid, out IntPtr parent);
            [PreserveSig] int GetDesc(out DXGI_OUTPUT_DESC desc);
        }

        [DllImport("dxgi.dll")]
        static extern int CreateDXGIFactory1([In] ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IDXGIFactory1 factory);

        public static List<OutputInfo> Outputs()
        {
            List<OutputInfo> list = new List<OutputInfo>();
            try
            {
                Guid iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
                IDXGIFactory1 factory;
                if (CreateDXGIFactory1(ref iid, out factory) == 0 && factory != null)
                {
                    IDXGIAdapter adapter;
                    if (factory.EnumAdapters(0, out adapter) == 0 && adapter != null)
                    {
                        for (uint i = 0; i < 16; i++)
                        {
                            IDXGIOutput output;
                            if (adapter.EnumOutputs(i, out output) != 0 || output == null) break;
                            DXGI_OUTPUT_DESC desc;
                            if (output.GetDesc(out desc) == 0)
                            {
                                OutputInfo o = new OutputInfo();
                                o.index = (int)i;
                                o.name = desc.DeviceName;
                                o.x = desc.DesktopCoordinates.Left;
                                o.y = desc.DesktopCoordinates.Top;
                                o.width = desc.DesktopCoordinates.Right - desc.DesktopCoordinates.Left;
                                o.height = desc.DesktopCoordinates.Bottom - desc.DesktopCoordinates.Top;
                                o.primary = o.x == 0 && o.y == 0;
                                o.dxgi = true;
                                list.Add(o);
                            }
                            Marshal.ReleaseComObject(output);
                        }
                        Marshal.ReleaseComObject(adapter);
                    }
                    Marshal.ReleaseComObject(factory);
                }
            }
            catch { }
            if (list.Count == 0)
            {
                // Fallback (no DXGI): ordering may not match ddagrab, so these are captured with gdigrab.
                int i = 0;
                foreach (System.Windows.Forms.Screen sc in System.Windows.Forms.Screen.AllScreens)
                {
                    OutputInfo o = new OutputInfo();
                    o.index = i++;
                    o.name = sc.DeviceName;
                    o.x = sc.Bounds.X;
                    o.y = sc.Bounds.Y;
                    o.width = sc.Bounds.Width;
                    o.height = sc.Bounds.Height;
                    o.primary = sc.Primary;
                    o.dxgi = false;
                    list.Add(o);
                }
            }
            return list;
        }

        /// JPEG (base64) of a screen rectangle in physical virtual-desktop pixels.
        public static string Shot(int x, int y, int w, int h, int maxWidth)
        {
            if (w <= 0 || h <= 0) return null;
            if (maxWidth <= 0) maxWidth = 800;
            using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.CopyFromScreen(x, y, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
                }
                return Win.Jpeg(bmp, maxWidth);
            }
        }
    }

    /// Mouse and keyboard injection for the live desktop.
    public static class Input
    {
        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

        [StructLayout(LayoutKind.Sequential)]
        struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct INPUT { public uint type; public InputUnion u; }

        [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
        [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")] static extern bool GetCursorPos(out Win.POINT p);
        [DllImport("user32.dll")] static extern int GetSystemMetrics(int idx);

        const uint KEYUP = 0x0002, EXTENDED = 0x0001, UNICODE = 0x0004;

        static void Send(params INPUT[] inputs)
        {
            if (inputs.Length == 0) return;
            if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) == 0)
                throw new InvalidOperationException("Windows blocked the input (an admin window or the lock screen may be in front).");
        }

        static INPUT Mouse(uint flags, uint data)
        {
            INPUT i = new INPUT();
            i.type = 0;
            i.u.mi.dwFlags = flags;
            i.u.mi.mouseData = data;
            return i;
        }

        static INPUT Key(ushort vk, ushort scan, uint flags)
        {
            INPUT i = new INPUT();
            i.type = 1;
            i.u.ki.wVk = vk;
            i.u.ki.wScan = scan;
            i.u.ki.dwFlags = flags;
            return i;
        }

        static bool Extended(int vk)
        {
            switch (vk)
            {
                case 0x21: case 0x22: case 0x23: case 0x24: case 0x25: case 0x26: case 0x27: case 0x28:
                case 0x2C: case 0x2D: case 0x2E: case 0x5B: case 0x5C: case 0x5D: case 0x6F: case 0x90:
                case 0xA3: case 0xA5:
                    return true;
                default:
                    return false;
            }
        }

        static uint ButtonFlag(string button, bool down)
        {
            if (button == "right") return down ? 0x0008u : 0x0010u;
            if (button == "middle") return down ? 0x0020u : 0x0040u;
            return down ? 0x0002u : 0x0004u;
        }

        static int[] Cursor()
        {
            Win.POINT p;
            GetCursorPos(out p);
            return new int[] { p.X, p.Y };
        }

        static void MoveTo(int x, int y)
        {
            int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77);
            int vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
            x = Math.Max(vx, Math.Min(vx + vw - 1, x));
            y = Math.Max(vy, Math.Min(vy + vh - 1, y));
            SetCursorPos(x, y);
        }

        public static void Keys(int[] vks)
        {
            if (vks == null || vks.Length == 0) return;
            List<INPUT> list = new List<INPUT>();
            foreach (int vk in vks) list.Add(Key((ushort)vk, 0, Extended(vk) ? EXTENDED : 0));
            for (int i = vks.Length - 1; i >= 0; i--) list.Add(Key((ushort)vks[i], 0, KEYUP | (Extended(vks[i]) ? EXTENDED : 0)));
            Send(list.ToArray());
        }

        public static void Text(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            List<INPUT> list = new List<INPUT>();
            foreach (char c in text)
            {
                if (c == '\n' || c == '\r')
                {
                    list.Add(Key(0x0D, 0, 0));
                    list.Add(Key(0x0D, 0, KEYUP));
                    continue;
                }
                if (c == '\t')
                {
                    list.Add(Key(0x09, 0, 0));
                    list.Add(Key(0x09, 0, KEYUP));
                    continue;
                }
                list.Add(Key(0, c, UNICODE));
                list.Add(Key(0, c, UNICODE | KEYUP));
            }
            Send(list.ToArray());
        }

        /// One entry point for every pointer/keyboard action, so PowerShell stays a thin dispatcher.
        public static int[] Do(string kind, bool at, int x, int y, string button, int count, string text, int[] keys)
        {
            switch (kind)
            {
                case "move":
                    MoveTo(x, y);
                    return null;
                case "rel":
                    {
                        int[] p = Cursor();
                        MoveTo(p[0] + x, p[1] + y);
                        return Cursor();
                    }
                case "cursor":
                    return Cursor();
                case "down":
                    if (at) MoveTo(x, y);
                    Send(Mouse(ButtonFlag(button, true), 0));
                    return null;
                case "up":
                    if (at) MoveTo(x, y);
                    Send(Mouse(ButtonFlag(button, false), 0));
                    return null;
                case "click":
                    {
                        if (at) MoveTo(x, y);
                        int n = Math.Max(1, Math.Min(3, count));
                        List<INPUT> list = new List<INPUT>();
                        for (int i = 0; i < n; i++)
                        {
                            list.Add(Mouse(ButtonFlag(button, true), 0));
                            list.Add(Mouse(ButtonFlag(button, false), 0));
                        }
                        Send(list.ToArray());
                        return null;
                    }
                case "scroll":
                    {
                        List<INPUT> list = new List<INPUT>();
                        if (y != 0) list.Add(Mouse(0x0800, unchecked((uint)y)));
                        if (x != 0) list.Add(Mouse(0x1000, unchecked((uint)x)));
                        Send(list.ToArray());
                        return null;
                    }
                case "keys":
                    Keys(keys);
                    return null;
                case "text":
                    Text(text);
                    return null;
                default:
                    throw new ArgumentException("Unknown input: " + kind);
            }
        }
    }

    /// Volume, media keys, power and status for the phone's Control Center.
    public static class Machine
    {
        [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
        class MMDeviceEnumerator { }

        [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDeviceEnumerator
        {
            [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
            [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        }

        [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IMMDevice
        {
            [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        }

        [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IAudioEndpointVolume
        {
            [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
            [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
            [PreserveSig] int GetChannelCount(out uint count);
            [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid context);
            [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
            [PreserveSig] int GetMasterVolumeLevel(out float level);
            [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
            [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
            [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
            [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
            [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
            [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
            [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
        }

        [DllImport("user32.dll")] static extern bool LockWorkStation();
        [DllImport("powrprof.dll")] static extern bool SetSuspendState(bool hibernate, bool force, bool disableWake);
        [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
        [DllImport("kernel32.dll")] static extern ulong GetTickCount64();

        static IAudioEndpointVolume Endpoint()
        {
            IMMDeviceEnumerator e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out device));
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object o;
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out o));
            return (IAudioEndpointVolume)o;
        }

        public static SystemStatus Status()
        {
            SystemStatus s = new SystemStatus();
            try
            {
                IAudioEndpointVolume v = Endpoint();
                float level;
                bool muted;
                v.GetMasterVolumeLevelScalar(out level);
                v.GetMute(out muted);
                s.volume = (int)Math.Round(level * 100);
                s.muted = muted;
            }
            catch { s.volume = -1; }
            System.Windows.Forms.PowerStatus power = System.Windows.Forms.SystemInformation.PowerStatus;
            s.hasBattery = (power.BatteryChargeStatus & System.Windows.Forms.BatteryChargeStatus.NoSystemBattery) == 0
                && power.BatteryLifePercent <= 1.0f;
            s.battery = s.hasBattery ? (int)Math.Round(power.BatteryLifePercent * 100) : -1;
            s.charging = power.PowerLineStatus == System.Windows.Forms.PowerLineStatus.Online;
            s.user = Environment.UserName;
            s.uptimeSeconds = (long)(GetTickCount64() / 1000);
            return s;
        }

        public static SystemStatus SetVolume(int level, string mute)
        {
            IAudioEndpointVolume v = Endpoint();
            Guid ctx = Guid.Empty;
            if (level >= 0) v.SetMasterVolumeLevelScalar(Math.Min(100, level) / 100f, ref ctx);
            if (mute == "true" || mute == "false") v.SetMute(mute == "true", ref ctx);
            return Status();
        }

        public static bool Media(string action)
        {
            int vk;
            switch (action)
            {
                case "playpause": vk = 0xB3; break;
                case "next": vk = 0xB0; break;
                case "prev": vk = 0xB1; break;
                case "stop": vk = 0xB2; break;
                default: throw new ArgumentException("Unknown media action: " + action);
            }
            Input.Keys(new int[] { vk });
            return true;
        }

        public static bool Power(string action)
        {
            switch (action)
            {
                case "lock":
                    return LockWorkStation();
                case "displayoff":
                    return PostMessage(new IntPtr(0xFFFF), 0x0112, new IntPtr(0xF170), new IntPtr(2));
                case "sleep":
                    // Reply first; the call only returns after the PC wakes up again.
                    Thread t = new Thread(delegate () { Thread.Sleep(800); SetSuspendState(false, false, false); });
                    t.IsBackground = true;
                    t.Start();
                    return true;
                default:
                    throw new ArgumentException("Unknown power action: " + action);
            }
        }

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        static extern bool SystemParametersInfo(uint action, uint param, StringBuilder value, uint winIni);

        public static string WallpaperPath()
        {
            StringBuilder sb = new StringBuilder(1024);
            SystemParametersInfo(0x73, (uint)sb.Capacity, sb, 0);
            string path = sb.ToString();
            if (!string.IsNullOrEmpty(path) && File.Exists(path)) return path;
            string transcoded = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Microsoft\\Windows\\Themes\\TranscodedWallpaper");
            return File.Exists(transcoded) ? transcoded : null;
        }
    }
}
