$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# A persistent, read-only Win32 bridge; stdin EOF also shuts it down after a host crash.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public class YtrpWindowInfo {
    public string hwnd, processName, className;
    public uint pid;
    public bool? topmost;
    public int styleError;
    public bool visible, minimized;
    public int? cloaked;
    public YtrpWindowProbe.Rect? bounds;
}

public class YtrpWindowSnapshot {
    public YtrpWindowInfo own, foreground;
    public List<YtrpWindowInfo> overlapCandidatesAbove = new List<YtrpWindowInfo>();
    public int overlapCount;
    public bool scanTruncated;
}

public static class YtrpWindowProbe {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int left, top, right, bottom; }

    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassName(IntPtr hwnd, StringBuilder name, int capacity);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW", SetLastError = true)]
    static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("kernel32.dll")] static extern void SetLastError(uint error);
    [DllImport("dwmapi.dll")]
    static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attribute, out int value, int size);

    static YtrpWindowInfo Read(IntPtr hwnd, bool identify) {
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return null;
        var info = new YtrpWindowInfo();
        info.hwnd = hwnd.ToInt64().ToString();
        // GWL_EXSTYLE = -20; WS_EX_TOPMOST = 0x8. A failed read is not "false".
        SetLastError(0);
        int style = GetWindowLong(hwnd, -20);
        info.styleError = style == 0 ? Marshal.GetLastWin32Error() : 0;
        info.topmost = info.styleError == 0 ? (bool?)((style & 0x8) != 0) : null;
        info.visible = IsWindowVisible(hwnd);
        info.minimized = IsIconic(hwnd);
        int cloaked;
        // DWMWA_CLOAKED = 14 excludes hidden windows on other virtual desktops.
        info.cloaked = DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) == 0 ? (int?)cloaked : null;
        Rect rect;
        if (GetWindowRect(hwnd, out rect)) info.bounds = rect;
        if (identify) Identify(hwnd, info);
        return info;
    }

    static void Identify(IntPtr hwnd, YtrpWindowInfo info) {
        GetWindowThreadProcessId(hwnd, out info.pid);
        var name = new StringBuilder(256);
        GetClassName(hwnd, name, name.Capacity);
        info.className = name.ToString();
        try {
            using (var process = Process.GetProcessById((int)info.pid)) {
                info.processName = process.ProcessName;
            }
        } catch { info.processName = null; }
    }

    public static YtrpWindowSnapshot Capture(long handle) {
        var hwnd = new IntPtr(handle);
        var snapshot = new YtrpWindowSnapshot();
        snapshot.own = Read(hwnd, true);
        snapshot.foreground = Read(GetForegroundWindow(), true);
        if (snapshot.own == null || !snapshot.own.visible || snapshot.own.minimized ||
            !snapshot.own.bounds.HasValue || snapshot.own.cloaked.GetValueOrDefault() != 0) return snapshot;

        Rect own = snapshot.own.bounds.Value;
        var seen = new HashSet<IntPtr>();
        seen.Add(hwnd);
        // GW_HWNDPREV = 3. Bound the walk because other processes can reorder/destroy windows.
        IntPtr above = GetWindow(hwnd, 3);
        while (above != IntPtr.Zero) {
            if (seen.Count >= 256 || !seen.Add(above)) { snapshot.scanTruncated = true; break; }
            var info = Read(above, false);
            if (info != null && info.visible && !info.minimized &&
                info.cloaked.GetValueOrDefault() == 0 && info.bounds.HasValue) {
                Rect rect = info.bounds.Value;
                if (Math.Max(own.left, rect.left) < Math.Min(own.right, rect.right) &&
                    Math.Max(own.top, rect.top) < Math.Min(own.bottom, rect.bottom)) {
                    snapshot.overlapCount++;
                    if (snapshot.overlapCandidatesAbove.Count < 5) {
                        Identify(above, info);
                        snapshot.overlapCandidatesAbove.Add(info);
                    }
                }
            }
            above = GetWindow(above, 3);
        }
        return snapshot;
    }
}
'@

# Requests contain only a decimal HWND. Each reply is one JSON line; no window titles are read.
while ($null -ne ($windowHandleLine = [Console]::ReadLine())) {
    try {
        $state = [YtrpWindowProbe]::Capture([long]::Parse($windowHandleLine))
        $reply = @{ sampledAt = [DateTime]::UtcNow.ToString('o'); state = $state }
    } catch {
        $reply = @{ error = $_.Exception.Message }
    }
    [Console]::WriteLine(($reply | ConvertTo-Json -Depth 6 -Compress))
}
