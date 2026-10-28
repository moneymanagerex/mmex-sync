#![allow(dead_code)]

use rusqlite::{Connection, Result as SqliteResult};
use tracing::{debug, info};

use crate::domain::sync_order::SYNC_ORDER;
use crate::error::SyncError;

pub const DEFAULT_SCHEMA_SQL: &str = include_str!("../../tables_v1_for_sync.sql");
pub const CURRENT_SYNC_VERSION: &str = "3";

/// Rileva i metadati delle colonne per una tabella (chiave primaria, campi di dominio e colonne tecniche)
pub fn inspect_table_columns(
    conn: &Connection,
    table: &str,
) -> Result<(String, Vec<String>, Vec<String>), SyncError> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let mut pk = "ROWID".to_string();
    let mut fields = Vec::new();
    let mut tech_fields = Vec::new();

    let rows = stmt.query_map([], |row| {
        let name: String = row.get(1)?;
        let is_pk: i64 = row.get(5)?;
        Ok((name, is_pk))
    })?;

    for row in rows {
        let (name, is_pk) = row?;
        if is_pk == 1 {
            pk = name.clone();
        }

        if matches!(
            name.as_str(),
            "pb_id" | "pb_is_dirty" | "pb_updated_at"
        ) {
            tech_fields.push(name);
        } else if is_pk != 1 {
            fields.push(name);
        }
    }

    if fields.is_empty() && pk == "ROWID" {
        return Err(SyncError::NotFound(crate::i18n::t_fmt(
            "db.table_not_found",
            &[("table", table)],
        )));
    }

    Ok((pk, fields, tech_fields))
}

/// Inizializza lo schema tecnico di sincronizzazione (tabelle metadati, log cancellazioni, colonne e trigger)
pub fn init_sync_schema(conn: &mut Connection) -> Result<(), SyncError> {
    let tx = conn.transaction()?;

    // 1. Tabella pb_sync_info
    tx.execute(
        r#"
        CREATE TABLE IF NOT EXISTS "pb_sync_info" (
            "KEY" TEXT PRIMARY KEY,
            "VAL" TEXT NOT NULL
        )
        "#,
        [],
    )?;

    tx.execute(
        r#"
        INSERT OR IGNORE INTO pb_sync_info (KEY, VAL) VALUES ('VERSION', '1')
        "#,
        [],
    )?;

    // Verifica versione ed esecuzione migrazioni se necessario
    let current_version: String = tx
        .query_row(
            "SELECT VAL FROM pb_sync_info WHERE KEY = 'VERSION'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| "1".to_string());

    let current_v_num: i32 = current_version.parse().unwrap_or(1);
    let target_v_num: i32 = CURRENT_SYNC_VERSION.parse().unwrap_or(3);

    if current_v_num < target_v_num {
        info!(
            "{}",
            crate::i18n::t_fmt(
                "db.schema_upgrading",
                &[("current", &current_v_num.to_string()), ("target", &target_v_num.to_string())]
            )
        );
        for table in SYNC_ORDER {
            let drop_trg = format!("DROP TRIGGER IF EXISTS TRG_{}_DELETE", table);
            let _ = tx.execute(&drop_trg, []);
        }
        tx.execute(
            "UPDATE pb_sync_info SET VAL = ? WHERE KEY = 'VERSION'",
            [CURRENT_SYNC_VERSION],
        )?;
        info!("{}", crate::i18n::t_fmt("db.schema_updated", &[("target", &target_v_num.to_string())]));
    }

    // 2. Tabella di log delle cancellazioni locali
    tx.execute(
        r#"
        CREATE TABLE IF NOT EXISTS "pb_DELETED_RECORDS_LOG" (
            "table_name"   TEXT NOT NULL,
            "pb_id"        TEXT NOT NULL,
            "deleted_at"   TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'NOW')),
            PRIMARY KEY("table_name", "pb_id")
        )
        "#,
        [],
    )?;

    // 3. Colonne tecniche e trigger per ciascuna tabella MMEX
    for table in SYNC_ORDER {
        ensure_technical_columns(&tx, table)?;
        create_triggers_for_table(&tx, table)?;
    }

    tx.commit()?;
    Ok(())
}

