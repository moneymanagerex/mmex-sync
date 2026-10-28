#![allow(dead_code)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use rusqlite::types::ValueRef;
use rusqlite::{params_from_iter, Connection, ToSql};
use tracing::{debug, info, warn};

use crate::crypto::emb::{is_emb_path, EmbDatabaseHandler};
use crate::db::schema::{
    clear_technical_schema, create_empty_database, init_sync_schema, inspect_table_columns,
};
use crate::domain::model::{
    DeletedRecordEntry, LocalRecord, RecordValue, RemoteRecord, SyncStatus, TableSchemaInfo,
};
use crate::domain::sync_order::{get_referencing_fk_columns, get_table_config, UniqueConstraint, SYNC_ORDER};
use crate::error::SyncError;

/// Servizio di accesso e gestione del database MMEX (.mmb e .emb)
pub struct DatabaseService {
    conn: Connection,
    db_path: PathBuf,
    emb_handler: Option<EmbDatabaseHandler>,
    schemas: HashMap<String, TableSchemaInfo>,
    verbose: bool,
}

impl DatabaseService {
    /// Connette al database SQLite MMEX (.mmb o .emb decifrato)
    pub fn connect(
        db_path: &Path,
        verbose: bool,
        password: Option<&str>,
        create: bool,
    ) -> Result<Self, SyncError> {
        let is_emb = is_emb_path(db_path) || password.is_some();
        let mut emb_handler = None;

        let real_path = if is_emb {
            let handler = EmbDatabaseHandler::open_or_create(db_path, password, create)?;
            let p = handler.temp_db_path().to_path_buf();
            emb_handler = Some(handler);
            p
        } else {
            db_path.to_path_buf()
        };

        let conn = Connection::open(&real_path)?;

        // Impostazioni di concorrenza SQLite secondo AGENTS.md
        conn.busy_timeout(Duration::from_secs(10))?;
        let _ = conn.execute("PRAGMA journal_mode = WAL", []);

        let mut service = Self {
            conn,
            db_path: db_path.to_path_buf(),
            emb_handler,
            schemas: HashMap::new(),
            verbose,
        };

        if create || (!db_path.exists() && !is_emb) {
            info!("{}", crate::i18n::t_fmt("db.init_new_db", &[("path", &db_path.display().to_string())]));
            create_empty_database(&service.conn, None)?;
            service.mark_modified();
        }

        service.refresh_schemas()?;
        Ok(service)
    }

    /// Ricarica la cache degli schemi per tutte le tabelle note in SYNC_ORDER
    pub fn refresh_schemas(&mut self) -> Result<(), SyncError> {
        self.schemas.clear();
        for table in SYNC_ORDER {
            if let Ok((pk, fields, tech_fields)) = inspect_table_columns(&self.conn, table) {
                self.schemas.insert(
                    table.to_string(),
                    TableSchemaInfo {
                        pk,
                        fields,
                        tech_fields,
                    },
                );
            }
        }
        Ok(())
    }

    /// Segna il database come modificato (richiede il flush se .emb)
    pub fn mark_modified(&mut self) {
        if let Some(h) = &mut self.emb_handler {
            h.mark_modified();
        }
    }

    /// Applica l'inizializzazione dello schema tecnico (tabelle pb_* e trigger)
    pub fn init_schema(&mut self) -> Result<(), SyncError> {
        init_sync_schema(&mut self.conn)?;
        self.refresh_schemas()?;
        self.mark_modified();
        Ok(())
    }

    /// Ripulisce lo schema tecnico (rimuove trigger e colonne pb_*)
    pub fn clear_technical(&mut self) -> Result<(), SyncError> {
        clear_technical_schema(&mut self.conn)?;
        self.refresh_schemas()?;
        self.mark_modified();
        Ok(())
    }

    /// Restituisce un riferimento alla connessione SQLite sottostante (utile per test e diagnostica)
    pub fn raw_conn(&self) -> &Connection {
        &self.conn
    }

    /// Salva le modifiche (se il database è .emb, esegue il checkpoint WAL e ricifra atomicamente su disco)
    pub fn flush(&mut self) -> Result<(), SyncError> {
        if let Some(h) = &mut self.emb_handler {
            // Checkpoint obbligatorio del WAL per riversare tutte le pagine nel file SQLite primario
            let _ = self.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
            h.flush_to_emb()?;
        }
        Ok(())
    }

