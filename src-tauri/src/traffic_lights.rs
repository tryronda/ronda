//! Hides the native macOS window buttons; the top bar draws its own (see `WindowControls`).
//!
//! With the overlay title bar, AppKit renders unfocused buttons as translucent glass that
//! samples what is behind them. Behind them is the WKWebView, whose content lives in another
//! process, so the buttons vanish whenever the window loses focus. AppKit can also re-show
//! them during title bar layout, so this runs again on focus and resize.

use objc2_app_kit::{NSWindow, NSWindowButton};
use tauri::{Runtime, WebviewWindow};

pub fn hide<R: Runtime>(window: &WebviewWindow<R>) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(ptr) = target.ns_window() else { return };
        // SAFETY: `ns_window` is this webview window's live NSWindow, and we are on the main thread.
        let ns_window: &NSWindow = unsafe { &*(ptr as *const NSWindow) };
        for kind in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = ns_window.standardWindowButton(kind) {
                button.setHidden(true);
            }
        }
    });
}
