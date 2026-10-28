#![allow(dead_code)]

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::domain::model::RemoteRecord;
use crate::error::SyncError;

pub mod pocketbase;

pub use pocketbase::PocketBaseClient;

/// Risposta restituita dalle operazioni di autenticazione e refresh
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub collection: String,
    pub user_id: Option<String>,
}

/// Port Esagonale agnostico per qualsiasi backend cloud remoto
/// (PocketBase, Supabase, Firebase, ecc.)
#[async_trait]
pub trait RemoteServer: Send + Sync {
    /// Autentica con credenziali utente (identità/email e password)
    async fn authenticate(&mut self, user: &str, pass: &str) -> Result<AuthResponse, SyncError>;

    /// Rinnova il token di autenticazione attivo
    async fn refresh_token(&mut self) -> Result<AuthResponse, SyncError>;

    /// Verifica se il token attualmente memorizzato è valido
    fn is_token_valid(&self) -> bool;

    /// Restituisce il token corrente se presente
    fn get_token(&self) -> Option<String>;

    /// Imposta il token e opzionalmente la collezione di autenticazione
    fn set_token(&mut self, token: String, auth_collection: Option<String>);

    /// Invalida e rimuove il token memorizzato
    fn invalidate_token(&mut self);

    /// Restituisce la collezione usata per l'autenticazione
    fn get_auth_collection(&self) -> Option<String>;

    /// Scarica tutti i record di una collezione (con paginazione automatica), opzionalmente filtrati
    async fn get_full_list(
        &self,
        collection: &str,
        filter: Option<&str>,
    ) -> Result<Vec<RemoteRecord>, SyncError>;

    /// Recupera un record remoto tramite il valore del Primary Key locale (es. ACCOUNTID)
    async fn get_by_row_id(
        &self,
        collection: &str,
        row_id: i64,
    ) -> Result<Option<RemoteRecord>, SyncError>;

    /// Recupera un record remoto tramite una o più chiavi univoche (es. ACCOUNTNAME)
    async fn get_by_unique_keys(
        &self,
        collection: &str,
        keys: &[(&str, &str)],
    ) -> Result<Option<RemoteRecord>, SyncError>;

    /// Recupera un singolo record remoto tramite il suo id remoto univoco
    async fn get_by_id(&self, collection: &str, id: &str) -> Result<Option<RemoteRecord>, SyncError>;

    /// Crea un nuovo record sul server remoto
    async fn create(
        &self,
        collection: &str,
        data: &HashMap<String, serde_json::Value>,
    ) -> Result<RemoteRecord, SyncError>;

    /// Aggiorna un record esistente sul server remoto
    async fn update(
        &self,
        collection: &str,
        id: &str,
        data: &HashMap<String, serde_json::Value>,
    ) -> Result<RemoteRecord, SyncError>;

    /// Cancella un record sul server remoto dato il suo id
    async fn delete(&self, collection: &str, id: &str) -> Result<(), SyncError>;

    /// Cancella tutti i dati dal server remoto nell'ordine inverso rispetto a SYNC_ORDER
    async fn clear_remote_server(&self, sync_order: &[&str]) -> Result<(), SyncError>;
}

/// Factory per istanziare l'adapter concreto del provider richiesto
pub fn create_remote_server(
    server_type: &str,
    url: &str,
) -> Result<Box<dyn RemoteServer>, SyncError> {
    match server_type.to_lowercase().as_str() {
        "pocketbase" => Ok(Box::new(PocketBaseClient::new(url)?)),
        other => Err(SyncError::Config(crate::i18n::t_fmt(
            "remote.unsupported_provider",
            &[("provider", other)],
        ))),
    }
}