    /// Recupera i record locali da sincronizzare (dirty = 1 oppure pb_id vuoto/nullo)
    pub fn get_dirty_records(
        &self,
        table: &str,
        force: bool,
    ) -> Result<Vec<LocalRecord>, SyncError> {
        let base_sql = format!("SELECT *, ROWID as rowid FROM {}", table);
        let query_sql = if force {
            base_sql
        } else {
            format!(
                "{} WHERE pb_is_dirty = 1 OR pb_id = '' OR pb_id IS NULL",
                base_sql
            )
        };

        let mut stmt = self.conn.prepare(&query_sql)?;
        let column_names: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(|s| s.to_string())
            .collect();

        let mut rows = stmt.query([])?;
        let mut results = Vec::new();

        while let Some(row) = rows.next()? {
            let mut rowid = 0i64;
            let mut pb_id = None;
            let mut pb_is_dirty = SyncStatus::Dirty;
            let mut pb_updated_at = None;
            let mut fields = HashMap::new();

            for (idx, name) in column_names.iter().enumerate() {
                let val_ref = row.get_ref(idx)?;
                let rec_val = match val_ref {
                    ValueRef::Null => RecordValue::Null,
                    ValueRef::Integer(i) => RecordValue::Integer(i),
                    ValueRef::Real(f) => RecordValue::Real(f),
                    ValueRef::Text(s) => RecordValue::Text(String::from_utf8_lossy(s).to_string()),
                    ValueRef::Blob(b) => RecordValue::Blob(b.to_vec()),
                };

                match name.as_str() {
                    "rowid" => {
                        if let RecordValue::Integer(id) = rec_val {
                            rowid = id;
                        }
                    }
                    "pb_id" => {
                        if let RecordValue::Text(id) = rec_val {
                            if !id.trim().is_empty() {
                                pb_id = Some(id);
                            }
                        }
                    }
                    "pb_is_dirty" => {
                        if let RecordValue::Integer(status) = rec_val {
                            pb_is_dirty = SyncStatus::from(status);
                        }
                    }
                    "pb_updated_at" => {
                        if let RecordValue::Text(ts) = rec_val {
                            pb_updated_at = Some(ts);
                        }
                    }
                    _ => {
                        fields.insert(name.clone(), rec_val);
                    }
                }
            }

            results.push(LocalRecord {
                rowid,
                pb_id,
                pb_is_dirty,
                pb_updated_at,
                fields,
            });
        }

        Ok(results)
    }

    /// Imposta lo stato pb_is_dirty = 2 (Pending)
    pub fn set_pending_status(&mut self, table: &str, rowid: i64) -> Result<(), SyncError> {
        let sql = format!("UPDATE {} SET pb_is_dirty = 2 WHERE ROWID = ?", table);
        self.conn.execute(&sql, [rowid])?;
        self.mark_modified();
        Ok(())
    }

    /// Imposta lo stato pb_is_dirty = 0 (Synced) e memorizza il pb_id remoto
    pub fn set_synced_status(&mut self, table: &str, rowid: i64, pb_id: &str) -> Result<(), SyncError> {
        let sql = format!(
            "UPDATE {} SET pb_is_dirty = 0, pb_id = ? WHERE ROWID = ?",
            table
        );
        self.conn.execute(&sql, rusqlite::params![pb_id, rowid])?;
        self.mark_modified();
        Ok(())
    }

    /// Imposta lo stato pb_is_dirty = 1 (Dirty)
    pub fn set_dirty_status(&mut self, table: &str, rowid: i64) -> Result<(), SyncError> {
        let sql = format!("UPDATE {} SET pb_is_dirty = 1 WHERE ROWID = ?", table);
        self.conn.execute(&sql, [rowid])?;
        self.mark_modified();
        Ok(())
    }

    /// Resetta operazioni incomplete (da Pending 2 a Dirty 1)
    pub fn reset_unfinished_ops(&mut self, table: &str) -> Result<(), SyncError> {
        let sql = format!("UPDATE {} SET pb_is_dirty = 1 WHERE pb_is_dirty = 2", table);
        self.conn.execute(&sql, [])?;
        self.mark_modified();
        Ok(())
    }

