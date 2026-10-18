//! What the system says changed, for power.rs and look.rs: the power source (a charger plugged in or out, the energy
//! saver), and the person's colors (light or dark, the accent). On Windows a hidden window of DigUp's own hears the
//! system's broadcasts (WM_POWERBROADCAST, WM_SETTINGCHANGE "ImmersiveColorSet", WM_DWMCOLORIZATIONCOLORCHANGED) on a
//! thread of its own, so nothing polls; a burst of color messages (Windows sends several for one change) comes as one.
//! On Linux the power supplies are looked at every ten seconds (sysfs; reading it costs nothing).

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Change {
    Power,
    Look,
}

#[cfg(windows)]
pub fn listen(on_change: impl Fn(Change) + Send + Sync + 'static) {
    windows::listen(Box::new(on_change));
}

#[cfg(target_os = "linux")]
pub fn listen(on_change: impl Fn(Change) + Send + Sync + 'static) {
    std::thread::spawn(move || {
        let mut before = crate::power::now();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(10));
            let now = crate::power::now();
            if now != before {
                before = now;
                on_change(Change::Power);
            }
        }
    });
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn listen(_: impl Fn(Change) + Send + Sync + 'static) {}

#[cfg(windows)]
mod windows {
    use super::Change;
    use std::sync::OnceLock;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Power::RegisterPowerSettingNotification;
    use windows_sys::Win32::System::SystemServices::GUID_POWER_SAVING_STATUS;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, KillTimer, RegisterClassW, SetTimer,
        TranslateMessage, DEVICE_NOTIFY_WINDOW_HANDLE, MSG, WM_DWMCOLORIZATIONCOLORCHANGED, WM_POWERBROADCAST,
        WM_SETTINGCHANGE, WM_THEMECHANGED, WM_TIMER, WNDCLASSW, WS_OVERLAPPED,
    };

    type Sink = Box<dyn Fn(Change) + Send + Sync>;
    static SINK: OnceLock<Sink> = OnceLock::new();
    /// The timer that gathers a burst of color messages into one change.
    const LOOK_TIMER: usize = 1;

    pub fn listen(sink: Sink) {
        if SINK.set(sink).is_err() {
            return;
        }
        std::thread::spawn(|| unsafe {
            let wide = |text: &str| text.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
            let class = wide("DigUpSystemNotices");
            let instance = GetModuleHandleW(std::ptr::null());
            let mut info: WNDCLASSW = std::mem::zeroed();
            info.lpfnWndProc = Some(notice);
            info.hInstance = instance;
            info.lpszClassName = class.as_ptr();
            RegisterClassW(&info);
            // A top-level window that's never shown: broadcasts reach those (a message-only window gets none).
            let window = CreateWindowExW(0, class.as_ptr(), class.as_ptr(), WS_OVERLAPPED, 0, 0, 0, 0,
                                         std::ptr::null_mut(), std::ptr::null_mut(), instance, std::ptr::null());
            if window.is_null() {
                eprintln!("digup-shell: can't hear the system's changes");
                return;
            }
            // The energy saver going on or off (a charger comes as PBT_APMPOWERSTATUSCHANGE by itself).
            RegisterPowerSettingNotification(window, &GUID_POWER_SAVING_STATUS, DEVICE_NOTIFY_WINDOW_HANDLE);
            let mut message: MSG = std::mem::zeroed();
            while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        });
    }

    fn send(change: Change) {
        if let Some(sink) = SINK.get() {
            sink(change);
        }
    }

    /// WM_SETTINGCHANGE's area, when it names one ("ImmersiveColorSet" for the colors).
    unsafe fn area(lparam: LPARAM) -> String {
        let text = lparam as *const u16;
        if text.is_null() {
            return String::new();
        }
        let length = (0..256).take_while(|&index| *text.add(index) != 0).count();
        String::from_utf16_lossy(std::slice::from_raw_parts(text, length))
    }

    unsafe extern "system" fn notice(window: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        match message {
            WM_POWERBROADCAST => send(Change::Power),
            WM_SETTINGCHANGE if area(lparam) == "ImmersiveColorSet" => {
                SetTimer(window, LOOK_TIMER, 250, None);
            }
            WM_DWMCOLORIZATIONCOLORCHANGED | WM_THEMECHANGED => {
                SetTimer(window, LOOK_TIMER, 250, None);
            }
            WM_TIMER if wparam == LOOK_TIMER => {
                KillTimer(window, LOOK_TIMER);
                send(Change::Look);
            }
            _ => {}
        }
        DefWindowProcW(window, message, wparam, lparam)
    }
}
