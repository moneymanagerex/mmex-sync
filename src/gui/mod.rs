pub mod app;
pub mod i18n;

pub use app::MmexSyncGuiApp;
pub use i18n::Language;

use crate::cli::CliArgs;
use crate::error::SyncError;

/// Avvia l'interfaccia grafica desktop nativa di MMEX-Sync
pub fn run_gui(args: CliArgs, allow_auto_start: bool) -> Result<(), SyncError> {
    let native_options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("MMEX-Sync - Configuration & Synchronization Gateway")
            .with_inner_size([800.0, 640.0])
            .with_min_inner_size([640.0, 480.0]),
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
