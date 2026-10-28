use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use chrono::{DateTime, Local};
use eframe::egui;

use crate::cli::CliArgs;
use crate::config::{expand_tilde, ConfigManager, ProfileConfig};
use crate::crypto::credentials::{protect, unprotect};
use crate::db::repository::DatabaseService;
use crate::domain::sync_order::SYNC_ORDER;
use crate::gui::i18n::Language;
use crate::remoteserver::create_remote_server;
use crate::sync::engine::{SyncEngine, SyncOptions};

const AUTOSTART_COUNTDOWN_SECS: f32 = 3.0;

/// Eventi inviati dai thread di lavoro asincroni alla GUI
#[derive(Debug)]
pub enum GuiEvent {
    Log(String),
    Status { message: String, is_error: bool },
    TokenUpdated {
        encrypted_token: String,
        auth_collection: String,
    },
    AuthCollectionReset,
    LastSyncUpdated(String),
    SyncFinished { last_sync: Option<String> },
    TestFinished { success: bool, message: String },
    ClearFinished { success: bool, message: String },
}

/// Parametri raccolti per l'esecuzione asincrona in background
#[derive(Clone)]
struct WorkerSyncContext {
    db_path: PathBuf,
    file_password: Option<String>,
    server_type: String,
    url: String,
    user: Option<String>,
    pass: Option<String>,
    encrypted_token: Option<String>,
    auth_collection: Option<String>,
    mmex_exe: Option<PathBuf>,
    last_sync: Option<String>,
    force: bool,
    verbose: bool,
}

/// Applicazione desktop nativa MMEX-Sync con eframe/egui
pub struct MmexSyncGuiApp {
    config_mgr: ConfigManager,
    active_profile: String,
    available_profiles: Vec<String>,
    default_profile: String,

    // Dati del profilo attivo
    db_path: String,
    file_password: String,
    save_file_password: bool,
    server_type: String,
    pb_url: String,
    pb_user: String,
    pb_pass: String,
    pb_auth_collection: String,
    encrypted_token: Option<String>,
    mmex_exe: String,
    default_mode: String,
    auto_start: bool,
    last_sync: Option<String>,
    force_mode: bool,
    verbose: bool,

    // Stato UI & Auto-Start Countdown
    pub lang: Language,
    status_message: Option<(String, bool)>,
    logs: Vec<String>,
    is_working: bool,
    is_watching: bool,
    watch_stop_flag: Arc<AtomicBool>,
    countdown_start: Option<Instant>,

    // Canali asincroni
    tx: Sender<GuiEvent>,
    rx: Receiver<GuiEvent>,

    // Dialoghi modali
    dialog_new_profile: bool,
    new_profile_name: String,
    dialog_new_emb_password: bool,
    new_emb_password_input: String,
    dialog_save_as: bool,
    save_as_name: String,
    dialog_rename_profile: bool,
    rename_profile_name: String,
    dialog_delete_confirm: bool,
    dialog_clear_db_confirm: bool,
    dialog_clear_server_confirm: bool,
    dialog_about: bool,
}

impl MmexSyncGuiApp {
    pub fn new(cc: &eframe::CreationContext<'_>, args: CliArgs, allow_auto_start: bool) -> Self {
        // Personalizzazione del tema visivo scuro e moderno
        let mut visuals = egui::Visuals::dark();
        visuals.window_rounding = 8.0.into();
        visuals.menu_rounding = 6.0.into();
        cc.egui_ctx.set_visuals(visuals);

        let (tx, rx) = channel();
        let config_mgr = ConfigManager::new().unwrap_or_else(|_| {
            let fallback_dir = dirs::home_dir().unwrap_or_default().join(".mmex-sync");
            let _ = std::fs::create_dir_all(&fallback_dir);
            ConfigManager::new().expect("Fallback config dir creation failed")
        });

        let saved_lang = config_mgr.get_saved_language();
        let lang = crate::i18n::detect_best_locale(saved_lang.as_deref());

        let default_profile = config_mgr
            .get_default_profile()
            .unwrap_or_else(|_| "default".to_string());
        let initial_profile = args
            .profile
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .unwrap_or_else(|| default_profile.clone());
        let available_profiles = config_mgr.list_profiles().unwrap_or_default();

        let mut app = Self {
            config_mgr,
            active_profile: initial_profile.clone(),
            available_profiles,
            default_profile,
            db_path: String::new(),
            file_password: String::new(),
            save_file_password: true,
            server_type: "pocketbase".to_string(),
            pb_url: "http://127.0.0.1:8090".to_string(),
            pb_user: String::new(),
            pb_pass: String::new(),
            pb_auth_collection: "users".to_string(),
            encrypted_token: None,
            mmex_exe: String::new(),
            default_mode: "run".to_string(),
            auto_start: true,
            last_sync: None,
            force_mode: args.force,
            verbose: args.verbose,
            lang,
            status_message: None,
            logs: Vec::new(),
            is_working: false,
            is_watching: false,
            watch_stop_flag: Arc::new(AtomicBool::new(false)),
            countdown_start: None,
            tx,
            rx,
            dialog_new_profile: false,
            new_profile_name: String::new(),
            dialog_new_emb_password: false,
            new_emb_password_input: String::new(),
            dialog_save_as: false,
            save_as_name: String::new(),
            dialog_rename_profile: false,
            rename_profile_name: String::new(),
            dialog_delete_confirm: false,
            dialog_clear_db_confirm: false,
            dialog_clear_server_confirm: false,
            dialog_about: false,
        };

        app.load_profile_data(&initial_profile);

        // Eventuali override da riga di comando passati all'avvio della GUI
        if let Some(db) = &args.db {
            app.db_path = db.to_string_lossy().to_string();
        }
        if let Some(pwd) = &args.file_password {
            app.file_password = pwd.clone();
        }
        if let Some(st) = &args.server_type {
            app.server_type = st.clone();
        }
        if let Some(url) = &args.url {
            app.pb_url = url.clone();
        }
        if let Some(user) = &args.user {
            app.pb_user = user.clone();
        }
        if let Some(pass) = &args.pass {
            app.pb_pass = pass.clone();
        }
        if let Some(exe) = &args.exe {
            app.mmex_exe = exe.to_string_lossy().to_string();
        }

        // Avvio eventuale del countdown di 3 secondi se allow_auto_start è true e il profilo è pronto
        if allow_auto_start && app.auto_start && app.is_profile_ready_for_autostart() {
            app.countdown_start = Some(Instant::now());
        }

        app
    }

    /// Verifica se il profilo corrente possiede tutti i parametri minimi necessari per l'auto-start
    pub fn is_profile_ready_for_autostart(&self) -> bool {
        let db_trimmed = self.db_path.trim();
        if db_trimmed.is_empty() {
            return false;
        }

        let resolved_db = expand_tilde(Path::new(db_trimmed));
        if !resolved_db.exists() {
            return false;
        }

        if db_trimmed.to_lowercase().ends_with(".emb") && self.file_password.is_empty() {
            return false;
        }

        if self.pb_url.trim().is_empty() {
            return false;
        }

        let has_credentials = !self.pb_user.trim().is_empty() && !self.pb_pass.is_empty();
        let has_token = self
            .encrypted_token
            .as_deref()
            .map(|t| !t.trim().is_empty())
            .unwrap_or(false);

        has_credentials || has_token
    }

