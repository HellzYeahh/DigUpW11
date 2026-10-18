# Diagnostic: the installed DigUp on a Windows desktop, its panel opened with the real shortcut, typed into, and a click
# elsewhere; screenshots and the pages' state (over WebView2's DevTools port) at each step.
param([string]$Setup, [string]$Out)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Out | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class U {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetFocus();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static string Windows(string process) {
    var sb = new StringBuilder();
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      string name = "";
      try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
      if (name == process) { RECT r; GetWindowRect(h, out r);
        sb.AppendLine("  " + Describe(h) + " visible=" + IsWindowVisible(h) + " rect=" + r.L + "," + r.T + " " + (r.R - r.L) + "x" + (r.B - r.T)); }
      return true; }, IntPtr.Zero);
    return sb.ToString();
  }
  public static string Describe(IntPtr h) {
    var t = new StringBuilder(256); var c = new StringBuilder(256);
    GetWindowText(h, t, 256); GetClassName(h, c, 256);
    return h.ToString() + " '" + t + "' (" + c + ")";
  }
  public static void Key(byte vk, bool up) { keybd_event(vk, 0, up ? 2u : 0u, UIntPtr.Zero); }
  public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
}
'@
function Shot($name) {
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $bmp.Save("$Out\$name.png")
  $g.Dispose(); $bmp.Dispose()
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
function Uia {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "DigUp")
  foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
    $r = $w.Current.BoundingRectangle
    Write-Host "  uia window $($w.Current.ClassName) $($r.Width)x$($r.Height) offscreen=$($w.Current.IsOffscreen) focus=$($w.Current.HasKeyboardFocus)"
    $edits = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
    foreach ($e in $edits) {
      $v = ""; try { $v = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value } catch {}
      Write-Host "    edit '$($e.Current.Name)' value='$v' focus=$($e.Current.HasKeyboardFocus) offscreen=$($e.Current.IsOffscreen)"
    }
    $docs = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)))
    Write-Host "    documents: $($docs.Count)"
  }
}
function State($name) {
  Write-Host "=== $name"
  Write-Host ("foreground: " + [U]::Describe([U]::GetForegroundWindow()))
  Write-Host ([U]::Windows("DigUp"))
  try { node "$PSScriptRoot\cdp.mjs" 2>&1 | Select-Object -First 20 | Tee-Object -FilePath "$Out\$name.txt" } catch {}
  try { Uia } catch { Write-Host "uia: $_" }
  Shot $name
}

Write-Host "installing $Setup"
Start-Process -Wait $Setup -ArgumentList '/S'
$app = "$env:LOCALAPPDATA\DigUp\DigUp.exe"
$work = "$env:RUNNER_TEMP\digup-work"
New-Item -ItemType Directory -Force "$work\files" | Out-Null
Set-Content "$work\files\recipe.txt" "Lemon cake. Bake for forty minutes."
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
New-Item -Force 'HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments' | Out-Null
Set-ItemProperty 'HKCU:\Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments' -Name 'DigUp.exe' -Value '--remote-debugging-port=9222'
Start-Process $app -ArgumentList '--roots', "$work\files", '--index', "$work\index", '--settings', "$work\settings.json" `
  -RedirectStandardOutput "$Out\stdout.txt" -RedirectStandardError "$Out\stderr.txt"
Start-Sleep 20
State '1-window'

# Ctrl+Shift+Space, as a person presses it.
[U]::Key(0x11, $false); [U]::Key(0x10, $false); [U]::Key(0x20, $false)
Start-Sleep -Milliseconds 80
[U]::Key(0x20, $true); [U]::Key(0x10, $true); [U]::Key(0x11, $true)
Start-Sleep 4
State '2-panel-shown'

foreach ($vk in 0x48, 0x45, 0x4C, 0x4C, 0x4F) { [U]::Key($vk, $false); Start-Sleep -Milliseconds 30; [U]::Key($vk, $true); Start-Sleep -Milliseconds 60 }
Start-Sleep 2
State '3-typed'

# A click in the panel's field, then typing again.
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
[U]::Click([int]($b.Width / 2), [int]($b.Height * 0.16 + 28))
Start-Sleep 1
foreach ($vk in 0x41, 0x42) { [U]::Key($vk, $false); Start-Sleep -Milliseconds 30; [U]::Key($vk, $true); Start-Sleep -Milliseconds 60 }
Start-Sleep 2
State '4-clicked-and-typed'

# A click far from the panel.
[U]::Click(30, [int]($b.Height - 200))
Start-Sleep 2
State '5-clicked-away'
Get-Content "$Out\stderr.txt" -ErrorAction SilentlyContinue | Select-Object -Last 40
