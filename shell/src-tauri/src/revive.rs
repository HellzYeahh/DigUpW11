//! WebView2's own processes can die under DigUp, and a window whose web view is gone stays on screen as an empty frame:
//! no page, no keys, and never a lost focus (Tauri hears focus from the web view), so the panel never stepped away. On
//! one PC an overlay that hooks every app's graphics (RivaTuner's RTSSHooks64.dll) took WebView2's browser process down
//! seconds after DigUp's first launch, and the panel, made at launch and kept hidden, was dead from then on. Here each
//! window hears when its web view's processes fail: a page that died alone loads again, and a window whose browser
//! process is gone is made again (WebView2 starts a new one), shown again if it was. Elsewhere nothing is needed: WebKit
//! loads a page that died again itself.

use tauri::{AppHandle, WebviewWindow};

/// Watches `window`'s web view; `remake` makes the window again once the dead one is gone, given whether it was shown.
#[cfg(windows)]
pub fn watch(window: &WebviewWindow, remake: impl Fn(&AppHandle, bool) + Send + Sync + 'static) {
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::Arc;
    use tauri::{Manager, WindowEvent};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED, COREWEBVIEW2_PROCESS_FAILED_KIND_UNKNOWN_PROCESS_EXITED,
    };
    use webview2_com::ProcessFailedEventHandler;

    // What to do once the window is destroyed: nothing (0), make it again hidden (1) or shown (2).
    let remaking = Arc::new(AtomicU8::new(0));
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    let failed = remaking.clone();
    let _ = window.with_webview(move |webview| {
        let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND_UNKNOWN_PROCESS_EXITED;
            if let Some(args) = args {
                // SAFETY: the event's own arguments, written into a value of the kind's type.
                let _ = unsafe { args.ProcessFailedKind(&mut kind as *mut COREWEBVIEW2_PROCESS_FAILED_KIND) };
            }
            eprintln!("digup-shell: the {label} window's web view lost a process (kind {})", kind.0);
            // The graphics and helper processes WebView2 starts again by itself.
            let gone = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED;
            if !gone && kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED {
                return Ok(());
            }
            // Not from inside WebView2's event: the window may go.
            let (label, failed) = (label.clone(), failed.clone());
            let app_ = app.clone();
            let _ = app.run_on_main_thread(move || {
                let Some(window) = app_.get_webview_window(&label) else { return };
                if !gone {
                    let _ = window.reload();
                    return;
                }
                failed.store(if window.is_visible().unwrap_or(false) { 2 } else { 1 }, Ordering::SeqCst);
                let _ = window.destroy();
            });
            Ok(())
        }));
        let mut token = 0;
        // SAFETY: the web view is alive for this call; WebView2 keeps the handler.
        if let Err(error) = unsafe {
            webview.controller().CoreWebView2().and_then(|core| core.add_ProcessFailed(&handler, &mut token))
        } {
            eprintln!("digup-shell: can't watch a web view's processes: {error}");
        }
    });
    let app = window.app_handle().clone();
    let remake = Arc::new(remake);
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            let shown = match remaking.swap(0, Ordering::SeqCst) {
                0 => return,
                remade => remade == 2,
            };
            // Tauri has let the old window go (its label is free), and drops its listeners after this event: the new one
            // is made after that.
            let (app_, remake) = (app.clone(), remake.clone());
            let _ = app.run_on_main_thread(move || remake(&app_, shown));
        }
    });
}

#[cfg(not(windows))]
pub fn watch(_window: &WebviewWindow, _remake: impl Fn(&AppHandle, bool) + Send + Sync + 'static) {}