    /// Annulla il countdown di auto-start se attivo
    pub fn cancel_autostart_countdown(&mut self) {
        if self.countdown_start.take().is_some() {
            let msg = self.lang.t("gui.autostart.cancelled").to_string();
            self.status_message = Some((msg.clone(), false));
            self.add_log(msg);
        }
    }

    pub fn set_language(&mut self, lang: Language) {
        self.lang = lang;
        crate::i18n::set_current_locale(lang);
        let _ = self.config_mgr.set_language(lang.code());
        self.add_log(
            self.lang
                .t_fmt("gui.log.language_changed", &[("lang", lang.display_name())]),
        );
    }

    fn add_log(&mut self, text: String) {
        let now: DateTime<Local> = SystemTime::now().into();
        let formatted = format!("[{}] {}", now.format("%H:%M:%S"), text);
        self.logs.push(formatted);
        if self.logs.len() > 300 {
            self.logs.remove(0);
        }
    }

    fn refresh_profile_list(&mut self) {
        self.available_profiles = self.config_mgr.list_profiles().unwrap_or_default();
        if let Ok(def) = self.config_mgr.get_default_profile() {
            self.default_profile = def;
        }
    }

    fn load_profile_data(&mut self, profile_name: &str) {
        if let Ok(p) = self.config_mgr.load_profile(profile_name) {
            self.active_profile = profile_name.to_string();
            self.db_path = p.db_path.unwrap_or_default();
            self.server_type = p.server_type.unwrap_or_else(|| "pocketbase".to_string());
            self.pb_url = p.pb_url.unwrap_or_else(|| "http://127.0.0.1:8090".to_string());
            self.pb_user = p.pb_user.unwrap_or_default();
            self.pb_auth_collection = p
                .pb_auth_collection
                .unwrap_or_else(|| "users".to_string());
            self.encrypted_token = p.encrypted_token;
            self.mmex_exe = p.mmex_exe.unwrap_or_default();
            self.default_mode = p.default_mode.unwrap_or_else(|| "run".to_string());
            self.auto_start = p.auto_start;
            self.last_sync = p.last_sync;

            self.save_file_password = p
                .save_password
                .as_deref()
                .map(|v| !matches!(v.to_lowercase().as_str(), "no" | "false" | "n"))
                .unwrap_or(true);

            if let Some(enc_pwd) = p.encrypted_file_password {
                self.file_password = unprotect(&enc_pwd, None).ok().flatten().unwrap_or_default();
            } else {
                self.file_password.clear();
            }

            self.pb_pass.clear();
            self.add_log(
                self.lang
                    .t_fmt("gui.log.profile_loaded", &[("name", profile_name)]),
            );
        } else {
            self.add_log(
                self.lang
                    .t_fmt("gui.log.profile_load_failed", &[("name", profile_name)]),
            );
        }
    }

    fn save_current_profile(&mut self) {
        let mut p = self
            .config_mgr
            .load_profile(&self.active_profile)
            .unwrap_or_default();

        p.db_path = if self.db_path.trim().is_empty() {
            None
        } else {
            Some(self.db_path.trim().to_string())
        };

        p.server_type = Some(self.server_type.clone());
        p.pb_url = Some(self.pb_url.trim().to_string());
        p.pb_user = if self.pb_user.trim().is_empty() {
            None
        } else {
            Some(self.pb_user.trim().to_string())
        };
        p.pb_auth_collection = if self.pb_auth_collection.trim().is_empty() {
            None
        } else {
            Some(self.pb_auth_collection.trim().to_string())
        };
        if self.encrypted_token.is_some() {
            p.encrypted_token = self.encrypted_token.clone();
        }
        p.mmex_exe = if self.mmex_exe.trim().is_empty() {
            None
        } else {
            Some(self.mmex_exe.trim().to_string())
        };
        p.default_mode = Some(self.default_mode.clone());
        p.auto_start = self.auto_start;
        p.save_password = Some(if self.save_file_password { "yes" } else { "no" }.to_string());

        if self.save_file_password && !self.file_password.is_empty() {
            if let Ok(enc) = protect(&self.file_password, None) {
                p.encrypted_file_password = Some(enc);
            }
        } else if !self.save_file_password {
            p.encrypted_file_password = None;
        }

        match self.config_mgr.save_profile(&self.active_profile, &p) {
            Ok(_) => {
                self.status_message = Some((self.lang.msg_profile_saved().to_string(), false));
                self.add_log(
                    self.lang
                        .t_fmt("gui.log.profile_saved", &[("name", &self.active_profile)]),
                );
                self.refresh_profile_list();
            }
            Err(e) => {
                self.status_message = Some((format!("{}: {}", self.lang.msg_error(), e), true));
                self.add_log(
                    self.lang
                        .t_fmt("gui.log.profile_save_failed", &[("error", &e.to_string())]),
                );
            }
        }
    }

    fn build_worker_context(&self) -> WorkerSyncContext {
        let db_path = expand_tilde(Path::new(self.db_path.trim()));
        let file_password = if self.file_password.is_empty() {
            None
        } else {
            Some(self.file_password.clone())
        };
        let user = if self.pb_user.trim().is_empty() {
            None
        } else {
            Some(self.pb_user.trim().to_string())
        };
        let pass = if self.pb_pass.is_empty() {
            None
        } else {
            Some(self.pb_pass.clone())
        };
        let auth_collection = if self.pb_auth_collection.trim().is_empty() {
            None
        } else {
            Some(self.pb_auth_collection.trim().to_string())
        };
        let mmex_exe = if self.mmex_exe.trim().is_empty() {
            None
        } else {
            Some(expand_tilde(Path::new(self.mmex_exe.trim())))
        };

        WorkerSyncContext {
            db_path,
            file_password,
            server_type: self.server_type.clone(),
            url: self.pb_url.trim().to_string(),
            user,
            pass,
            encrypted_token: self.encrypted_token.clone(),
            auth_collection,
            mmex_exe,
            last_sync: self.last_sync.clone(),
            force: self.force_mode,
            verbose: self.verbose,
        }
    }

