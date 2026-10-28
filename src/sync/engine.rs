#![allow(dead_code)]

use std::collections::HashMap;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use tracing::{debug, error, info, warn};

use crate::db::DatabaseService;
use crate::domain::model::{LocalRecord, RecordValue, RemoteRecord};
use crate::domain::sync_order::{get_table_config, UniqueConstraint, SYNC_ORDER};
use crate::error::SyncError;
use crate::remoteserver::RemoteServer;

/// Opzioni operative per il ciclo di sincronizzazione
#[derive(Debug, Clone, Default)]
pub struct SyncOptions {
    pub init: bool,
    pub push: bool,
    pub pull: bool,
    pub force: bool,
    pub verbose: bool,
}

impl SyncOptions {
    /// Crea opzioni a partire dal parametro stringa `--sync` (es. "init,pull" o None per completo)
    pub fn from_cli_sync(sync_param: Option<&Option<String>>, force: bool, verbose: bool) -> Self {
        match sync_param {
            None => Self {
                init: false,
                push: false,
                pull: false,
                force,
                verbose,
            },
            Some(None) => Self {
                init: true,
                push: true,
                pull: true,
                force,
                verbose,
            },
            Some(Some(s)) => {
                let parts: Vec<String> = s.split(',').map(|p| p.trim().to_lowercase()).collect();
                Self {
                    init: parts.iter().any(|p| p == "init"),
                    push: parts.iter().any(|p| p == "push"),
                    pull: parts.iter().any(|p| p == "pull"),
                    force,
                    verbose,
                }
            }
        }
    }
}

/// Statistiche aggregate del ciclo di sincronizzazione
#[derive(Debug, Default, Clone)]
pub struct SyncStats {
    pub pushed_records: usize,
    pub pulled_records: usize,
    pub deleted_records: usize,
    pub conflicts_resolved: usize,
}

/// Motore atomico di sincronizzazione che orchestra DatabaseService e RemoteServer
pub struct SyncEngine<'a> {
    db: &'a mut DatabaseService,
    remote: &'a mut dyn RemoteServer,
    options: SyncOptions,
    last_sync: Option<String>,
}

impl<'a> SyncEngine<'a> {
    pub fn new(
        db: &'a mut DatabaseService,
        remote: &'a mut dyn RemoteServer,
        options: SyncOptions,
        last_sync: Option<String>,
    ) -> Self {
        Self {
            db,
            remote,
            options,
            last_sync,
        }
    }

    /// Esegue il ciclo completo di sincronizzazione orchestrato in conformità ad AGENTS.md
    pub async fn run_cycle(&mut self) -> Result<(SyncStats, Option<String>), SyncError> {
        let mut stats = SyncStats::default();
        info!(
            "{}",
            crate::i18n::t_fmt(
                "sync.cycle_start",
                &[
                    ("init", &self.options.init.to_string()),
                    ("push", &self.options.push.to_string()),
                    ("pull", &self.options.pull.to_string()),
                    ("force", &self.options.force.to_string()),
                ]
            )
        );

        // 1. INIT: Assicura la presenza di trigger e colonne tecniche
        if self.options.init {
            info!("{}", crate::i18n::t("sync.init_schema"));
            self.db.init_schema()?;
        }

        // 2. PUSH: Invio modifiche e delezioni locali verso il server
        if self.options.push {
            info!("{}", crate::i18n::t("sync.push_start"));
            self.sync_deletions(&mut stats).await?;

            for table in SYNC_ORDER {
                self.push_table(table, &mut stats).await?;
            }
        }

        // 3. PULL: Ricezione modifiche remote ed applicazione transazionale atomica
        let mut new_sync_time = None;
        if self.options.pull {
            info!("{}", crate::i18n::t("sync.pull_start"));
            let cycle_start_time = Utc::now().to_rfc3339();

            for table in SYNC_ORDER {
                self.pull_table(table, &mut stats).await?;
            }

            new_sync_time = Some(cycle_start_time);
        }

        // 4. FLUSH: Ricifra e salva su disco se il DB è .emb ed è stato modificato (anche in Push-Only o Init-Only)
        self.db.flush()?;

        info!(
            "{}",
            crate::i18n::t_fmt(
                "sync.cycle_complete",
                &[
                    ("pushed", &stats.pushed_records.to_string()),
                    ("pulled", &stats.pulled_records.to_string()),
                    ("deleted", &stats.deleted_records.to_string()),
                    ("conflicts", &stats.conflicts_resolved.to_string()),
                ]
            )
        );
        Ok((stats, new_sync_time))
    }