    /// Rimuove un record locale dato il suo rowid
    pub fn remove_record(&mut self, table: &str, rowid: i64) -> Result<(), SyncError> {
        let sql = format!("DELETE FROM {} WHERE ROWID = ?", table);
        self.conn.execute(&sql, [rowid])?;
        self.mark_modified();
        Ok(())
    }

    /// Ricerca il rowid di un record locale tramite pb_id
    pub fn find_rowid_by_pb_id(&self, table: &str, pb_id: &str) -> Result<Option<i64>, SyncError> {
        let sql = format!("SELECT ROWID FROM {} WHERE pb_id = ?", table);
        let mut stmt = self.conn.prepare(&sql)?;
        let mut rows = stmt.query([pb_id])?;
        if let Some(row) = rows.next()? {
            let rowid: i64 = row.get(0)?;
            Ok(Some(rowid))
        } else {
            Ok(None)
        }
    }

    /// Ricerca il rowid di un record locale che soddisfa i vincoli di unicità specificati
    pub fn find_rowid_by_unique_keys(
        &self,
        table: &str,
        remote: &RemoteRecord,
    ) -> Result<Option<(i64, i64)>, SyncError> {
        let schema = match self.schemas.get(table) {
            Some(s) => s,
            None => return Ok(None),
        };
        let table_config = match get_table_config(table) {
            Some(c) => c,
            None => return Ok(None),
        };

        for constraint in table_config.unique {
            let where_clause = match constraint {
                UniqueConstraint::Single(col) => {
                    if let Some(val) = remote.fields.get(*col) {
                        if !val.is_null() {
                            format!("{} = '{}'", col, val.to_string().trim_matches('"'))
                        } else {
                            continue;
                        }
                    } else {
                        continue;
                    }
                }
                UniqueConstraint::Composite(cols) => {
                    let mut parts = Vec::new();
                    for col in *cols {
                        if let Some(val) = remote.fields.get(*col) {
                            if !val.is_null() {
                                parts.push(format!("{} = '{}'", col, val.to_string().trim_matches('"')));
                            }
                        }
                    }
                    if parts.len() == cols.len() {
                        parts.join(" AND ")
                    } else {
                        continue;
                    }
                }
            };

            let sql = format!(
                "SELECT ROWID, {} FROM {} WHERE {}",
                schema.pk, table, where_clause
            );
            if let Ok(mut stmt) = self.conn.prepare(&sql) {
                if let Ok(mut rows) = stmt.query([]) {
                    if let Ok(Some(row)) = rows.next() {
                        let rowid: i64 = row.get(0)?;
                        let pk_val: i64 = row.get(1).unwrap_or(rowid);
                        return Ok(Some((rowid, pk_val)));
                    }
                }
            }
        }

        Ok(None)
    }