    /// Esegue un singolo ciclo di sincronizzazione (Push e/o Pull) in background
    fn trigger_sync_async(&mut self, push: bool, pull: bool) {
        self.cancel_autostart_countdown();
        if self.is_working {
            return;
        }

        if self.db_path.trim().is_empty() {
            self.status_message = Some((self.lang.t("gui.msg.db_path_required").to_string(), true));
            return;
        }

        self.save_current_profile();
        self.is_working = true;
        self.status_message = Some((self.lang.msg_sync_running().to_string(), false));

        let tx = self.tx.clone();
        let ctx = self.build_worker_context();

        std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(GuiEvent::Status {
                        message: crate::i18n::t_fmt(
                            "gui.msg.tokio_runtime_error",
                            &[("error", &e.to_string())],
                        ),
                        is_error: true,
                    });
                    let _ = tx.send(GuiEvent::SyncFinished { last_sync: None });
                    return;
                }
            };

            rt.block_on(async move {
                let new_ts = execute_single_sync_step(&tx, &ctx, push, pull).await;
                let _ = tx.send(GuiEvent::SyncFinished { last_sync: new_ts });
            });
        });
    }

    /// Avvia l'esecuzione della modalità predefinita (`run`, `sync` o `watch`) all'interno della GUI
    pub fn trigger_default_mode_async(&mut self) {
        self.cancel_autostart_countdown();
        if self.is_working {
            return;
        }

        if self.db_path.trim().is_empty() {
            self.status_message = Some((self.lang.t("gui.msg.db_path_required").to_string(), true));
            return;
        }

        self.save_current_profile();
        let mode = self.default_mode.trim().to_lowercase();

        if mode == "sync" {
            self.trigger_sync_async(true, true);
            return;
        }

        self.is_working = true;
        self.watch_stop_flag.store(false, Ordering::SeqCst);
        if mode == "watch" {
            self.is_watching = true;
        }

        let start_msg = crate::i18n::t_fmt("sync.runner_start_mode", &[("mode", &mode.to_uppercase())]);
        self.add_log(start_msg.clone());
        self.status_message = Some((start_msg, false));

        let tx = self.tx.clone();
        let mut ctx = self.build_worker_context();
        let stop_flag = Arc::clone(&self.watch_stop_flag);

        std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(GuiEvent::Status {
                        message: crate::i18n::t_fmt(
                            "gui.msg.tokio_runtime_error",
                            &[("error", &e.to_string())],
                        ),
                        is_error: true,
                    });
                    let _ = tx.send(GuiEvent::SyncFinished { last_sync: None });
                    return;
                }
            };

            rt.block_on(async move {
                match mode.as_str() {
                    "run" => {
                        let _ = tx.send(GuiEvent::Log(crate::i18n::t("sync.pre_sync_start").to_string()));
                        if let Some(ts) = execute_single_sync_step(&tx, &ctx, true, true).await {
                            ctx.last_sync = Some(ts.clone());
                            let _ = tx.send(GuiEvent::LastSyncUpdated(ts));
                        }

                        match &ctx.mmex_exe {
                            Some(exe) if exe.exists() => {
                                let launch_msg = crate::i18n::t_fmt(
                                    "sync.mmex_process_start",
                                    &[
                                        ("exe", &exe.display().to_string()),
                                        ("db", &ctx.db_path.display().to_string()),
                                    ],
                                );
                                let _ = tx.send(GuiEvent::Log(launch_msg.clone()));
                                let _ = tx.send(GuiEvent::Status {
                                    message: launch_msg,
                                    is_error: false,
                                });

                                match Command::new(exe).arg(&ctx.db_path).status() {
                                    Ok(status) => {
                                        let fin_msg = crate::i18n::t_fmt(
                                            "sync.mmex_process_finished",
                                            &[("status", &status.to_string())],
                                        );
                                        let _ = tx.send(GuiEvent::Log(fin_msg));
                                        let final_ts =
                                            execute_single_sync_step(&tx, &ctx, true, true).await;
                                        let _ = tx.send(GuiEvent::SyncFinished {
                                            last_sync: final_ts.or(ctx.last_sync),
                                        });
                                    }
                                    Err(e) => {
                                        let _ = tx.send(GuiEvent::Status {
                                            message: format!("{}: {}", crate::i18n::t("gui.msg.error"), e),
                                            is_error: true,
                                        });
                                        let _ = tx.send(GuiEvent::SyncFinished {
                                            last_sync: ctx.last_sync,
                                        });
                                    }
                                }
                            }
                            _ => {
                                let fallback_msg =
                                    crate::i18n::t("sync.mmex_not_configured_fallback").to_string();
                                let _ = tx.send(GuiEvent::Log(format!("⚠️ {}", fallback_msg)));
                                let _ = tx.send(GuiEvent::SyncFinished {
                                    last_sync: ctx.last_sync,
                                });
                            }
                        }
                    }
                    "watch" => {
                        let _ = tx.send(GuiEvent::Log(
                            crate::i18n::t("sync.watch_pre_sync_start").to_string(),
                        ));
                        if let Some(ts) = execute_single_sync_step(&tx, &ctx, true, true).await {
                            ctx.last_sync = Some(ts.clone());
                            let _ = tx.send(GuiEvent::LastSyncUpdated(ts));
                        }

                        if let Some(exe) = &ctx.mmex_exe {
                            if exe.exists() {
                                let _ = tx.send(GuiEvent::Log(
                                    crate::i18n::t("sync.mmex_background_start").to_string(),
                                ));
                                let _ = Command::new(exe).arg(&ctx.db_path).spawn();
                            }
                        }

                        let watch_msg = crate::i18n::t("sync.watch_active").to_string();
                        let _ = tx.send(GuiEvent::Log(watch_msg.clone()));
                        let _ = tx.send(GuiEvent::Status {
                            message: watch_msg,
                            is_error: false,
                        });

                        let mut last_modified = std::fs::metadata(&ctx.db_path)
                            .and_then(|m| m.modified())
                            .ok();

                        while !stop_flag.load(Ordering::SeqCst) {
                            for _ in 0..15 {
                                if stop_flag.load(Ordering::SeqCst) {
                                    break;
                                }
                                tokio::time::sleep(Duration::from_millis(200)).await;
                            }
                            if stop_flag.load(Ordering::SeqCst) {
                                break;
                            }

                            let current_mod = std::fs::metadata(&ctx.db_path)
                                .and_then(|m| m.modified())
                                .ok();
                            if current_mod != last_modified && current_mod.is_some() {
                                last_modified = current_mod;
                                let _ = tx.send(GuiEvent::Log(
                                    crate::i18n::t("sync.watch_file_changed").to_string(),
                                ));
                                if let Some(ts) =
                                    execute_single_sync_step(&tx, &ctx, true, true).await
                                {
                                    ctx.last_sync = Some(ts.clone());
                                    let _ = tx.send(GuiEvent::LastSyncUpdated(ts));
                                    // Riallinea il timestamp di modifica dopo il flush locale
                                    last_modified = std::fs::metadata(&ctx.db_path)
                                        .and_then(|m| m.modified())
                                        .ok();
                                }
                            }
                        }

                        let _ = tx.send(GuiEvent::SyncFinished {
                            last_sync: ctx.last_sync,
                        });
                    }
                    _ => {
                        let new_ts = execute_single_sync_step(&tx, &ctx, true, true).await;
                        let _ = tx.send(GuiEvent::SyncFinished { last_sync: new_ts });
                    }
                }
            });
        });
    }

    fn trigger_test_connection_async(&mut self) {
        self.cancel_autostart_countdown();
        if self.is_working {
            return;
        }

        self.is_working = true;
        self.status_message = Some((self.lang.t("gui.msg.test_in_progress").to_string(), false));

        let tx = self.tx.clone();
        let server_type = self.server_type.clone();
        let url = self.pb_url.trim().to_string();
        let user = self.pb_user.trim().to_string();
        let pass = self.pb_pass.clone();

        std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(GuiEvent::TestFinished {
                        success: false,
                        message: format!("Runtime error: {}", e),
                    });
                    return;
                }
            };

            rt.block_on(async move {
                let mut remote = match create_remote_server(&server_type, &url) {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = tx.send(GuiEvent::TestFinished {
                            success: false,
                            message: format!("Errore configurazione client: {}", e),
                        });
                        return;
                    }
                };

                let _ = tx.send(GuiEvent::Log(crate::i18n::t_fmt(
                    "gui.log.test_endpoint",
                    &[("url", &url)],
                )));

                if user.is_empty() || pass.is_empty() {
                    let _ = tx.send(GuiEvent::TestFinished {
                        success: false,
                        message: crate::i18n::t("gui.msg.test_credentials_required").to_string(),
                    });
                    return;
                }

                match remote.authenticate(&user, &pass).await {
                    Ok(auth) => {
                        if let Ok(enc_tok) = protect(&auth.token, None) {
                            let _ = tx.send(GuiEvent::TokenUpdated {
                                encrypted_token: enc_tok,
                                auth_collection: auth.collection.clone(),
                            });
                        }
                        let uid = auth.user_id.as_deref().unwrap_or("-");
                        let _ = tx.send(GuiEvent::Log(crate::i18n::t_fmt(
                            "gui.log.remote_auth_success",
                            &[("uid", uid)],
                        )));
                        let _ = tx.send(GuiEvent::TestFinished {
                            success: true,
                            message: crate::i18n::t_fmt("gui.msg.test_success", &[("uid", uid)]),
                        });
                    }
                    Err(e) => {
                        let _ = tx.send(GuiEvent::AuthCollectionReset);
                        let _ = tx.send(GuiEvent::Log(crate::i18n::t_fmt(
                            "gui.log.test_error",
                            &[("error", &e.to_string())],
                        )));
                        let _ = tx.send(GuiEvent::TestFinished {
                            success: false,
                            message: crate::i18n::t_fmt(
                                "gui.log.remote_auth_failed",
                                &[("error", &e.to_string())],
                            ),
                        });
                    }
                }
            });
        });
    }

    fn prompt_create_new_db(&mut self) {
        self.cancel_autostart_countdown();
        if self.is_working {
            return;
        }

        if let Some(mut file) = rfd::FileDialog::new()
            .add_filter("MMEX Database", &["mmb", "emb"])
            .set_file_name("new_database.mmb")
            .save_file()
        {
            if file.extension().is_none() {
                file.set_extension("mmb");
            }
            self.db_path = file.to_string_lossy().to_string();

            if self.db_path.to_lowercase().ends_with(".emb") {
                self.file_password.clear();
                self.new_emb_password_input.clear();
                self.dialog_new_emb_password = true;
            } else {
                self.save_current_profile();
                self.trigger_create_db_async();
            }
        }
    }

    fn trigger_create_db_async(&mut self) {
        self.cancel_autostart_countdown();
        if self.is_working || self.db_path.trim().is_empty() {
            return;
        }
        self.is_working = true;
        let tx = self.tx.clone();
        let db_path = expand_tilde(Path::new(self.db_path.trim()));
        let file_password = if self.file_password.is_empty() {
            None
        } else {
            Some(self.file_password.clone())
        };

        std::thread::spawn(move || {
            let mut db = match DatabaseService::connect(
                &db_path,
                false,
                file_password.as_deref(),
                true,
            ) {
                Ok(d) => d,
                Err(e) => {
                    let _ = tx.send(GuiEvent::ClearFinished {
                        success: false,
                        message: format!("{}: {}", crate::i18n::t("gui.msg.error"), e),
                    });
                    return;
                }
            };

            if let Err(e) = db.init_schema().and_then(|_| db.flush()) {
                let _ = tx.send(GuiEvent::ClearFinished {
                    success: false,
                    message: format!("{}: {}", crate::i18n::t("gui.msg.error"), e),
                });
                return;
            }

            let _ = tx.send(GuiEvent::Log(crate::i18n::t_fmt(
                "gui.log.create_db_success",
                &[("path", &db_path.display().to_string())],
            )));
            let _ = tx.send(GuiEvent::ClearFinished {
                success: true,
                message: crate::i18n::t("gui.msg.create_db_success").to_string(),
            });
        });
    }

    fn trigger_clear_db_async(&mut self) {
        self.cancel_autostart_countdown();
        if self.is_working || self.db_path.trim().is_empty() {
            return;
        }
        self.is_working = true;
        let tx = self.tx.clone();
        let db_path = expand_tilde(Path::new(self.db_path.trim()));
        let file_password = if self.file_password.is_empty() {
            None
        } else {
            Some(self.file_password.clone())
        };

        std::thread::spawn(move || {
            let mut db =
                match DatabaseService::connect(&db_path, false, file_password.as_deref(), false) {
                    Ok(d) => d,
                    Err(e) => {
                        let _ = tx.send(GuiEvent::ClearFinished {
                            success: false,
                            message: format!("Errore apertura DB: {}", e),
                        });
                        return;
                    }
                };

            match db.clear_technical() {
                Ok(_) => {
                    let _ = db.flush();
                    let _ = tx.send(GuiEvent::Log(
                        crate::i18n::t("gui.log.clear_db_success").to_string(),
                    ));
                    let _ = tx.send(GuiEvent::ClearFinished {
                        success: true,
                        message: crate::i18n::t("gui.msg.clear_db_success").to_string(),
                    });
                }
                Err(e) => {
                    let _ = tx.send(GuiEvent::ClearFinished {
                        success: false,
                        message: format!("{}: {}", crate::i18n::t("gui.msg.error"), e),
                    });
                }
            }
        });
    }

    fn trigger_clear_server_async(&mut self) {
        self.cancel_autostart_countdown();
        if self.is_working {
            return;
        }
        self.is_working = true;
        let tx = self.tx.clone();
        let server_type = self.server_type.clone();
        let url = self.pb_url.trim().to_string();
        let user = self.pb_user.trim().to_string();
        let pass = self.pb_pass.clone();
        let encrypted_token = self.encrypted_token.clone();
        let auth_collection = if self.pb_auth_collection.trim().is_empty() {
            None
        } else {
            Some(self.pb_auth_collection.trim().to_string())
        };

        std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(r) => r,
                Err(e) => {
                    let _ = tx.send(GuiEvent::ClearFinished {
                        success: false,
                        message: format!("Runtime error: {}", e),
                    });
                    return;
                }
            };

            rt.block_on(async move {
                let mut remote = match create_remote_server(&server_type, &url) {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = tx.send(GuiEvent::ClearFinished {
                            success: false,
                            message: format!("Errore client: {}", e),
                        });
                        return;
                    }
                };

                if !user.is_empty() && !pass.is_empty() {
                    match remote.authenticate(&user, &pass).await {
                        Ok(auth) => {
                            if let Ok(enc_tok) = protect(&auth.token, None) {
                                let _ = tx.send(GuiEvent::TokenUpdated {
                                    encrypted_token: enc_tok,
                                    auth_collection: auth.collection,
                                });
                            }
                        }
                        Err(e) => {
                            let _ = tx.send(GuiEvent::AuthCollectionReset);
                            let _ = tx.send(GuiEvent::ClearFinished {
                                success: false,
                                message: format!("Autenticazione fallita: {}", e),
                            });
                            return;
                        }
                    }
                } else if let Some(enc_token) = &encrypted_token {
                    if let Ok(Some(tok)) = unprotect(enc_token, None) {
                        remote.set_token(tok, auth_collection);
                        if let Ok(refreshed) = remote.refresh_token().await {
                            if let Ok(enc_tok) = protect(&refreshed.token, None) {
                                let _ = tx.send(GuiEvent::TokenUpdated {
                                    encrypted_token: enc_tok,
                                    auth_collection: refreshed.collection,
                                });
                            }
                        }
                    }
                }

                match remote.clear_remote_server(SYNC_ORDER).await {
                    Ok(_) => {
                        let _ = tx.send(GuiEvent::Log(
                            crate::i18n::t("gui.log.clear_server_success").to_string(),
                        ));
                        let _ = tx.send(GuiEvent::ClearFinished {
                            success: true,
                            message: crate::i18n::t("gui.msg.clear_server_success").to_string(),
                        });
                    }
                    Err(e) => {
                        let _ = tx.send(GuiEvent::ClearFinished {
                            success: false,
                            message: format!("{}: {}", crate::i18n::t("gui.msg.error"), e),
                        });
                    }
                }
            });
        });
    }

    fn drain_events(&mut self) {
        while let Ok(event) = self.rx.try_recv() {
            match event {
                GuiEvent::Log(msg) => self.add_log(msg),
                GuiEvent::Status { message, is_error } => {
                    self.status_message = Some((message, is_error));
                }
                GuiEvent::TokenUpdated {
                    encrypted_token,
                    auth_collection,
                } => {
                    self.encrypted_token = Some(encrypted_token.clone());
                    self.pb_auth_collection = auth_collection.clone();
                    if let Ok(mut p) = self.config_mgr.load_profile(&self.active_profile) {
                        p.encrypted_token = Some(encrypted_token);
                        p.pb_auth_collection = Some(auth_collection);
                        let _ = self.config_mgr.save_profile(&self.active_profile, &p);
                    }
                }
                GuiEvent::AuthCollectionReset => {
                    self.pb_auth_collection = "users".to_string();
                }
                GuiEvent::LastSyncUpdated(ts) => {
                    self.last_sync = Some(ts.clone());
                    if let Ok(mut p) = self.config_mgr.load_profile(&self.active_profile) {
                        p.last_sync = Some(ts);
                        let _ = self.config_mgr.save_profile(&self.active_profile, &p);
                    }
                }
                GuiEvent::SyncFinished { last_sync } => {
                    self.is_working = false;
                    self.is_watching = false;
                    if let Some(ts) = last_sync {
                        self.last_sync = Some(ts.clone());
                        if let Ok(mut p) = self.config_mgr.load_profile(&self.active_profile) {
                            p.last_sync = Some(ts);
                            let _ = self.config_mgr.save_profile(&self.active_profile, &p);
                        }
                    }
                }
                GuiEvent::TestFinished { success, message } => {
                    self.is_working = false;
                    self.status_message = Some((message, !success));
                }
                GuiEvent::ClearFinished { success, message } => {
                    self.is_working = false;
                    self.status_message = Some((message, !success));
                }
            }
        }
    }
}

