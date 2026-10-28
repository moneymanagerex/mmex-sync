#![allow(dead_code)]

use std::fmt;

/// Errori tipizzati di dominio per il sistema mmex-sync con localizzazione dinamica
#[derive(Debug)]
pub enum SyncError {
    Config(String),
    Io(std::io::Error),
    Database(rusqlite::Error),
    Network(reqwest::Error),
    Json(serde_json::Error),
    Crypto(String),
    RemoteAuth(String),
    RemoteApi { status: u16, message: String },
    Conflict(String),
    UniqueConstraintViolation { table: String, details: String },
    NotFound(String),
    General(String),
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let msg = match self {
            SyncError::Config(err) => crate::i18n::t_fmt("errors.config", &[("error", err)]),
            SyncError::Io(err) => crate::i18n::t_fmt("errors.io", &[("error", &err.to_string())]),
            SyncError::Database(err) => {
                crate::i18n::t_fmt("errors.database", &[("error", &err.to_string())])
            }
            SyncError::Network(err) => {
                crate::i18n::t_fmt("errors.network", &[("error", &err.to_string())])
            }
            SyncError::Json(err) => crate::i18n::t_fmt("errors.json", &[("error", &err.to_string())]),
            SyncError::Crypto(err) => crate::i18n::t_fmt("errors.crypto", &[("error", err)]),
            SyncError::RemoteAuth(err) => {
                crate::i18n::t_fmt("errors.remote_auth", &[("error", err)])
            }
            SyncError::RemoteApi { status, message } => crate::i18n::t_fmt(
                "errors.remote_api",
                &[("status", &status.to_string()), ("message", message)],
            ),
            SyncError::Conflict(details) => {
                crate::i18n::t_fmt("errors.conflict", &[("details", details)])
            }
            SyncError::UniqueConstraintViolation { table, details } => crate::i18n::t_fmt(
                "errors.unique_constraint",
                &[("table", table), ("details", details)],
            ),
            SyncError::NotFound(details) => {
                crate::i18n::t_fmt("errors.not_found", &[("details", details)])
            }
            SyncError::General(details) => {
                crate::i18n::t_fmt("errors.general", &[("details", details)])
            }
        };
        write!(f, "{}", msg)
    }
}

impl std::error::Error for SyncError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            SyncError::Io(err) => Some(err),
            SyncError::Database(err) => Some(err),
            SyncError::Network(err) => Some(err),
            SyncError::Json(err) => Some(err),
            _ => None,
        }
    }
}

impl From<std::io::Error> for SyncError {
    fn from(err: std::io::Error) -> Self {
        SyncError::Io(err)
    }
}

impl From<rusqlite::Error> for SyncError {
    fn from(err: rusqlite::Error) -> Self {
        SyncError::Database(err)
    }
}

impl From<reqwest::Error> for SyncError {
    fn from(err: reqwest::Error) -> Self {
        SyncError::Network(err)
    }
}

impl From<serde_json::Error> for SyncError {
    fn from(err: serde_json::Error) -> Self {
        SyncError::Json(err)
    }
}
