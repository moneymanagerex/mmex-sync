use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Stato di sincronizzazione della colonna pb_is_dirty
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncStatus {
    /// 0 = Sincronizzato con il server
    Synced = 0,
    /// 1 = Modificato localmente, da inviare in PUSH
    Dirty = 1,
    /// 2 = In transito / applicazione da remoto (inibisce i trigger)
    Pending = 2,
}

impl From<i64> for SyncStatus {
    fn from(val: i64) -> Self {
        match val {
            0 => SyncStatus::Synced,
            1 => SyncStatus::Dirty,
            2 => SyncStatus::Pending,
            _ => SyncStatus::Dirty,
        }
    }
}

/// Rappresentazione tipizzata dei valori di un record locale
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RecordValue {
    Null,
    Integer(i64),
    Real(f64),
    Text(String),
    Blob(Vec<u8>),
}

impl RecordValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            RecordValue::Text(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            RecordValue::Integer(i) => Some(*i),
            _ => None,
        }
    }
}

/// Rappresentazione agnostica di un record presente nel database locale MMEX
#[derive(Debug, Clone)]
pub struct LocalRecord {
    pub rowid: i64,
    pub pb_id: Option<String>,
    pub pb_is_dirty: SyncStatus,
    pub pb_updated_at: Option<String>,
    pub fields: HashMap<String, RecordValue>,
}

/// Rappresentazione agnostica di un record ricevuto dal backend remoto
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteRecord {
    pub id: String,
    #[serde(default)]
    pub is_deleted: bool,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(flatten)]
    pub fields: HashMap<String, serde_json::Value>,
}

/// Voce del log delle cancellazioni locali (pb_DELETED_RECORDS_LOG)
#[derive(Debug, Clone)]
pub struct DeletedRecordEntry {
    pub table_name: String,
    pub pb_id: String,
    pub deleted_at: Option<String>,
}

/// Schema strutturale di una tabella MMEX rilevato a runtime
#[derive(Debug, Clone)]
pub struct TableSchemaInfo {
    pub pk: String,
    pub fields: Vec<String>,
    pub tech_fields: Vec<String>,
}
