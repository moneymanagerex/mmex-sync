#![allow(dead_code, unused_imports)]

//! Modulo crittografico per la gestione di credenziali e database cifrati .emb

pub mod credentials;
pub mod emb;

pub use credentials::{get_or_create_master_key, protect, unprotect};
pub use emb::{decrypt_sqlite_bytes, encrypt_sqlite_bytes, is_emb_path, EmbDatabaseHandler};