    /// Applica i cambiamenti remoti al database locale (PULL) con risoluzione
    /// bidirezionale dei vincoli di chiave univoca e propagazione FK tramite FK_MAP.
    pub fn apply_remote_changes(
        &mut self,
        table: &str,
        remote: &RemoteRecord,
    ) -> Result<(), SyncError> {
        let schema = self.schemas.get(table).cloned().ok_or_else(|| {
            SyncError::NotFound(crate::i18n::t_fmt("db.schema_not_found", &[("table", table)]))
        })?;

        let existing_rowid = self.find_rowid_by_pb_id(table, &remote.id)?;
        let updated_at = remote
            .updated_at
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

        let tx = self.conn.transaction()?;

        if let Some(rowid) = existing_rowid {
            if remote.is_deleted {
                tx.execute(&format!("DELETE FROM {} WHERE ROWID = ?", table), [rowid])?;
            } else {
                // Aggiornamento del record esistente
                let mut set_clauses = Vec::new();
                let mut params: Vec<Box<dyn ToSql>> = Vec::new();

                for field in &schema.fields {
                    if let Some(val) = remote.fields.get(field) {
                        set_clauses.push(format!("{} = ?", field));
                        params.push(json_value_to_sql(val));
                    }
                }

                if !set_clauses.is_empty() {
                    set_clauses.push("pb_is_dirty = 2".to_string());
                    set_clauses.push("pb_updated_at = ?".to_string());
                    params.push(Box::new(updated_at.clone()));
                    params.push(Box::new(rowid));

                    let update_sql = format!(
                        "UPDATE {} SET {} WHERE ROWID = ?",
                        table,
                        set_clauses.join(", ")
                    );
                    tx.execute(&update_sql, params_from_iter(params.iter().map(|b| b.as_ref())))?;

                    // Reset a 0 (Sincronizzato)
                    tx.execute(
                        &format!("UPDATE {} SET pb_is_dirty = 0 WHERE ROWID = ?", table),
                        [rowid],
                    )?;
                }
            }
        } else if !remote.is_deleted {
            // Tentativo di inserimento o risoluzione conflitto su chiave univoca locale
            let mut insert_fields = vec![schema.pk.clone()];
            let mut placeholders = vec!["?".to_string()];
            let mut params: Vec<Box<dyn ToSql>> = Vec::new();

            // Primary Key remoto
            let remote_pk_val = remote.fields.get(&schema.pk).and_then(|v| v.as_i64());
            params.push(Box::new(remote_pk_val));

            for field in &schema.fields {
                if let Some(val) = remote.fields.get(field) {
                    insert_fields.push(field.clone());
                    placeholders.push("?".to_string());
                    params.push(json_value_to_sql(val));
                }
            }

            insert_fields.push("pb_id".to_string());
            placeholders.push("?".to_string());
            params.push(Box::new(remote.id.clone()));

            insert_fields.push("pb_is_dirty".to_string());
            placeholders.push("2".to_string());

            insert_fields.push("pb_updated_at".to_string());
            placeholders.push("?".to_string());
            params.push(Box::new(updated_at));

            let insert_sql = format!(
                "INSERT INTO {} ({}) VALUES ({})",
                table,
                insert_fields.join(", "),
                placeholders.join(", ")
            );

            let insert_result = tx.execute(&insert_sql, params_from_iter(params.iter().map(|b| b.as_ref())));

            match insert_result {
                Ok(_) => {
                    let last_id = tx.last_insert_rowid();
                    tx.execute(
                        &format!("UPDATE {} SET pb_is_dirty = 0 WHERE ROWID = ?", table),
                        [last_id],
                    )?;
                }
                Err(rusqlite::Error::SqliteFailure(err, _))
                    if err.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    // Conflitto di unicità rilevato in download:
                    // individuiamo il record locale preesistente avente gli stessi campi univoci
                    debug!(
                        "Rilevato conflitto di unicità in PULL per tabella {}. Risoluzione...",
                        table
                    );
                    drop(tx); // Rilasciamo la transazione corrente per cercare e sostituire

                    if let Some((conflict_rowid, conflict_pk)) = self.find_rowid_by_unique_keys(table, remote)? {
                        self.replace_record_and_references(
                            table,
                            conflict_rowid,
                            conflict_pk,
                            remote,
                        )?;
                        return Ok(());
                    } else {
                        return Err(SyncError::UniqueConstraintViolation {
                            table: table.to_string(),
                            details: crate::i18n::t_fmt("db.unique_constraint_detected", &[("table", table)]),
                        });
                    }
                }
                Err(e) => return Err(SyncError::Database(e)),
            }
        }

