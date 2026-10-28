#![allow(dead_code)]

use std::path::Path;
use std::process::Command;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{error, info, warn};

use crate::config::ConfigManager;
use crate::db::DatabaseService;
use crate::error::SyncError;
use crate::remoteserver::RemoteServer;
use crate::sync::engine::{SyncEngine, SyncOptions};

/// Configurazione per il SyncRunner
#[derive(Debug, Clone)]
pub struct RunnerConfig<'a> {
    pub profile_name: String,
    pub db_path: &'a Path,
    pub mmex_exe: Option<&'a Path>,
    pub default_mode: String,
    pub options: SyncOptions,
    pub last_sync: Option<String>,
}

/// Runner per le diverse modalità operative (Sync, Run, Watch)
pub struct SyncRunner<'a> {
    db: &'a mut DatabaseService,
    remote: &'a mut dyn RemoteServer,
    config_mgr: &'a ConfigManager,
    profile_name: String,
    db_path: &'a Path,
    mmex_exe: Option<&'a Path>,
    default_mode: String,
    options: SyncOptions,
    last_sync: Option<String>,
}

impl<'a> SyncRunner<'a> {
    pub fn new(
        db: &'a mut DatabaseService,
        remote: &'a mut dyn RemoteServer,
        config_mgr: &'a ConfigManager,
        config: RunnerConfig<'a>,
    ) -> Self {
        Self {
            db,
            remote,
            config_mgr,
            profile_name: config.profile_name,
            db_path: config.db_path,
            mmex_exe: config.mmex_exe,
            default_mode: config.default_mode,
            options: config.options,
            last_sync: config.last_sync,
        }
    }

    /// Esegue la modalità operativa richiesta
    pub async fn run(mut self, requested_mode: Option<&str>) -> Result<(), SyncError> {
        let mode = requested_mode.unwrap_or(self.default_mode.as_str()).to_lowercase();
        info!("{}", crate::i18n::t_fmt("sync.runner_start_mode", &[("mode", &mode.to_uppercase())]));

        match mode.as_str() {
            "run" => self.execute_run_mode().await,
            "watch" => self.execute_watch_mode().await,
            _ => self.execute_sync_mode().await,
        }
    }

    /// Modalità SYNC: esecuzione del ciclo PUSH + PULL
    async fn execute_sync_mode(&mut self) -> Result<(), SyncError> {
        let mut engine = SyncEngine::new(
            self.db,
            self.remote,
            self.options.clone(),
            self.last_sync.clone(),
        );

        let (_stats, new_timestamp) = engine.run_cycle().await?;

        if let Some(ts) = new_timestamp {
            let mut profile = self.config_mgr.load_profile(&self.profile_name)?;
            profile.last_sync = Some(ts);
            self.config_mgr.save_profile(&self.profile_name, &profile)?;
            info!("{}", crate::i18n::t("sync.timestamp_saved"));
        }

        Ok(())
    }

    /// Modalità RUN: Sync iniziale -> Avvia MMEX e attende chiusura -> Sync finale
    async fn execute_run_mode(&mut self) -> Result<(), SyncError> {
        let exe = match self.mmex_exe {
            Some(p) if p.exists() => p,
            _ => {
                warn!("{}", crate::i18n::t("sync.mmex_not_configured_fallback"));
                return self.execute_sync_mode().await;
            }
        };

        info!("{}", crate::i18n::t("sync.pre_sync_start"));
        self.execute_sync_mode().await?;

        info!("{}", crate::i18n::t_fmt("sync.mmex_process_start", &[("exe", &exe.display().to_string()), ("db", &self.db_path.display().to_string())]));
        let status = Command::new(exe)
            .arg(self.db_path)
            .status()
            .map_err(SyncError::Io)?;

        info!("{}", crate::i18n::t_fmt("sync.mmex_process_finished", &[("status", &status.to_string())]));
        self.execute_sync_mode().await?;

        Ok(())
    }

    /// Modalità WATCH: Sync iniziale -> Avvio MMEX (detached) -> Monitoraggio variazioni
    async fn execute_watch_mode(&mut self) -> Result<(), SyncError> {
        info!("{}", crate::i18n::t("sync.watch_pre_sync_start"));
        self.execute_sync_mode().await?;

        if let Some(exe) = self.mmex_exe {
            if exe.exists() {
                info!("{}", crate::i18n::t("sync.mmex_background_start"));
                let _ = Command::new(exe).arg(self.db_path).spawn();
            }
        }

        info!("{}", crate::i18n::t("sync.watch_active"));

        let mut last_modified = std::fs::metadata(self.db_path).and_then(|m| m.modified()).ok();
        let check_interval = Duration::from_secs(3);

        loop {
            sleep(check_interval).await;

            let current_mod = std::fs::metadata(self.db_path).and_then(|m| m.modified()).ok();
            if current_mod != last_modified && current_mod.is_some() {
                info!("{}", crate::i18n::t("sync.watch_file_changed"));
                last_modified = current_mod;

                let mut engine = SyncEngine::new(
                    self.db,
                    self.remote,
                    self.options.clone(),
                    self.last_sync.clone(),
                );

                if let Ok((_stats, Some(ts))) = engine.run_cycle().await {
                    self.last_sync = Some(ts.clone());
                    if let Ok(mut profile) = self.config_mgr.load_profile(&self.profile_name) {
                        profile.last_sync = Some(ts);
                        let _ = self.config_mgr.save_profile(&self.profile_name, &profile);
                    }
                }
            }
        }
    }
}
