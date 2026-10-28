#![allow(dead_code)]

use std::collections::HashMap;
use async_trait::async_trait;
use base64::prelude::*;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use tracing::{debug, info};

use crate::domain::model::RemoteRecord;
use crate::domain::sync_order::get_table_config;
use crate::error::SyncError;
use crate::remoteserver::{AuthResponse, RemoteServer};

/// Pagina di risultati restituita dall'API REST di PocketBase
#[derive(Debug, Deserialize)]
struct PocketBaseListResponse {
    page: u64,
    #[serde(rename = "perPage")]
    per_page: u64,
    #[serde(rename = "totalItems")]
    total_items: u64,
    #[serde(rename = "totalPages")]
    total_pages: u64,
    items: Vec<serde_json::Value>,
}

/// Risposta di autenticazione di PocketBase
#[derive(Debug, Deserialize)]
struct PbAuthPayload {
    token: String,
    record: Option<PbRecordSummary>,
}

#[derive(Debug, Deserialize)]
struct PbRecordSummary {
    id: String,
}

/// Client concreto per PocketBase conforme al trait agnostico RemoteServer
pub struct PocketBaseClient {
    client: Client,
    base_url: String,
    token: Option<String>,
    auth_collection: Option<String>,
}

impl PocketBaseClient {
    pub fn new(url: &str) -> Result<Self, SyncError> {
        let trimmed_url = url.trim_end_matches('/').to_string();
        let client = Client::builder()
            .build()
            .map_err(SyncError::Network)?;

        Ok(Self {
            client,
            base_url: trimmed_url,
            token: None,
            auth_collection: None,
        })
    }

