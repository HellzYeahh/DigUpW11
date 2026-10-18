# Times DigUp's search panel on Windows from its shortcut to the panel on screen, the way a person opens it: the keys
# pressed (Ctrl+Alt+Shift+D, the shortcut scripts/bench.py starts DigUp with), then the clock runs until a window of
# DigUp's is visible. The shortcut again hides it, and it's timed again. Prints one line of JSON: {"shown", "first",
# "median"} in milliseconds, or {"why"} when the panel never showed (no desktop to show it on, as in a service).
#   powershell -File scripts/bench-panel.ps1 -ProcessId <DigUp.exe's>
param([Parameter(Mandatory = $true)][int]$ProcessId, [int]$Count = 8)
$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Panel {
    delegate bool EnumWindowsProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("winmm.dll")] public static extern uint timeBeginPeriod(uint milliseconds);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

    // A visible window of the process big enough to be the panel (the tray's own windows are hidden).
    public static bool Shown(uint process) {
        bool found = false;
        EnumWindows((window, data) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            RECT rect;
            if (owner == process && IsWindowVisible(window) && GetWindowRect(window, out rect)
                && rect.Right - rect.Left > 100 && rect.Bottom - rect.Top > 30) { found = true; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static void Press(byte[] keys) {
        foreach (var key in keys) keybd_event(key, 0, 0, UIntPtr.Zero);
        Array.Reverse(keys);
        foreach (var key in keys) keybd_event(key, 0, 2, UIntPtr.Zero);
    }
}
"@

[Panel]::timeBeginPeriod(1) | Out-Null   # sleeps of 1 ms, not Windows' default 15.6
$shortcut = [byte[]](0x11, 0x12, 0x10, 0x44)   # Ctrl, Alt, Shift, D
$times = @()
for ($n = 0; $n -lt $Count; $n++) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    [Panel]::Press($shortcut.Clone())
    while (-not [Panel]::Shown($ProcessId) -and $clock.ElapsedMilliseconds -lt 5000) { [Threading.Thread]::Sleep(1) }
    if (-not [Panel]::Shown($ProcessId)) { break }
    $times += $clock.Elapsed.TotalMilliseconds
    Start-Sleep -Milliseconds 500
    [Panel]::Press($shortcut.Clone())
    $hiding = [Diagnostics.Stopwatch]::StartNew()
    while ([Panel]::Shown($ProcessId) -and $hiding.ElapsedMilliseconds -lt 3000) { Start-Sleep -Milliseconds 10 }
    Start-Sleep -Milliseconds 700
}
if ($times.Count -eq 0) {
    '{"why": "the panel never showed on its shortcut (no desktop here to show it on?)"}'
} else {
    $rest = @($times | Select-Object -Skip 1 | Sort-Object)
    $median = if ($rest.Count) { $rest[[math]::Floor($rest.Count / 2)] } else { $times[0] }
    @{ shown = $times.Count; first = $times[0]; median = $median } | ConvertTo-Json -Compress
}
