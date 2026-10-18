# Checks the installed DigUp's search panel on a Windows desktop as a person uses it: the shortcut brings it up, typing
# goes into its field, a click elsewhere puts it away. Then again after WebView2's browser process dies under DigUp, as
# it did on a PC where an overlay's graphics hook (RivaTuner's) crashed it seconds after the first launch: the panel was
# an empty frame that took no keys and stayed up. Reads the field through UI Automation, as a screen reader would.
# Screenshots of each step go to the folder given. The packages workflow runs it after check-windows-package.sh.
#   pwsh scripts/check-windows-panel.ps1 -Out <folder for screenshots>
param([Parameter(Mandatory)][string]$Out)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Input {
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
  public static void Down(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); }
  public static void Up(byte vk) { keybd_event(vk, 0, 2, UIntPtr.Zero); }
  public static void Click(int x, int y) { SetCursorPos(x, y); mouse_event(2, 0, 0, 0, UIntPtr.Zero); mouse_event(4, 0, 0, 0, UIntPtr.Zero); }
}
'@
$automation = [System.Windows.Automation.AutomationElement]

function Shot($name) {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save("$Out\$name.png")
  $graphics.Dispose(); $bitmap.Dispose()
}

# The panel: DigUp's window as wide as the panel (the window is wider), if it's on screen.
function Panel {
  $windows = $automation::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition($automation::NameProperty, 'DigUp')))
  $windows | Where-Object { $_.Current.BoundingRectangle.Width -lt 900 -and -not $_.Current.IsOffscreen } | Select-Object -First 1
}

# What the panel's field holds, or $null when the panel has no field (its page is gone).
function Field($panel) {
  $edit = $panel.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition($automation::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit)))
  if (-not $edit) { return $null }
  $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
}

function Wait-For($what, [scriptblock]$test, $seconds = 10) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try { if (& $test) { return } } catch {}
    Start-Sleep -Milliseconds 250
  }
  throw "the panel: $what"
}

function Send-Text($text) {
  foreach ($letter in $text.ToUpper().ToCharArray()) { [Input]::Down([byte]$letter); Start-Sleep -Milliseconds 30; [Input]::Up([byte]$letter); Start-Sleep -Milliseconds 40 }
}

# Ctrl+Shift+Space, the default shortcut, typed into the panel, then a click far from it.
function Use-Panel($step, $text) {
  [Input]::Down(0x11); [Input]::Down(0x10); [Input]::Down(0x20)
  Start-Sleep -Milliseconds 80
  [Input]::Up(0x20); [Input]::Up(0x10); [Input]::Up(0x11)
  try {
    Wait-For 'comes up on its shortcut' { Panel }
    Wait-For 'has its field' { $null -ne (Field (Panel)) }
    Send-Text $text
    Wait-For 'takes typing' { (Field (Panel)) -eq $text }
    Shot "$step-typed"
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    [Input]::Click(30, [int]($bounds.Height - 200))
    Wait-For 'steps away on a click elsewhere' { -not (Panel) }
  } catch {
    Shot "$step-failed"
    throw
  }
  "$step`: ok"
}

$app = "$env:LOCALAPPDATA\DigUp\DigUp.exe"
$work = Join-Path ([System.IO.Path]::GetTempPath()) "digup-panel-$PID"
New-Item -ItemType Directory -Force "$work\files" | Out-Null
Set-Content "$work\files\recipe.txt" "Lemon cake: bake it for forty minutes."
$digup = Start-Process $app -PassThru -ArgumentList '--roots', "$work\files", '--index', "$work\index", '--settings',
  "$work\settings.json", '--hotkey', 'Ctrl+Shift+Space'
try {
  # Opened by hand, DigUp shows its window; the panel waits, hidden, for its shortcut.
  Wait-For 'DigUp opened its window' { $automation::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition($automation::NameProperty, 'DigUp'))) } 60
  Start-Sleep 3
  Use-Panel 'shown' 'lemon'

  $browsers = Get-CimInstance Win32_Process -Filter "Name = 'msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -like '*com.abdurrahim.DigUp*' -and $_.CommandLine -notlike '*--type=*' }
  if (-not $browsers) { throw "no WebView2 browser process of DigUp's to end" }
  $browsers | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  "ended WebView2's browser process ($($browsers.ProcessId -join ', '))"
  Start-Sleep 5
  Use-Panel 'after-webview2-died' 'cake'
} finally {
  Stop-Process -Id $digup.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
