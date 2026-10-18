//! Windows 11's look for DigUp's windows: the backdrop behind each page (Acrylic behind the panel, Mica behind the
//! window, Settings and setup), the system's rounded corners, and the person's accent color, which the pages use for
//! selection, focus and their primary buttons. Elsewhere (Windows 10, Linux) the pages draw their own surface, as before.
//! When the person switches between light and dark or picks another accent, the backdrop windows' title bars and tints
//! follow, and every page is sent its new look (event `system-look`, the same JSON as `system_look`).

use serde_json::{json, Value};

/// The backdrop a window gets.
#[derive(Clone, Copy, PartialEq)]
pub enum Backdrop {
    /// The panel: it floats over other apps, so it shows them blurred through it, as the Start menu does.
    Acrylic,
    /// Windows that stay open: the desktop's colors, faintly.
    Mica,
}

/// Windows 11 is build 22000 on; Mica and the system's rounded corners need it.
#[cfg(windows)]
pub fn is_windows_11() -> bool {
    use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OSVERSIONINFOW) -> i32;
    }
    let mut info: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    unsafe { RtlGetVersion(&mut info) == 0 && info.dwMajorVersion >= 10 && info.dwBuildNumber >= 22000 }
}

#[cfg(not(windows))]
pub fn is_windows_11() -> bool {
    false
}

/// Puts the backdrop behind a window made transparent, and asks for the system's rounded corners (a window without
/// decorations, like the panel, doesn't get them by itself).
pub fn apply(window: &tauri::WebviewWindow, backdrop: Backdrop) {
    if !is_windows_11() {
        return;
    }
    use tauri::utils::config::WindowEffectsConfig;
    use tauri::window::Effect;
    let effect = match backdrop {
        Backdrop::Acrylic => Effect::Acrylic,
        Backdrop::Mica => Effect::Mica,
    };
    if let Err(error) = window.set_effects(WindowEffectsConfig { effects: vec![effect], ..Default::default() }) {
        eprintln!("digup-shell: no backdrop for {}: {error}", window.label());
    }
    #[cfg(windows)]
    {
        round_corners(window);
        follow_theme(window);
    }
}

/// The light or dark title bar, and the backdrop's tint with it (Mica and Acrylic take theirs from this attribute), as
/// the system's apps are now. Tao sets it as windows are made and as the theme changes too; this keeps a backdrop window
/// right whichever comes last.
#[cfg(windows)]
fn follow_theme(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
    let Ok(hwnd) = window.hwnd() else { return };
    let dark: i32 = apps_dark().into();
    unsafe {
        DwmSetWindowAttribute(hwnd.0 as _, DWMWA_USE_IMMERSIVE_DARK_MODE as u32, &dark as *const _ as *const _,
                              std::mem::size_of_val(&dark) as u32);
    }
}

/// Apps are dark (Settings → Personalization → Colors → Choose your app mode) and high contrast is off, as tao decides.
#[cfg(windows)]
fn apps_dark() -> bool {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    use windows_sys::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETHIGHCONTRAST};
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
    let name = wide("AppsUseLightTheme");
    let mut light: u32 = 1;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: each call writes at most the size it's told into a value of that size.
    unsafe {
        RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(),
                     (&mut light as *mut u32).cast(), &mut size);
        let mut contrast: HIGHCONTRASTW = std::mem::zeroed();
        contrast.cbSize = std::mem::size_of::<HIGHCONTRASTW>() as u32;
        let asked = SystemParametersInfoW(SPI_GETHIGHCONTRAST, contrast.cbSize, (&mut contrast as *mut HIGHCONTRASTW).cast(), 0);
        light == 0 && !(asked != 0 && contrast.dwFlags & HCF_HIGHCONTRASTON != 0)
    }
}

/// The person changed light or dark, or the accent (system.rs): the windows with a backdrop follow, and every page gets
/// its new look.
pub fn changed(app: &tauri::AppHandle) {
    use tauri::{Emitter, Manager};
    for window in app.webview_windows().into_values() {
        #[cfg(windows)]
        if has_backdrop(&window) {
            follow_theme(&window);
        }
        let _ = window.emit_to(window.label(), "system-look", look_of(&window));
    }
}

#[cfg(windows)]
fn round_corners(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND};
    let Ok(hwnd) = window.hwnd() else { return };
    let preference = DWMWCP_ROUND;
    unsafe {
        DwmSetWindowAttribute(hwnd.0 as _, DWMWA_WINDOW_CORNER_PREFERENCE as u32, &preference as *const _ as *const _,
                              std::mem::size_of_val(&preference) as u32);
    }
}

/// The person's accent color in its seven shades, as Windows keeps it (Settings → Personalization → Colors): the
/// lightest first, the accent itself in the middle, as WinUI's SystemAccentColorLight3…Dark3. CSS hex colors.
#[cfg(windows)]
fn accent_palette() -> Option<Vec<String>> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_BINARY};
    let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Accent");
    let name = wide("AccentPalette");
    let mut bytes = [0u8; 32];
    let mut size = bytes.len() as u32;
    let status = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_BINARY, std::ptr::null_mut(),
                     bytes.as_mut_ptr().cast(), &mut size)
    };
    if status != 0 || size < 28 {
        return None;
    }
    // Eight RGBA entries; the eighth is unused.
    Some(bytes.chunks(4).take(7).map(|c| format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])).collect())
}

#[cfg(not(windows))]
fn accent_palette() -> Option<Vec<String>> {
    None
}

/// What a page needs to dress itself: whether its window has a backdrop (then its body stays transparent), and the
/// accent's shades when the system has them.
#[tauri::command]
pub fn system_look(window: tauri::WebviewWindow) -> Value {
    look_of(&window)
}

fn look_of(window: &tauri::WebviewWindow) -> Value {
    json!({ "backdrop": has_backdrop(window), "accent": accent_palette() })
}

/// Every window has a backdrop on Windows 11 but a panel centered in a window that fills the screen.
fn has_backdrop(window: &tauri::WebviewWindow) -> bool {
    is_windows_11() && window.label() != "panel-centered"
}