    /// Costruisce gli header per le richieste HTTP autenticate
    fn auth_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Some(token) = &self.token {
            if let Ok(val) = HeaderValue::from_str(token) {
                headers.insert(AUTHORIZATION, val);
            }
        }
        headers
    }

    /// Mappa un record JSON PocketBase nella struttura di dominio agnostica RemoteRecord
    fn parse_pb_record(val: serde_json::Value) -> Option<RemoteRecord> {
        let obj = val.as_object()?;
        let id = obj.get("id")?.as_str()?.to_string();

        let is_deleted = obj
            .get("_is_deleted")
            .map(|v| match v {
                serde_json::Value::Bool(b) => *b,
                serde_json::Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
                _ => false,
            })
            .unwrap_or(false);

        let updated_at = obj
            .get("_updated_at")
            .or_else(|| obj.get("updated"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let mut fields = HashMap::new();
        for (k, v) in obj {
            if !matches!(k.as_str(), "id" | "collectionId" | "collectionName" | "created" | "updated" | "_is_deleted" | "_updated_at") {
                fields.insert(k.clone(), v.clone());
            }
        }

        Some(RemoteRecord {
            id,
            is_deleted,
            updated_at,
            fields,
        })
    }

    /// Tenta l'autenticazione su una specifica collezione PocketBase
    async fn try_auth(
        &self,
        collection: &str,
        user: &str,
        pass: &str,
    ) -> Result<AuthResponse, SyncError> {
        let url = format!("{}/api/collections/{}/auth-with-password", self.base_url, collection);
        let body = serde_json::json!({
            "identity": user,
            "password": pass
        });

        let res = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await?;

        let status = res.status();
        if !status.is_success() {
            let error_text = res.text().await.unwrap_or_default();
            return Err(SyncError::RemoteApi {
                status: status.as_u16(),
                message: format!("Autenticazione su '{}' fallita: {}", collection, error_text),
            });
        }

        let auth_data: PbAuthPayload = res.json().await?;
        Ok(AuthResponse {
            token: auth_data.token,
            collection: collection.to_string(),
            user_id: auth_data.record.map(|r| r.id),
        })
    }
}

#[async_trait]
impl RemoteServer for PocketBaseClient {
    async fn authenticate(&mut self, user: &str, pass: &str) -> Result<AuthResponse, SyncError> {
        // Tentativo 1: collezione 'users'
        match self.try_auth("users", user, pass).await {
            Ok(auth) => {
                self.token = Some(auth.token.clone());
                self.auth_collection = Some("users".to_string());
                return Ok(auth);
            }
            Err(e) => {
                debug!("Autenticazione su 'users' fallita, tentativo fallback su '_superusers': {}", e);
            }
        }

        // Tentativo 2: collezione fallback '_superusers'
        let auth = self.try_auth("_superusers", user, pass).await.map_err(|e| {
            SyncError::RemoteAuth(crate::i18n::t_fmt(
                "remote.auth_failed_user",
                &[("user", user), ("error", &e.to_string())],
            ))
        })?;

        self.token = Some(auth.token.clone());
        self.auth_collection = Some("_superusers".to_string());
        Ok(auth)
    }

    async fn refresh_token(&mut self) -> Result<AuthResponse, SyncError> {
        let collection = self
            .auth_collection
            .as_deref()
            .unwrap_or("users");

        let url = format!("{}/api/collections/{}/auth-refresh", self.base_url, collection);
        let res = self
            .client
            .post(&url)
            .headers(self.auth_headers())
            .send()
            .await?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let msg = res.text().await.unwrap_or_default();
            return Err(SyncError::RemoteApi {
                status,
                message: format!("Refresh token fallito: {}", msg),
            });
        }

        let auth_data: PbAuthPayload = res.json().await?;
        self.token = Some(auth_data.token.clone());

        Ok(AuthResponse {
            token: auth_data.token,
            collection: collection.to_string(),
            user_id: auth_data.record.map(|r| r.id),
        })
    }

    fn is_token_valid(&self) -> bool {
        let token = match &self.token {
            Some(t) if !t.trim().is_empty() => t,
            _ => return false,
        };

        // Decodifica la parte payload del JWT per verificare la scadenza 'exp'
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() >= 2 {
            if let Ok(decoded_bytes) = BASE64_URL_SAFE_NO_PAD.decode(parts[1]) {
                if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&decoded_bytes) {
                    if let Some(exp) = val.get("exp").and_then(|e| e.as_i64()) {
                        let now = chrono::Utc::now().timestamp();
                        return exp > now;
                    }
                }
            }
        }

        true
    }

    fn get_token(&self) -> Option<String> {
        self.token.clone()
    }

    fn set_token(&mut self, token: String, auth_collection: Option<String>) {
        self.token = Some(token);
        if let Some(col) = auth_collection {
            self.auth_collection = Some(col);
        }
    }

    fn invalidate_token(&mut self) {
        self.token = None;
    }

    fn get_auth_collection(&self) -> Option<String> {
        self.auth_collection.clone()
    }

    async fn get_full_list(
        &self,
        collection: &str,
        filter: Option<&str>,
    ) -> Result<Vec<RemoteRecord>, SyncError> {
        let mut results = Vec::new();
        let mut page = 1u64;
        let per_page = 500u64;

        loop {
            let mut url = format!(
                "{}/api/collections/{}/records?page={}&perPage={}&sort=_updated_at",
                self.base_url, collection, page, per_page
            );

            if let Some(f) = filter {
                url.push_str(&format!("&filter={}", urlencoding_simple(f)));
            }

            let res = self
                .client
                .get(&url)
                .headers(self.auth_headers())
                .send()
                .await?;

            if !res.status().is_success() {
                let status = res.status().as_u16();
                let msg = res.text().await.unwrap_or_default();
                return Err(SyncError::RemoteApi {
                    status,
                    message: format!("get_full_list su '{}' fallita: {}", collection, msg),
                });
            }

            let list_data: PocketBaseListResponse = res.json().await?;
            let items_count = list_data.items.len();

            for item in list_data.items {
                if let Some(rec) = Self::parse_pb_record(item) {
                    results.push(rec);
                }
            }

            if page >= list_data.total_pages || items_count == 0 {
                break;
            }
            page += 1;
        }

        Ok(results)
    }

    async fn get_by_row_id(
        &self,
        collection: &str,
        row_id: i64,
    ) -> Result<Option<RemoteRecord>, SyncError> {
        let table_cfg = match get_table_config(collection) {
            Some(c) => c,
            None => return Ok(None),
        };

        let filter = format!("{} = \"{}\"", table_cfg.pk, row_id);
        let url = format!(
            "{}/api/collections/{}/records?page=1&perPage=1&filter={}",
            self.base_url,
            collection,
            urlencoding_simple(&filter)
        );

        let res = self
            .client
            .get(&url)
            .headers(self.auth_headers())
            .send()
            .await?;

        if !res.status().is_success() {
            return Ok(None);
        }

        let list_data: PocketBaseListResponse = res.json().await?;
        if let Some(first_item) = list_data.items.into_iter().next() {
            Ok(Self::parse_pb_record(first_item))
        } else {
            Ok(None)
        }
    }

    async fn get_by_unique_keys(
        &self,
        collection: &str,
        keys: &[(&str, &str)],
    ) -> Result<Option<RemoteRecord>, SyncError> {
        if keys.is_empty() {
            return Ok(None);
        }

        let mut parts = Vec::new();
        for (k, v) in keys {
            let escaped_v = v.replace('"', "\\\"");
            parts.push(format!("{} = \"{}\"", k, escaped_v));
        }
        parts.push("_is_deleted = 0".to_string());
        let filter = parts.join(" && ");

        let url = format!(
            "{}/api/collections/{}/records?page=1&perPage=1&filter={}",
            self.base_url,
            collection,
            urlencoding_simple(&filter)
        );

        let res = self
            .client
            .get(&url)
            .headers(self.auth_headers())
            .send()
            .await?;

        if !res.status().is_success() {
            return Ok(None);
        }

        let list_data: PocketBaseListResponse = res.json().await?;
        if let Some(first_item) = list_data.items.into_iter().next() {
            Ok(Self::parse_pb_record(first_item))
        } else {
            Ok(None)
        }
    }

    async fn get_by_id(&self, collection: &str, id: &str) -> Result<Option<RemoteRecord>, SyncError> {
        let url = format!("{}/api/collections/{}/records/{}", self.base_url, collection, id);
        let res = self
            .client
            .get(&url)
            .headers(self.auth_headers())
            .send()
            .await?;

        if res.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let msg = res.text().await.unwrap_or_default();
            return Err(SyncError::RemoteApi {
                status,
                message: format!("get_by_id su '{}/{}' fallito: {}", collection, id, msg),
            });
        }

        let val: serde_json::Value = res.json().await?;
        Ok(Self::parse_pb_record(val))
    }

    async fn create(
        &self,
        collection: &str,
        data: &HashMap<String, serde_json::Value>,
    ) -> Result<RemoteRecord, SyncError> {
        let url = format!("{}/api/collections/{}/records", self.base_url, collection);
        let res = self
            .client
            .post(&url)
            .headers(self.auth_headers())
            .json(data)
            .send()
            .await?;

        let status = res.status();
        if status == StatusCode::BAD_REQUEST {
            let err_json: serde_json::Value = res.json().await.unwrap_or_default();
            if is_validation_not_unique(&err_json) {
                return Err(SyncError::UniqueConstraintViolation {
                    table: collection.to_string(),
                    details: err_json.to_string(),
                });
            }
            return Err(SyncError::RemoteApi {
                status: 400,
                message: format!("create su '{}' fallita per validazione: {}", collection, err_json),
            });
        }

        if !status.is_success() {
            let err_msg = res.text().await.unwrap_or_default();
            return Err(SyncError::RemoteApi {
                status: status.as_u16(),
                message: format!("create su '{}' fallita: {}", collection, err_msg),
            });
        }

        let val: serde_json::Value = res.json().await?;
        Self::parse_pb_record(val).ok_or_else(|| {
            SyncError::RemoteApi {
                status: 200,
                message: "Record creato ma formato non valido da PocketBase".to_string(),
            }
        })
    }

    async fn update(
        &self,
        collection: &str,
        id: &str,
        data: &HashMap<String, serde_json::Value>,
    ) -> Result<RemoteRecord, SyncError> {
        let url = format!("{}/api/collections/{}/records/{}", self.base_url, collection, id);
        let res = self
            .client
            .patch(&url)
            .headers(self.auth_headers())
            .json(data)
            .send()
            .await?;

        let status = res.status();
        if status == StatusCode::NOT_FOUND {
            return Err(SyncError::NotFound(crate::i18n::t_fmt(
                "remote.record_not_found",
                &[("table", collection), ("id", id)],
            )));
        }

        if status == StatusCode::CONFLICT {
            return Err(SyncError::Conflict(crate::i18n::t_fmt(
                "remote.conflict_detected",
                &[("table", collection), ("id", id)],
            )));
        }

        if status == StatusCode::BAD_REQUEST {
            let err_json: serde_json::Value = res.json().await.unwrap_or_default();
            if is_validation_not_unique(&err_json) {
                return Err(SyncError::UniqueConstraintViolation {
                    table: collection.to_string(),
                    details: err_json.to_string(),
                });
            }
            return Err(SyncError::RemoteApi {
                status: 400,
                message: format!("update su '{}/{}' fallita: {}", collection, id, err_json),
            });
        }

        if !status.is_success() {
            let err_msg = res.text().await.unwrap_or_default();
            return Err(SyncError::RemoteApi {
                status: status.as_u16(),
                message: format!("update su '{}/{}' fallita: {}", collection, id, err_msg),
            });
        }

        let val: serde_json::Value = res.json().await?;
        Self::parse_pb_record(val).ok_or_else(|| {
            SyncError::RemoteApi {
                status: 200,
                message: "Record aggiornato ma formato non valido da PocketBase".to_string(),
            }
        })
    }

    async fn delete(&self, collection: &str, id: &str) -> Result<(), SyncError> {
        let url = format!("{}/api/collections/{}/records/{}", self.base_url, collection, id);
        let res = self
            .client
            .delete(&url)
            .headers(self.auth_headers())
            .send()
            .await?;

        if res.status() == StatusCode::NOT_FOUND {
            return Ok(());
        }

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let msg = res.text().await.unwrap_or_default();
            return Err(SyncError::RemoteApi {
                status,
                message: format!("delete su '{}/{}' fallita: {}", collection, id, msg),
            });
        }

        Ok(())
    }

    async fn clear_remote_server(&self, sync_order: &[&str]) -> Result<(), SyncError> {
        info!("{}", crate::i18n::t("remote.cleaning_server_start"));
        let mut reverse_order = sync_order.to_vec();
        reverse_order.reverse();

        for table in reverse_order {
            match self.get_full_list(table, None).await {
                Ok(records) => {
                    if !records.is_empty() {
                        info!("{}", crate::i18n::t_fmt("remote.cleaning_table", &[("table", table), ("count", &records.len().to_string())]));
                        for r in records {
                            let _ = self.delete(table, &r.id).await;
                        }
                    }
                }
                Err(err) => {
                    debug!("Tabella remota '{}' non trovata o saltata: {}", table, err);
                }
            }
        }

        info!("{}", crate::i18n::t("remote.cleaning_server_done"));
        Ok(())
    }
}

/// Controlla se la risposta JSON di errore di PocketBase indica una violazione di unicità
fn is_validation_not_unique(val: &serde_json::Value) -> bool {
    if let Some(data) = val.get("data").and_then(|d| d.as_object()) {
        for field_err in data.values() {
            if let Some(code) = field_err.get("code").and_then(|c| c.as_str()) {
                if code == "validation_not_unique" {
                    return true;
                }
            }
        }
    }
    false
}

/// Semplice helper di URL-encoding per filtri di ricerca
fn urlencoding_simple(s: &str) -> String {
    let mut encoded = String::new();
    for b in s.bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(b as char);
            }
            b' ' => encoded.push_str("%20"),
            _ => {
                encoded.push_str(&format!("%{:02X}", b));
            }
        }
    }
    encoded
}