    /// Sincronizza le cancellazioni locali registrate in pb_DELETED_RECORDS_LOG
    async fn sync_deletions(&mut self, stats: &mut SyncStats) -> Result<(), SyncError> {
        let deleted_log = self.db.get_deleted_log()?;
        if deleted_log.is_empty() {
            return Ok(());
        }

        debug!("Sincronizzazione di {} cancellazioni verso il server...", deleted_log.len());
        for entry in deleted_log {
            let mut payload = HashMap::new();
            payload.insert("_is_deleted".to_string(), serde_json::json!(true));
            payload.insert(
                "_updated_at".to_string(),
                serde_json::json!(entry.deleted_at.unwrap_or_else(|| Utc::now().to_rfc3339())),
            );

            match self.remote.update(&entry.table_name, &entry.pb_id, &payload).await {
                Ok(_) => {
                    self.db.remove_deleted_record_log(&entry.table_name, &entry.pb_id)?;
                    stats.deleted_records += 1;
                }
                Err(SyncError::NotFound(_)) => {
                    // Record già assente sul server remoto
                    self.db.remove_deleted_record_log(&entry.table_name, &entry.pb_id)?;
                    stats.deleted_records += 1;
                }
                Err(err) => {
                    warn!(
                        "{}",
                        crate::i18n::t_fmt(
                            "sync.soft_delete_failed",
                            &[
                                ("id", &entry.pb_id),
                                ("table", &entry.table_name),
                                ("error", &err.to_string()),
                            ]
                        )
                    );
                }
            }
        }

        Ok(())
    }

    /// Esegue il push dei record sporchi o privi di pb_id per una tabella
    async fn push_table(&mut self, table: &str, stats: &mut SyncStats) -> Result<(), SyncError> {
        let dirty_records = self.db.get_dirty_records(table, self.options.force)?;
        if dirty_records.is_empty() {
            return Ok(());
        }

        debug!("Push {}: elaborazione di {} record...", table, dirty_records.len());
        for record in dirty_records {
            let mut payload = local_record_to_json(&record);
            let updated_at = record
                .pb_updated_at
                .clone()
                .unwrap_or_else(|| Utc::now().to_rfc3339());
            payload.insert("_updated_at".to_string(), serde_json::json!(updated_at));

            if let Some(pb_id) = &record.pb_id {
                // Tentativo di UPDATE
                match self.remote.update(table, pb_id, &payload).await {
                    Ok(resp) => {
                        self.db.set_synced_status(table, record.rowid, &resp.id)?;
                        stats.pushed_records += 1;
                    }
                    Err(SyncError::NotFound(_)) => {
                        // Se non esiste sul server (404), ricrea
                        match self.remote.create(table, &payload).await {
                            Ok(created) => {
                                self.db.set_synced_status(table, record.rowid, &created.id)?;
                                stats.pushed_records += 1;
                            }
                            Err(e) => {
                                self.handle_push_error(table, &record, e, stats).await?;
                            }
                        }
                    }
                    Err(SyncError::Conflict(_)) => {
                        // Conflitto Last-Write-Wins (409): riscarica il record remoto e applica localmente
                        stats.conflicts_resolved += 1;
                        if let Ok(Some(remote_rec)) = self.remote.get_by_id(table, pb_id).await {
                            self.db.apply_remote_changes(table, &remote_rec)?;
                        }
                    }
                    Err(err) => {
                        self.handle_push_error(table, &record, err, stats).await?;
                    }
                }
            } else {
                // Nuovo record mai sincronizzato: CREATE
                match self.remote.create(table, &payload).await {
                    Ok(resp) => {
                        self.db.set_synced_status(table, record.rowid, &resp.id)?;
                        stats.pushed_records += 1;
                    }
                    Err(err) => {
                        self.handle_push_error(table, &record, err, stats).await?;
                    }
                }
            }
        }

        Ok(())
    }

