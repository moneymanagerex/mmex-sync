pub mod app;
pub mod i18n;

pub use app::MmexSyncGuiApp;
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

/// Avvia l'interfaccia grafica desktop nativa di MMEX-Sync
pub fn run_gui(args: CliArgs, allow_auto_start: bool) -> Result<(), SyncError> {
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
}
