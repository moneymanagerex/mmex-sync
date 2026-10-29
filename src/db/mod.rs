#![allow(dead_code, unused_imports)]

//! Repository e accesso dati SQLite nativo per Money Manager Ex

pub mod repository;
pub mod schema;

pub use repository::DatabaseService;
pub use schema::{clear_technical_schema, create_empty_database, init_sync_schema};
