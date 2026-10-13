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
        [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);

        const uint GW_OWNER = 4;
        const int GWL_EXSTYLE = -20;
        const long WS_EX_TOOLWINDOW = 0x80;
        const int DWMWA_CLOAKED = 14;
        const uint WM_CLOSE = 0x0010;

        public static void Init()
        {
            try { SetProcessDPIAware(); } catch { }
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
                double scale = Math.Min(1.0, (double)maxWidth / w);
                int tw = Math.Max(1, (int)(w * scale));
                int th = Math.Max(1, (int)(ht * scale));
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
}