    /// Gestione errori di push (inclusa la risoluzione dei vincoli di unicità)
    async fn handle_push_error(
        &mut self,
        table: &str,
        record: &LocalRecord,
        error: SyncError,
        stats: &mut SyncStats,
    ) -> Result<(), SyncError> {
        if matches!(error, SyncError::UniqueConstraintViolation { .. }) {
            debug!("Violazione unicità remota su {}. Ricerca record esistente...", table);
            let mut resolved_remote: Option<RemoteRecord> = None;

            // 1. Ricerca per row_id
            if let Ok(Some(rem)) = self.remote.get_by_row_id(table, record.rowid).await {
                resolved_remote = Some(rem);
            } else if let Some(table_cfg) = get_table_config(table) {
                // 2. Ricerca per chiavi univoche configurate
                for constraint in table_cfg.unique {
                    let mut keys = Vec::new();
                    match constraint {
                        UniqueConstraint::Single(col) => {
                            if let Some(v) = record.fields.get(*col) {
                                if let Some(s) = v.as_str() {
                                    keys.push((*col, s));
                                }
                            }
                        }
                        UniqueConstraint::Composite(cols) => {
                            for col in *cols {
                                if let Some(v) = record.fields.get(*col) {
                                    if let Some(s) = v.as_str() {
                                        keys.push((*col, s));
                                    }
                                }
                            }
                        }
                    }

                    if !keys.is_empty() {
                        if let Ok(Some(rem)) = self.remote.get_by_unique_keys(table, &keys).await {
                            resolved_remote = Some(rem);
                            break;
                        }
                    }
                }
            }

            if let Some(remote_rec) = resolved_remote {
                let schema_pk = get_table_config(table).map(|c| c.pk).unwrap_or("ROWID");
                let old_pk = record.fields.get(schema_pk).and_then(|v| v.as_i64()).unwrap_or(record.rowid);

                self.db.replace_record_and_references(table, record.rowid, old_pk, &remote_rec)?;
                stats.conflicts_resolved += 1;
                return Ok(());
            }
        }

        warn!(
            "{}",
            crate::i18n::t_fmt(
                "sync.push_record_error",
                &[
                    ("table", table),
                    ("rowid", &record.rowid.to_string()),
                    ("error", &error.to_string()),
                ]
            )
        );
        Ok(())
    }

    /// Esegue il pull delle modifiche per una tabella con batch atomico SQLite
    async fn pull_table(&mut self, table: &str, stats: &mut SyncStats) -> Result<(), SyncError> {
        let filter_str = if self.options.force || self.last_sync.is_none() {
            None
        } else if let Some(ts) = &self.last_sync {
            // Buffer di sicurezza di 5 secondi rispetto al lastSync per clock skew
            if let Ok(parsed) = DateTime::parse_from_rfc3339(ts) {
                let buffered = parsed - ChronoDuration::seconds(5);
                Some(format!("_updated_at > \"{}\"", buffered.to_rfc3339()))
            } else {
                Some(format!("_updated_at > \"{}\"", ts))
            }
        } else {
            None
        };

        let remote_records = self.remote.get_full_list(table, filter_str.as_deref()).await?;
        if remote_records.is_empty() {
            return Ok(());
        }

        debug!("Pull {}: elaborazione di {} record...", table, remote_records.len());
        for remote in &remote_records {
            self.db.apply_remote_changes(table, remote)?;
            stats.pulled_records += 1;
        }

        self.db.reset_unfinished_ops(table)?;
        Ok(())
    }
}

/// Converte i campi di un LocalRecord nel formato JSON di invio
fn local_record_to_json(record: &LocalRecord) -> HashMap<String, serde_json::Value> {
    let mut payload = HashMap::new();
    for (k, v) in &record.fields {
        let json_val = match v {
            RecordValue::Null => serde_json::Value::Null,
            RecordValue::Integer(i) => serde_json::json!(i),
            RecordValue::Real(f) => serde_json::json!(f),
            RecordValue::Text(s) => serde_json::json!(s),
            RecordValue::Blob(b) => serde_json::json!(b),
        };
        payload.insert(k.clone(), json_val);
    }
    payload
}