/// Funzione helper eseguita nel worker thread per connettere DB, autenticare il client remoto ed eseguire un ciclo SyncEngine
async fn execute_single_sync_step(
    tx: &Sender<GuiEvent>,
    ctx: &WorkerSyncContext,
    push: bool,
    pull: bool,
) -> Option<String> {
    let _ = tx.send(GuiEvent::Log(crate::i18n::t_fmt(
        "gui.log.db_open",
        &[("path", &ctx.db_path.display().to_string())],
    )));

    let mut db = match DatabaseService::connect(
        &ctx.db_path,
        ctx.verbose,
        ctx.file_password.as_deref(),
        false,
    ) {
        Ok(d) => d,
        Err(e) => {
            let _ = tx.send(GuiEvent::Status {
                message: format!("{}: {}", crate::i18n::t("gui.msg.error"), e),
                is_error: true,
            });
            let _ = tx.send(GuiEvent::Log(crate::i18n::t_fmt(
                "gui.log.db_open_error",
                &[("error", &e.to_string())],
            )));
            return None;
        }
    };

    let mut remote = match create_remote_server(&ctx.server_type, &ctx.url) {
        Ok(r) => r,
        Err(e) => {
            let _ = tx.send(GuiEvent::Status {
                message: format!("{}: {}", crate::i18n::t("gui.msg.error"), e),
                is_error: true,
            });
            let _ = tx.send(GuiEvent::Log(crate::i18n::t_fmt(
                "gui.log.remote_error",
                &[("error", &e.to_string())],
            )));
            return None;
        }
    };

    if let (Some(u), Some(p)) = (&ctx.user, &ctx.pass) {
        let _ = tx.send(GuiEvent::Log(crate::i18n::t_fmt(
            "gui.log.remote_auth",
            &[("user", u)],
        )));
        match remote.authenticate(u, p).await {
            Ok(auth) => {
                if let Ok(enc_tok) = protect(&auth.token, None) {
                    let _ = tx.send(GuiEvent::TokenUpdated {
                        encrypted_token: enc_tok,
                        auth_collection: auth.collection,
                    });
                }
            }
            Err(e) => {
                let _ = tx.send(GuiEvent::AuthCollectionReset);
                let _ = tx.send(GuiEvent::Status {
                    message: format!("{}: {}", crate::i18n::t("gui.msg.error"), e),
                    is_error: true,
                });
                let _ = tx.send(GuiEvent::Log(crate::i18n::t_fmt(
                    "gui.log.remote_auth_failed",
                    &[("error", &e.to_string())],
                )));
                return None;
            }
        }
    } else if let Some(enc_token) = &ctx.encrypted_token {
        if let Ok(Some(tok)) = unprotect(enc_token, None) {
            remote.set_token(tok, ctx.auth_collection.clone());
            if let Ok(refreshed) = remote.refresh_token().await {
                if let Ok(enc_tok) = protect(&refreshed.token, None) {
                    let _ = tx.send(GuiEvent::TokenUpdated {
                        encrypted_token: enc_tok,
                        auth_collection: refreshed.collection,
                    });
                }
            }
        }
    }

    let options = SyncOptions {
        init: true,
        push,
        pull,
        force: ctx.force,
        verbose: ctx.verbose,
    };

    let mut engine = SyncEngine::new(&mut db, remote.as_mut(), options, ctx.last_sync.clone());

    match engine.run_cycle().await {
        Ok((stats, new_ts)) => {
            let summary = crate::i18n::t_fmt(
                "gui.log.sync_success",
                &[
                    ("pushed", &stats.pushed_records.to_string()),
                    ("pulled", &stats.pulled_records.to_string()),
                    ("deleted", &stats.deleted_records.to_string()),
                    ("conflicts", &stats.conflicts_resolved.to_string()),
                ],
            );
            let _ = tx.send(GuiEvent::Log(format!("✅ {}", summary)));
            let _ = tx.send(GuiEvent::Status {
                message: summary,
                is_error: false,
            });
            new_ts
        }
        Err(e) => {
            let _ = tx.send(GuiEvent::Log(crate::i18n::t_fmt(
                "gui.log.sync_error",
                &[("error", &e.to_string())],
            )));
            let _ = tx.send(GuiEvent::Status {
                message: format!("{}: {}", crate::i18n::t("gui.msg.error"), e),
                is_error: true,
            });
            None
        }
    }
}