/// Assicura che la tabella contenga le colonne tecniche pb_id, pb_is_dirty e pb_updated_at
fn ensure_technical_columns(conn: &Connection, table: &str) -> Result<(), SyncError> {
    let (_, _, tech_fields) = inspect_table_columns(conn, table)?;

    if !tech_fields.iter().any(|c| c == "pb_id") {
        let sql = format!("ALTER TABLE {} ADD COLUMN pb_id TEXT", table);
        let _ = conn.execute(&sql, []);
    }
    if !tech_fields.iter().any(|c| c == "pb_is_dirty") {
        let sql = format!(
            "ALTER TABLE {} ADD COLUMN pb_is_dirty INTEGER DEFAULT 0",
            table
        );
        let _ = conn.execute(&sql, []);
    }
    if !tech_fields.iter().any(|c| c == "pb_updated_at") {
        let sql = format!("ALTER TABLE {} ADD COLUMN pb_updated_at TEXT", table);
        let _ = conn.execute(&sql, []);
    }

    Ok(())
}

/// Crea i trigger automatici MMEX con inibizione ricorsiva quando pb_is_dirty = 2
fn create_triggers_for_table(conn: &Connection, table: &str) -> Result<(), SyncError> {
    // 1. Trigger INSERT
    let trg_insert = format!(
        r#"
        CREATE TRIGGER IF NOT EXISTS TRG_{table}_INSERT
        AFTER INSERT ON {table}
        FOR EACH ROW WHEN NEW.pb_is_dirty IS NOT 2
        BEGIN
            UPDATE {table} SET pb_is_dirty = 1,
                   pb_updated_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'NOW')
                   WHERE ROWID = NEW.ROWID;
        END;
        "#
    );
    conn.execute(&trg_insert, [])?;

    // 2. Trigger UPDATE sulle colonne di dominio (non tecniche)
    let (_, fields, _) = inspect_table_columns(conn, table)?;
    if !fields.is_empty() {
        let non_tech_cols = fields.join(", ");
        let trg_update = format!(
            r#"
            CREATE TRIGGER IF NOT EXISTS TRG_{table}_UPDATE
            AFTER UPDATE OF {non_tech_cols} ON {table}
            WHEN (NEW.pb_is_dirty != 2)
            BEGIN
                UPDATE {table} SET pb_is_dirty = 1,
                       pb_updated_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'NOW')
                       WHERE ROWID = NEW.ROWID;
            END;
            "#
        );
        conn.execute(&trg_update, [])?;
    }

    // 3. Trigger DELETE (registra cancellazioni per i record già sincronizzati)
    let trg_delete = format!(
        r#"
        CREATE TRIGGER IF NOT EXISTS TRG_{table}_DELETE
        BEFORE DELETE ON {table}
        FOR EACH ROW
        WHEN OLD.pb_id IS NOT NULL
        BEGIN
            INSERT OR REPLACE INTO pb_DELETED_RECORDS_LOG (table_name, pb_id) VALUES ('{table}', OLD.pb_id);
        END;
        "#
    );
    conn.execute(&trg_delete, [])?;

    Ok(())
}

/// Rimuove trigger, colonne e tabelle tecniche per riportare il database MMEX allo stato nativo pulito
pub fn clear_technical_schema(conn: &mut Connection) -> Result<(), SyncError> {
    let tx = conn.transaction()?;

    for table in SYNC_ORDER {
        // 1. Rimozione trigger
        let _ = tx.execute(&format!("DROP TRIGGER IF EXISTS TRG_{}_INSERT", table), []);
        let _ = tx.execute(&format!("DROP TRIGGER IF EXISTS TRG_{}_UPDATE", table), []);
        let _ = tx.execute(&format!("DROP TRIGGER IF EXISTS TRG_{}_DELETE", table), []);

        // 2. Rimozione colonne tecniche
        let _ = tx.execute(&format!("ALTER TABLE {} DROP COLUMN pb_id", table), []);
        let _ = tx.execute(&format!("ALTER TABLE {} DROP COLUMN pb_is_dirty", table), []);
        let _ = tx.execute(&format!("ALTER TABLE {} DROP COLUMN pb_updated_at", table), []);
    }

    // 3. Rimozione tabelle tecniche
    let _ = tx.execute("DROP TABLE IF EXISTS pb_DELETED_RECORDS_LOG", []);
    let _ = tx.execute("DROP TABLE IF EXISTS pb_sync_info", []);

    tx.commit()?;
    Ok(())
}

/// Inizializza un database SQLite vuoto a partire dallo schema DDL di Money Manager Ex
pub fn create_empty_database(conn: &Connection, custom_sql: Option<&str>) -> Result<(), SyncError> {
    let schema = custom_sql.unwrap_or(DEFAULT_SCHEMA_SQL);
    conn.execute_batch(schema)?;
    conn.execute("PRAGMA user_version = 21", [])?;
    Ok(())
}