        tx.commit()?;
        self.mark_modified();
        Ok(())
    }

    /// Sostituisce un record locale in conflitto e aggiorna a cascata tutte le Foreign Key
    /// referenzianti secondo la mappa `FK_MAP`.
    pub fn replace_record_and_references(
        &mut self,
        table: &str,
        old_rowid: i64,
        old_pk: i64,
        remote: &RemoteRecord,
    ) -> Result<(), SyncError> {
        let schema = self.schemas.get(table).cloned().ok_or_else(|| {
            SyncError::NotFound(crate::i18n::t_fmt("db.schema_not_found", &[("table", table)]))
        })?;

        let new_pk = remote
            .fields
            .get(&schema.pk)
            .and_then(|v| v.as_i64())
            .unwrap_or(old_pk);

        let updated_at = remote
            .updated_at
            .clone()
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());

        let tx = self.conn.transaction()?;

        let mut set_clauses = vec![format!("{} = ?", schema.pk)];
        let mut params: Vec<Box<dyn ToSql>> = vec![Box::new(new_pk)];

        for field in &schema.fields {
            if let Some(val) = remote.fields.get(field) {
                set_clauses.push(format!("{} = ?", field));
                params.push(json_value_to_sql(val));
            }
        }

        set_clauses.push("pb_id = ?".to_string());
        params.push(Box::new(remote.id.clone()));

        set_clauses.push("pb_is_dirty = 2".to_string());

        set_clauses.push("pb_updated_at = ?".to_string());
        params.push(Box::new(updated_at));

        params.push(Box::new(old_rowid));

        let update_sql = format!(
            "UPDATE {} SET {} WHERE ROWID = ?",
            table,
            set_clauses.join(", ")
        );
        tx.execute(&update_sql, params_from_iter(params.iter().map(|b| b.as_ref())))?;

        // Imposta a 0 (Sincronizzato)
        tx.execute(
            &format!("UPDATE {} SET pb_is_dirty = 0 WHERE ROWID = ?", table),
            [old_rowid],
        )?;

        // Se la Primary Key è cambiata, aggiorna a cascata tutte le tabelle dipendenti (FK_MAP)
        if old_pk != new_pk {
            let referencing_cols = get_referencing_fk_columns(&schema.pk);
            for dep_table in SYNC_ORDER {
                if let Ok((_, dep_fields, _)) = inspect_table_columns(&tx, dep_table) {
                    for col in &dep_fields {
                        if referencing_cols.contains(&col.as_str()) {
                            let cascade_sql = format!(
                                "UPDATE {} SET {} = ? WHERE {} = ?",
                                dep_table, col, col
                            );
                            let affected = tx.execute(&cascade_sql, rusqlite::params![new_pk, old_pk])?;
                            if affected > 0 {
                                debug!(
                                    "Propagata FK {} -> {} su {} (record aggiornati: {})",
                                    old_pk, new_pk, dep_table, affected
                                );
                            }
                        }
                    }
                }
            }
        }

        tx.commit()?;
        self.mark_modified();
        info!(
            "{}",
            crate::i18n::t_fmt(
                "db.unique_constraint_resolved",
                &[
                    ("table", table),
                    ("rowid", &old_rowid.to_string()),
                    ("old_pk", &old_pk.to_string()),
                    ("new_pk", &new_pk.to_string()),
                ]
            )
        );
        Ok(())
    }

    /// Recupera tutte le voci dal log delle cancellazioni
    pub fn get_deleted_log(&self) -> Result<Vec<DeletedRecordEntry>, SyncError> {
        let mut stmt = self
            .conn
            .prepare("SELECT table_name, pb_id, deleted_at FROM pb_DELETED_RECORDS_LOG")?;

        let rows = stmt.query_map([], |row| {
            Ok(DeletedRecordEntry {
                table_name: row.get(0)?,
                pb_id: row.get(1)?,
                deleted_at: row.get(2)?,
            })
        })?;

        let mut entries = Vec::new();
        for r in rows {
            entries.push(r?);
        }
        Ok(entries)
    }

    /// Rimuove una voce sincronizzata dal log delle cancellazioni
    pub fn remove_deleted_record_log(&mut self, table_name: &str, pb_id: &str) -> Result<(), SyncError> {
        self.conn.execute(
            "DELETE FROM pb_DELETED_RECORDS_LOG WHERE table_name = ? AND pb_id = ?",
            rusqlite::params![table_name, pb_id],
        )?;
        self.mark_modified();
        Ok(())
    }

    /// Svuota l'intero log delle cancellazioni
    pub fn clear_deleted_log(&mut self) -> Result<(), SyncError> {
        self.conn.execute("DELETE FROM pb_DELETED_RECORDS_LOG", [])?;
        self.mark_modified();
        Ok(())
    }
}

/// Helper per convertire un serde_json::Value in un tipo compatibile con rusqlite::ToSql
fn json_value_to_sql(val: &serde_json::Value) -> Box<dyn ToSql> {
    match val {
        serde_json::Value::Null => Box::new(rusqlite::types::Null),
        serde_json::Value::Bool(b) => Box::new(if *b { 1i64 } else { 0i64 }),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else if let Some(f) = n.as_f64() {
                Box::new(f)
            } else {
                Box::new(n.to_string())
            }
        }
        serde_json::Value::String(s) => Box::new(s.clone()),
        other => Box::new(other.to_string()),
    }
}