impl eframe::App for MmexSyncGuiApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.drain_events();

        // Intercettazione tasto Esc per annullare il countdown di auto-start (o fermare Watch)
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            if self.countdown_start.is_some() {
                self.cancel_autostart_countdown();
            } else if self.is_watching {
                self.watch_stop_flag.store(true, Ordering::SeqCst);
            }
        }

        // Verifica scadenza countdown di 3 secondi
        if let Some(start) = self.countdown_start {
            let elapsed = start.elapsed().as_secs_f32();
            if elapsed >= AUTOSTART_COUNTDOWN_SECS {
                self.countdown_start = None;
                self.trigger_default_mode_async();
            } else {
                ctx.request_repaint();
            }
        }

        // 1. TOP MENU BAR (Classica Desktop)
        egui::TopBottomPanel::top("top_menu_bar").show(ctx, |ui| {
            egui::menu::bar(ui, |ui| {
                // MENU PROFILI
                ui.menu_button(self.lang.menu_profiles(), |ui| {
                    if ui.button(self.lang.menu_profile_new()).clicked() {
                        self.cancel_autostart_countdown();
                        self.new_profile_name.clear();
                        self.dialog_new_profile = true;
                        ui.close_menu();
                    }

                    ui.menu_button(self.lang.menu_profile_open(), |ui| {
                        let profiles = self.available_profiles.clone();
                        for prof in profiles {
                            let is_current = prof == self.active_profile;
                            let label = if is_current {
                                format!("✓ {}", prof)
                            } else {
                                format!("  {}", prof)
                            };
                            if ui.button(label).clicked() {
                                self.cancel_autostart_countdown();
                                self.save_current_profile();
                                self.load_profile_data(&prof);
                                ui.close_menu();
                            }
                        }
                    });

                    ui.separator();

                    if ui.button(self.lang.menu_profile_save()).clicked() {
                        self.cancel_autostart_countdown();
                        self.save_current_profile();
                        ui.close_menu();
                    }

                    if ui.button(self.lang.menu_profile_save_as()).clicked() {
                        self.cancel_autostart_countdown();
                        self.save_as_name = format!("{}_copy", self.active_profile);
                        self.dialog_save_as = true;
                        ui.close_menu();
                    }

                    if ui.button(self.lang.menu_profile_rename()).clicked() {
                        self.cancel_autostart_countdown();
                        self.rename_profile_name = self.active_profile.clone();
                        self.dialog_rename_profile = true;
                        ui.close_menu();
                    }

                    ui.separator();

                    let is_already_default = self.active_profile == self.default_profile;
                    if ui
                        .add_enabled(
                            !is_already_default,
                            egui::Button::new(self.lang.menu_profile_set_default()),
                        )
                        .clicked()
                    {
                        self.cancel_autostart_countdown();
                        let _ = self.config_mgr.set_default_profile(&self.active_profile);
                        self.default_profile = self.active_profile.clone();
                        self.add_log(self.lang.t_fmt(
                            "gui.log.profile_default_set",
                            &[("name", &self.active_profile)],
                        ));
                        ui.close_menu();
                    }

                    if ui.button(self.lang.menu_profile_delete()).clicked() {
                        self.cancel_autostart_countdown();
                        self.dialog_delete_confirm = true;
                        ui.close_menu();
                    }

                    ui.separator();

                    if ui.button(self.lang.menu_profile_exit()).clicked() {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                });

                // MENU MODIFICA
                ui.menu_button(self.lang.menu_edit(), |ui| {
                    if ui.button(self.lang.menu_edit_db()).clicked() {
                        self.cancel_autostart_countdown();
                        if let Some(file) = rfd::FileDialog::new()
                            .add_filter("MMEX Database", &["mmb", "emb"])
                            .pick_file()
                        {
                            self.db_path = file.to_string_lossy().to_string();
                        }
                        ui.close_menu();
                    }

                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.menu_edit_new_db()),
                        )
                        .clicked()
                    {
                        self.prompt_create_new_db();
                        ui.close_menu();
                    }

                    if ui.button(self.lang.menu_edit_exe()).clicked() {
                        self.cancel_autostart_countdown();
                        if let Some(file) = rfd::FileDialog::new().pick_file() {
                            self.mmex_exe = file.to_string_lossy().to_string();
                        }
                        ui.close_menu();
                    }
                });

                // MENU SINCRONIZZAZIONE (con switch "Force Mode")
                ui.menu_button(self.lang.menu_sync(), |ui| {
                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.menu_sync_all()),
                        )
                        .clicked()
                    {
                        self.trigger_sync_async(true, true);
                        ui.close_menu();
                    }

                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.menu_sync_push()),
                        )
                        .clicked()
                    {
                        self.trigger_sync_async(true, false);
                        ui.close_menu();
                    }

                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.menu_sync_pull()),
                        )
                        .clicked()
                    {
                        self.trigger_sync_async(false, true);
                        ui.close_menu();
                    }

                    ui.separator();

                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.menu_sync_test()),
                        )
                        .clicked()
                    {
                        self.trigger_test_connection_async();
                        ui.close_menu();
                    }

                    ui.separator();

                    // Switch "Usa Modalità Forzata (Force Mode)"
                    ui.checkbox(&mut self.force_mode, self.lang.menu_sync_force_mode());
                });

                // MENU PREFERENZE (Selezione Lingua IT / EN)
                ui.menu_button(self.lang.menu_preferences(), |ui| {
                    ui.label(self.lang.menu_preferences_lang());
                    ui.separator();

                    if ui
                        .selectable_label(self.lang == Language::It, "🇮🇹 Italiano")
                        .clicked()
                    {
                        self.set_language(Language::It);
                        ui.close_menu();
                    }

                    if ui
                        .selectable_label(self.lang == Language::En, "🇬🇧 English")
                        .clicked()
                    {
                        self.set_language(Language::En);
                        ui.close_menu();
                    }
                });

                // MENU STRUMENTI
                ui.menu_button(self.lang.menu_tools(), |ui| {
                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.menu_tools_clear_db()),
                        )
                        .clicked()
                    {
                        self.cancel_autostart_countdown();
                        self.dialog_clear_db_confirm = true;
                        ui.close_menu();
                    }

                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.menu_tools_clear_server()),
                        )
                        .clicked()
                    {
                        self.cancel_autostart_countdown();
                        self.dialog_clear_server_confirm = true;
                        ui.close_menu();
                    }
                });

                // MENU AIUTO
                ui.menu_button(self.lang.menu_help(), |ui| {
                    if ui.button(self.lang.menu_help_about()).clicked() {
                        self.cancel_autostart_countdown();
                        self.dialog_about = true;
                        ui.close_menu();
                    }
                });
            });
        });

        // 2. STATUS BOTTOM BAR
        egui::TopBottomPanel::bottom("bottom_status_bar").show(ctx, |ui| {
            ui.horizontal(|ui| {
                if self.is_working {
                    ui.spinner();
                    ui.label(self.lang.msg_operation_in_progress());
                } else if let Some((msg, is_error)) = &self.status_message {
                    if *is_error {
                        ui.colored_label(
                            egui::Color32::from_rgb(255, 90, 90),
                            format!("⚠ {}", msg),
                        );
                    } else {
                        ui.colored_label(
                            egui::Color32::from_rgb(90, 255, 120),
                            format!("✓ {}", msg),
                        );
                    }
                } else {
                    ui.label(self.lang.msg_ready());
                }

                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let ts_display = self.last_sync.as_deref().unwrap_or(self.lang.never());
                    ui.label(format!("{} {}", self.lang.last_sync_label(), ts_display));
                });
            });
        });

        // 3. CENTRAL PANEL
        egui::CentralPanel::default().show(ctx, |ui| {
            egui::ScrollArea::vertical().show(ui, |ui| {
                // Banner Countdown Auto-Start (se attivo)
                if let Some(start) = self.countdown_start {
                    let remaining = (AUTOSTART_COUNTDOWN_SECS - start.elapsed().as_secs_f32()).max(0.0);
                    let progress = (remaining / AUTOSTART_COUNTDOWN_SECS).clamp(0.0, 1.0);
                    let banner_text = self.lang.t_fmt(
                        "gui.autostart.banner",
                        &[
                            ("mode", &self.default_mode.to_uppercase()),
                            ("seconds", &format!("{:.1}", remaining)),
                        ],
                    );

                    egui::Frame::group(ui.style())
                        .fill(egui::Color32::from_rgb(45, 55, 75))
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.colored_label(
                                    egui::Color32::from_rgb(255, 215, 90),
                                    egui::RichText::new(banner_text).strong(),
                                );
                                ui.with_layout(
                                    egui::Layout::right_to_left(egui::Align::Center),
                                    |ui| {
                                        if ui
                                            .button(self.lang.t("gui.autostart.btn_cancel"))
                                            .clicked()
                                        {
                                            self.cancel_autostart_countdown();
                                        }
                                    },
                                );
                            });
                            ui.add(egui::ProgressBar::new(progress).animate(true));
                        });
                    ui.add_space(8.0);
                }

                // Header Profilo
                ui.horizontal(|ui| {
                    ui.heading(format!(
                        "{} {}",
                        self.lang.active_profile_label(),
                        self.active_profile
                    ));
                    if self.active_profile == self.default_profile {
                        ui.colored_label(
                            egui::Color32::from_rgb(100, 200, 255),
                            format!("[{}]", self.lang.default_badge()),
                        );
                    }
                });
                ui.separator();

                // Sezione 1: Database MMEX
                ui.collapsing(self.lang.section_db(), |ui| {
                    ui.horizontal(|ui| {
                        ui.label(self.lang.field_db_path());
                        if ui.text_edit_singleline(&mut self.db_path).changed() {
                            self.cancel_autostart_countdown();
                        }
                        if ui.button(self.lang.btn_browse()).clicked() {
                            self.cancel_autostart_countdown();
                            if let Some(file) = rfd::FileDialog::new()
                                .add_filter("MMEX Database", &["mmb", "emb"])
                                .pick_file()
                            {
                                self.db_path = file.to_string_lossy().to_string();
                            }
                        }
                        if ui
                            .add_enabled(
                                !self.is_working,
                                egui::Button::new(self.lang.btn_new_db()),
                            )
                            .clicked()
                        {
                            self.prompt_create_new_db();
                        }
                    });

                    let is_emb = self.db_path.to_lowercase().ends_with(".emb");
                    if is_emb {
                        ui.horizontal(|ui| {
                            ui.label(self.lang.field_db_password());
                            if ui
                                .add(egui::TextEdit::singleline(&mut self.file_password).password(true))
                                .changed()
                            {
                                self.cancel_autostart_countdown();
                            }
                            ui.checkbox(
                                &mut self.save_file_password,
                                self.lang.field_save_password(),
                            );
                        });
                    }
                });

                ui.add_space(6.0);

                // Sezione 2: Server Remoto
                ui.collapsing(self.lang.section_remote(), |ui| {
                    egui::Grid::new("remote_grid")
                        .num_columns(2)
                        .spacing([12.0, 6.0])
                        .show(ui, |ui| {
                            ui.label(self.lang.field_server_type());
                            egui::ComboBox::from_id_salt("server_type_combo")
                                .selected_text(&self.server_type)
                                .show_ui(ui, |ui| {
                                    ui.selectable_value(
                                        &mut self.server_type,
                                        "pocketbase".to_string(),
                                        "PocketBase",
                                    );
                                });
                            ui.end_row();

                            ui.label(self.lang.field_server_url());
                            if ui.text_edit_singleline(&mut self.pb_url).changed() {
                                self.cancel_autostart_countdown();
                            }
                            ui.end_row();

                            ui.label(self.lang.field_server_user());
                            if ui.text_edit_singleline(&mut self.pb_user).changed() {
                                self.cancel_autostart_countdown();
                            }
                            ui.end_row();

                            ui.label(self.lang.field_server_password());
                            if ui
                                .add(egui::TextEdit::singleline(&mut self.pb_pass).password(true))
                                .changed()
                            {
                                self.cancel_autostart_countdown();
                            }
                            ui.end_row();
                        });
                });

                ui.add_space(6.0);

                // Sezione 3: Runner & Esecuzione
                ui.collapsing(self.lang.section_runner(), |ui| {
                    ui.horizontal(|ui| {
                        ui.label(self.lang.field_mmex_exe());
                        if ui.text_edit_singleline(&mut self.mmex_exe).changed() {
                            self.cancel_autostart_countdown();
                        }
                        if ui.button(self.lang.btn_browse()).clicked() {
                            self.cancel_autostart_countdown();
                            if let Some(file) = rfd::FileDialog::new().pick_file() {
                                self.mmex_exe = file.to_string_lossy().to_string();
                            }
                        }
                    });

                    ui.horizontal(|ui| {
                        ui.label(self.lang.field_default_mode());
                        egui::ComboBox::from_id_salt("default_mode_combo")
                            .selected_text(&self.default_mode)
                            .show_ui(ui, |ui| {
                                ui.selectable_value(
                                    &mut self.default_mode,
                                    "run".to_string(),
                                    "Run (MMEX Launcher)",
                                );
                                ui.selectable_value(
                                    &mut self.default_mode,
                                    "sync".to_string(),
                                    "Sync Only",
                                );
                                ui.selectable_value(
                                    &mut self.default_mode,
                                    "watch".to_string(),
                                    "Watch File",
                                );
                            });

                        if ui
                            .checkbox(&mut self.auto_start, self.lang.toggle_auto_start())
                            .changed()
                            && !self.auto_start
                        {
                            self.cancel_autostart_countdown();
                        }
                        ui.checkbox(&mut self.force_mode, self.lang.toggle_force_mode());
                        ui.checkbox(&mut self.verbose, self.lang.toggle_verbose());
                    });
                });

                ui.add_space(10.0);

                // Barra dei pulsanti primari
                ui.horizontal_wrapped(|ui| {
                    let run_btn_label = self
                        .lang
                        .t_fmt("gui.btn.run_default", &[("mode", &self.default_mode.to_uppercase())]);

                    if self.is_watching {
                        if ui
                            .add_sized([160.0, 32.0], egui::Button::new(self.lang.btn_stop_watch()))
                            .clicked()
                        {
                            self.watch_stop_flag.store(true, Ordering::SeqCst);
                        }
                    } else if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(run_btn_label).min_size(egui::vec2(160.0, 32.0)),
                        )
                        .clicked()
                    {
                        self.trigger_default_mode_async();
                    }

                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.btn_sync_full())
                                .min_size(egui::vec2(160.0, 32.0)),
                        )
                        .clicked()
                    {
                        self.trigger_sync_async(true, true);
                    }

                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.btn_push_only())
                                .min_size(egui::vec2(110.0, 32.0)),
                        )
                        .clicked()
                    {
                        self.trigger_sync_async(true, false);
                    }

                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.btn_pull_only())
                                .min_size(egui::vec2(110.0, 32.0)),
                        )
                        .clicked()
                    {
                        self.trigger_sync_async(false, true);
                    }

                    if ui
                        .add_enabled(
                            !self.is_working,
                            egui::Button::new(self.lang.btn_test_conn())
                                .min_size(egui::vec2(130.0, 32.0)),
                        )
                        .clicked()
                    {
                        self.trigger_test_connection_async();
                    }

                    if ui
                        .add_sized([110.0, 32.0], egui::Button::new(self.lang.btn_save()))
                        .clicked()
                    {
                        self.cancel_autostart_countdown();
                        self.save_current_profile();
                    }
                });

                ui.add_space(10.0);
                ui.separator();

                // Console di Log in tempo reale
                ui.horizontal(|ui| {
                    ui.label(self.lang.log_console_title());
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        if ui.button(self.lang.btn_clear_logs()).clicked() {
                            self.logs.clear();
                        }
                    });
                });

                egui::Frame::canvas(ui.style()).show(ui, |ui| {
                    egui::ScrollArea::vertical()
                        .max_height(160.0)
                        .stick_to_bottom(true)
                        .show(ui, |ui| {
                            for line in &self.logs {
                                if line.contains("❌") || line.contains("Errore") {
                                    ui.colored_label(egui::Color32::from_rgb(255, 100, 100), line);
                                } else if line.contains("✅") {
                                    ui.colored_label(egui::Color32::from_rgb(100, 255, 130), line);
                                } else {
                                    ui.monospace(line);
                                }
                            }
                        });
                });
            });
        });

        // 4. DIALOGHI MODALI
        self.render_dialogs(ctx);

        if self.is_working {
            ctx.request_repaint();
        }
    }
}

