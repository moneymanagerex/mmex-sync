pub mod app;
pub mod help;
pub mod i18n;

pub use app::MmexSyncGuiApp;
pub use help::HELP_MARKDOWN;
pub use i18n::Language;

use std::sync::Arc;

use eframe::egui;

use crate::cli::CliArgs;
use crate::error::SyncError;

/// Raw PNG bytes embedded at compile time from the repository assets
const WINDOW_ICON_PNG: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/assets/icons/icon.png"
));

/// Decodes the embedded PNG into an `egui::IconData` (RGBA8) structure for `ViewportBuilder`.
pub fn load_window_icon() -> Option<Arc<egui::IconData>> {
    let image = image::load_from_memory(WINDOW_ICON_PNG).ok()?.into_rgba8();
    let (width, height) = image.dimensions();
    let rgba = image.into_raw();

    Some(Arc::new(egui::IconData {
        rgba,
        width,
        height,
    }))
}

/// Determines whether the X11 backend should be preferred over Wayland on Linux
/// (e.g., on WSLg or environments without a `/dev/dri` render node where Wayland EGL/Zink fails).
pub fn should_prefer_x11_on_linux(
    has_x11_display: bool,
    has_wayland_display: bool,
    force_wayland: bool,
    is_wsl: bool,
    has_dri_device: bool,
) -> bool {
    if !has_x11_display || !has_wayland_display || force_wayland {
        return false;
    }
    is_wsl || !has_dri_device
}

#[cfg(target_os = "linux")]
fn configure_linux_display_backend() {
    let has_x11 = std::env::var_os("DISPLAY")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    let has_wayland = std::env::var_os("WAYLAND_DISPLAY")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    let force_wayland = std::env::var("MMEX_FORCE_WAYLAND")
        .map(|v| matches!(v.trim().to_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    let is_wsl = std::env::var_os("WSL_DISTRO_NAME").is_some()
        || std::env::var_os("WSL_INTEROP").is_some()
        || std::path::Path::new("/mnt/wslg").exists();
    let has_dri = std::path::Path::new("/dev/dri/renderD128").exists()
        || std::path::Path::new("/dev/dri/card0").exists();

    if should_prefer_x11_on_linux(has_x11, has_wayland, force_wayland, is_wsl, has_dri) {
        std::env::remove_var("WAYLAND_DISPLAY");
    }
}

/// Avvia l'interfaccia grafica desktop nativa di MMEX-Sync
pub fn run_gui(args: CliArgs, allow_auto_start: bool) -> Result<(), SyncError> {
    #[cfg(target_os = "linux")]
    configure_linux_display_backend();

    let mut viewport = eframe::egui::ViewportBuilder::default()
        .with_title("MMEX-Sync - Configuration & Synchronization Gateway")
        .with_inner_size([800.0, 640.0])
        .with_min_inner_size([640.0, 480.0]);

    if let Some(icon) = load_window_icon() {
        viewport = viewport.with_icon(icon);
    }

    let native_options = eframe::NativeOptions {
        viewport,
        ..Default::default()
    };

    eframe::run_native(
        "MMEX-Sync",
        native_options,
        Box::new(move |cc| Ok(Box::new(MmexSyncGuiApp::new(cc, args, allow_auto_start)))),
    )
    .map_err(|e| {
        SyncError::Config(crate::i18n::t_fmt(
            "errors.gui_init_failed",
            &[("error", &e.to_string())],
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_window_icon_valid_rgba() {
        let icon = load_window_icon().expect("Window icon should decode from embedded PNG");
        assert!(icon.width > 0);
        assert!(icon.height > 0);
        assert_eq!(icon.rgba.len(), (icon.width * icon.height * 4) as usize);
    }

    #[test]
    fn test_should_prefer_x11_on_linux() {
        // WSLg (has both DISPLAY and WAYLAND_DISPLAY, is_wsl = true) -> prefer X11
        assert!(should_prefer_x11_on_linux(true, true, false, true, true));
        // Linux without /dev/dri (has both DISPLAY and WAYLAND_DISPLAY, has_dri = false) -> prefer X11
        assert!(should_prefer_x11_on_linux(true, true, false, false, false));
        // Native Linux with Wayland + /dev/dri (not WSL, has_dri = true) -> keep Wayland
        assert!(!should_prefer_x11_on_linux(true, true, false, false, true));
        // Explicit MMEX_FORCE_WAYLAND=1 -> keep Wayland even on WSL
        assert!(!should_prefer_x11_on_linux(true, true, true, true, false));
        // Pure Wayland without Xwayland DISPLAY -> keep Wayland
        assert!(!should_prefer_x11_on_linux(false, true, false, true, false));
    }
}