impl MmexSyncGuiApp {
    fn render_dialogs(&mut self, ctx: &egui::Context) {
        // Dialog Nuovo Profilo
        if self.dialog_new_profile {
            egui::Window::new(self.lang.dialog_new_profile_title())
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.label(self.lang.dialog_name_prompt());
                    ui.text_edit_singleline(&mut self.new_profile_name);
                    ui.horizontal(|ui| {
                        if ui.button(self.lang.btn_ok()).clicked() {
                            let name = self.new_profile_name.trim().to_string();
                            if !name.is_empty() {
                                let empty_profile = ProfileConfig::default();
                                if self.config_mgr.save_profile(&name, &empty_profile).is_ok() {
                                    self.refresh_profile_list();
                                    self.load_profile_data(&name);
                                }
                            }
                            self.dialog_new_profile = false;
                        }
                        if ui.button(self.lang.btn_cancel()).clicked() {
                            self.dialog_new_profile = false;
                        }
                    });
                });
        }

        // Dialog Password Nuovo Database Cifrato (.emb)
        if self.dialog_new_emb_password {
            egui::Window::new(self.lang.dialog_new_emb_pwd_title())
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.label(self.lang.dialog_new_emb_pwd_prompt());
                    ui.add(egui::TextEdit::singleline(&mut self.new_emb_password_input).password(true));
                    ui.checkbox(
                        &mut self.save_file_password,
                        self.lang.field_save_password(),
                    );
                    ui.horizontal(|ui| {
                        if ui.button(self.lang.btn_ok()).clicked() {
                            if self.new_emb_password_input.is_empty() {
                                self.status_message = Some((
                                    self.lang.t("gui.msg.emb_password_required").to_string(),
                                    true,
                                ));
                            } else {
                                self.file_password = self.new_emb_password_input.clone();
                                self.dialog_new_emb_password = false;
                                self.save_current_profile();
                                self.trigger_create_db_async();
                            }
                        }
                        if ui.button(self.lang.btn_cancel()).clicked() {
                            self.dialog_new_emb_password = false;
                        }
                    });
                });
        }

        // Dialog Salva con nome
        if self.dialog_save_as {
            egui::Window::new(self.lang.dialog_save_as_title())
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.label(self.lang.dialog_name_prompt());
                    ui.text_edit_singleline(&mut self.save_as_name);
                    ui.horizontal(|ui| {
                        if ui.button(self.lang.btn_ok()).clicked() {
                            let name = self.save_as_name.trim().to_string();
                            if !name.is_empty() {
                                self.active_profile = name;
                                self.save_current_profile();
                            }
                            self.dialog_save_as = false;
                        }
                        if ui.button(self.lang.btn_cancel()).clicked() {
                            self.dialog_save_as = false;
                        }
                    });
                });
        }

        // Dialog Rinomina Profilo
        if self.dialog_rename_profile {
            egui::Window::new(self.lang.dialog_rename_title())
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.label(self.lang.dialog_name_prompt());
                    ui.text_edit_singleline(&mut self.rename_profile_name);
                    ui.horizontal(|ui| {
                        if ui.button(self.lang.btn_ok()).clicked() {
                            let new_name = self.rename_profile_name.trim().to_string();
                            if !new_name.is_empty()
                                && new_name != self.active_profile
                                && self
                                    .config_mgr
                                    .rename_profile(&self.active_profile, &new_name)
                                    .is_ok()
                            {
                                self.active_profile = new_name;
                                self.refresh_profile_list();
                            }
                            self.dialog_rename_profile = false;
                        }
                        if ui.button(self.lang.btn_cancel()).clicked() {
                            self.dialog_rename_profile = false;
                        }
                    });
                });
        }

        // Dialog Conferma Eliminazione
        if self.dialog_delete_confirm {
            egui::Window::new(self.lang.dialog_delete_confirm_title())
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.label(self.lang.dialog_delete_confirm_msg(&self.active_profile));
                    ui.horizontal(|ui| {
                        if ui.button(self.lang.btn_ok()).clicked() {
                            let _ = self.config_mgr.delete_profile(&self.active_profile);
                            self.refresh_profile_list();
                            let fallback = self.default_profile.clone();
                            self.load_profile_data(&fallback);
                            self.dialog_delete_confirm = false;
                        }
                        if ui.button(self.lang.btn_cancel()).clicked() {
                            self.dialog_delete_confirm = false;
                        }
                    });
                });
        }

        // Dialog Conferma Pulizia DB Locale
        if self.dialog_clear_db_confirm {
            egui::Window::new(self.lang.dialog_clear_db_title())
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.label(self.lang.dialog_clear_db_msg());
                    ui.horizontal(|ui| {
                        if ui.button(self.lang.btn_ok()).clicked() {
                            self.dialog_clear_db_confirm = false;
                            self.trigger_clear_db_async();
                        }
                        if ui.button(self.lang.btn_cancel()).clicked() {
                            self.dialog_clear_db_confirm = false;
                        }
                    });
                });
        }

        // Dialog Conferma Pulizia Server Remoto
        if self.dialog_clear_server_confirm {
            egui::Window::new(self.lang.dialog_clear_server_title())
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.colored_label(
                        egui::Color32::from_rgb(255, 90, 90),
                        self.lang.dialog_clear_server_msg(),
                    );
                    ui.horizontal(|ui| {
                        if ui.button(self.lang.btn_ok()).clicked() {
                            self.dialog_clear_server_confirm = false;
                            self.trigger_clear_server_async();
                        }
                        if ui.button(self.lang.btn_cancel()).clicked() {
                            self.dialog_clear_server_confirm = false;
                        }
                    });
                });
        }

        // Dialog Informazioni (About)
        if self.dialog_about {
            egui::Window::new(self.lang.about_title())
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
                .show(ctx, |ui| {
                    ui.label(self.lang.about_content());
                    ui.separator();
                    if ui.button(self.lang.btn_close()).clicked() {
                        self.dialog_about = false;
                    }
                });
        }
    }
}
