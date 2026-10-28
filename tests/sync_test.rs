use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use async_trait::async_trait;
use tempfile::tempdir;

use mmex_sync::db::DatabaseService;
use mmex_sync::domain::model::RemoteRecord;
use mmex_sync::error::SyncError;
use mmex_sync::remoteserver::{AuthResponse, RemoteServer};
use mmex_sync::sync::{SyncEngine, SyncOptions};

#[derive(Default, Clone)]
struct MockRemoteState {
    records: HashMap<String, HashMap<String, RemoteRecord>>,
    create_calls: usize,
    update_calls: usize,
    delete_calls: usize,
}

struct MockRemoteServer {
    state: Arc<Mutex<MockRemoteState>>,
    token: Option<String>,
}

impl MockRemoteServer {
    fn new(state: Arc<Mutex<MockRemoteState>>) -> Self {
        Self {
            state,
            token: Some("mock_token".to_string()),
        }
    }
}

#[async_trait]
impl RemoteServer for MockRemoteServer {
    async fn authenticate(&mut self, _user: &str, _pass: &str) -> Result<AuthResponse, SyncError> {
        self.token = Some("mock_token".to_string());
        Ok(AuthResponse {
            token: "mock_token".to_string(),
            collection: "users".to_string(),
            user_id: Some("u1".to_string()),
        })
    }

    async fn refresh_token(&mut self) -> Result<AuthResponse, SyncError> {
        Ok(AuthResponse {
            token: "mock_token".to_string(),
            collection: "users".to_string(),
            user_id: Some("u1".to_string()),
        })
    }

    fn is_token_valid(&self) -> bool {
        self.token.is_some()
    }

    fn get_token(&self) -> Option<String> {
        self.token.clone()
    }

    fn set_token(&mut self, token: String, _auth_collection: Option<String>) {
        self.token = Some(token);
    }

    fn invalidate_token(&mut self) {
        self.token = None;
    }

    fn get_auth_collection(&self) -> Option<String> {
        Some("users".to_string())
    }

    async fn get_full_list(
        &self,
        collection: &str,
        _filter: Option<&str>,
    ) -> Result<Vec<RemoteRecord>, SyncError> {
        let lock = self.state.lock().unwrap();
        if let Some(col_map) = lock.records.get(collection) {
            Ok(col_map.values().cloned().collect())
        } else {
            Ok(Vec::new())
        }
    }

    async fn get_by_row_id(
        &self,
        _collection: &str,
        _row_id: i64,
    ) -> Result<Option<RemoteRecord>, SyncError> {
        Ok(None)
    }

    async fn get_by_unique_keys(
        &self,
        _collection: &str,
        _keys: &[(&str, &str)],
    ) -> Result<Option<RemoteRecord>, SyncError> {
        Ok(None)
    }

    async fn get_by_id(&self, collection: &str, id: &str) -> Result<Option<RemoteRecord>, SyncError> {
        let lock = self.state.lock().unwrap();
        if let Some(col_map) = lock.records.get(collection) {
            Ok(col_map.get(id).cloned())
        } else {
            Ok(None)
        }
    }

    async fn create(
        &self,
        collection: &str,
        data: &HashMap<String, serde_json::Value>,
    ) -> Result<RemoteRecord, SyncError> {
        let mut lock = self.state.lock().unwrap();
        lock.create_calls += 1;
        let id = format!("pb_{}_{}", collection, lock.create_calls);

        let rec = RemoteRecord {
            id: id.clone(),
            is_deleted: false,
            updated_at: Some("2026-10-27T23:00:00Z".to_string()),
            fields: data.clone(),
        };

        lock.records
            .entry(collection.to_string())
            .or_default()
            .insert(id, rec.clone());

        Ok(rec)
    }

    async fn update(
        &self,
        collection: &str,
        id: &str,
        data: &HashMap<String, serde_json::Value>,
    ) -> Result<RemoteRecord, SyncError> {
        let mut lock = self.state.lock().unwrap();
        lock.update_calls += 1;

        let rec = RemoteRecord {
            id: id.to_string(),
            is_deleted: data.get("_is_deleted").and_then(|v| v.as_bool()).unwrap_or(false),
            updated_at: Some("2026-10-27T23:00:00Z".to_string()),
            fields: data.clone(),
        };

        lock.records
            .entry(collection.to_string())
            .or_default()
            .insert(id.to_string(), rec.clone());

        Ok(rec)
    }

    async fn delete(&self, collection: &str, id: &str) -> Result<(), SyncError> {
        let mut lock = self.state.lock().unwrap();
        lock.delete_calls += 1;
        if let Some(col_map) = lock.records.get_mut(collection) {
            col_map.remove(id);
        }
        Ok(())
    }

    async fn clear_remote_server(&self, _sync_order: &[&str]) -> Result<(), SyncError> {
        let mut lock = self.state.lock().unwrap();
        lock.records.clear();
        Ok(())
    }
}

#[tokio::test]
async fn test_sync_engine_push_and_pull_cycle() {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("sync_test.mmb");

    // 1. Inizializza database locale da schema
    let mut db = DatabaseService::connect(&db_path, false, None, true).expect("connect create");
    db.init_schema().expect("init_schema");

    // Inserisce una valuta locale (risulterà dirty)
    db.raw_conn().execute(
        "INSERT INTO CURRENCYFORMATS_V1 (CURRENCYNAME, CURRENCY_SYMBOL, PFX_SYMBOL, SFX_SYMBOL, DECIMAL_POINT, GROUP_SEPARATOR, UNIT_NAME, CENT_NAME, SCALE, BASECONVRATE, CURRENCY_TYPE) VALUES ('Euro', '€', '€', '', '.', ',', 'Euro', 'Cent', 100, 1.0, 'Fiat')",
        [],
    ).expect("insert currency");

    // 2. Setup mock remote server
    let remote_state = Arc::new(Mutex::new(MockRemoteState::default()));
    let mut remote = MockRemoteServer::new(remote_state.clone());

    // 3. Esecuzione PUSH iniziale
    let options = SyncOptions {
        init: true,
        push: true,
        pull: true,
        force: false,
        verbose: true,
    };

    let mut engine = SyncEngine::new(&mut db, &mut remote, options.clone(), None);
    let (stats, timestamp) = engine.run_cycle().await.expect("run cycle");

    assert!(stats.pushed_records >= 1, "La valuta locale deve essere inviata in push");
    assert!(timestamp.is_some(), "Il timestamp deve essere generato al termine del ciclo");

    // Verifica che in locale la valuta abbia ora pb_is_dirty = 0
    let dirty_curr = db.get_dirty_records("CURRENCYFORMATS_V1", false).expect("get_dirty");
    assert_eq!(dirty_curr.len(), 0, "Dopo il push tutti i record devono essere synchronized (dirty=0)");

    // 4. Simuliamo l'aggiunta di una categoria sul server remoto
    {
        let mut lock = remote_state.lock().unwrap();
        let mut cat_fields = HashMap::new();
        cat_fields.insert("CATEGID".to_string(), serde_json::json!(50));
        cat_fields.insert("CATEGNAME".to_string(), serde_json::json!("Alimentari"));
        cat_fields.insert("ACTIVE".to_string(), serde_json::json!(1));
        cat_fields.insert("PARENTID".to_string(), serde_json::json!(-1));

        let rec = RemoteRecord {
            id: "pb_cat_50".to_string(),
            is_deleted: false,
            updated_at: Some("2026-10-27T23:30:00Z".to_string()),
            fields: cat_fields,
        };
        lock.records.entry("CATEGORY_V1".to_string()).or_default().insert(rec.id.clone(), rec);
    }

    // 5. Esecuzione secondo ciclo di sync (PULL)
    let mut engine2 = SyncEngine::new(&mut db, &mut remote, options, timestamp);
    let (stats2, _) = engine2.run_cycle().await.expect("run cycle 2");

    assert!(stats2.pulled_records >= 1, "La categoria remota deve essere scaricata in pull");

    // Verifica che in locale la categoria esista con pb_id corrispondente
    let categories = db.get_dirty_records("CATEGORY_V1", true).expect("get all categories");
    assert_eq!(categories.len(), 1);
    assert_eq!(categories[0].pb_id.as_deref(), Some("pb_cat_50"));
    assert_eq!(
        categories[0].fields.get("CATEGNAME").and_then(|v| v.as_str()),
        Some("Alimentari")
    );
}

#[tokio::test]
async fn test_sync_engine_soft_delete_flow() {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("delete_test.mmb");

    let mut db = DatabaseService::connect(&db_path, false, None, true).expect("connect create");
    db.init_schema().expect("init_schema");

    // Inserisce e sincronizza un tag
    db.raw_conn().execute("INSERT INTO TAG_V1 (TAGNAME, ACTIVE) VALUES ('Lavoro', 1)", []).expect("insert tag");
    let tags = db.get_dirty_records("TAG_V1", false).expect("get tag");
    let tag_rowid = tags[0].rowid;
    db.set_synced_status("TAG_V1", tag_rowid, "pb_tag_001").expect("set synced");

    // Cancella il tag in locale: scatta TRG_TAG_V1_DELETE
    db.remove_record("TAG_V1", tag_rowid).expect("remove tag");

    let deleted_log = db.get_deleted_log().expect("get log");
    assert_eq!(deleted_log.len(), 1);
    assert_eq!(deleted_log[0].pb_id, "pb_tag_001");

    let remote_state = Arc::new(Mutex::new(MockRemoteState::default()));
    let mut remote = MockRemoteServer::new(remote_state.clone());

    let options = SyncOptions {
        init: false,
        push: true,
        pull: false,
        force: false,
        verbose: true,
    };

    let mut engine = SyncEngine::new(&mut db, &mut remote, options, None);
    let (stats, _) = engine.run_cycle().await.expect("run delete sync");

    assert_eq!(stats.deleted_records, 1, "Deve aver sincronizzato 1 cancellazione");

    // Verifica che il log locale sia stato svuotato
    let deleted_log_after = db.get_deleted_log().expect("get log after");
    assert_eq!(deleted_log_after.len(), 0);

    // Verifica che sul server remoto sia stato impostato _is_deleted = true
    let lock = remote_state.lock().unwrap();
    let remote_rec = lock.records.get("TAG_V1").and_then(|m| m.get("pb_tag_001")).expect("remote tag");
    assert!(remote_rec.is_deleted, "Il record remoto deve risultare marcato come cancellato (_is_deleted=true)");
}

#[tokio::test]
async fn test_sync_engine_push_only_flushes_emb_on_disk() {
    let dir = tempdir().expect("tempdir");
    let emb_path = dir.path().join("push_only_vault.emb");
    let password = "EmbPushOnlyPassword!";

    // 1. Crea database .emb, inizializza e inserisci un record locale (dirty=1, pb_id=NULL)
    {
        let mut db = DatabaseService::connect(&emb_path, false, Some(password), true)
            .expect("connect create emb");
        db.init_schema().expect("init_schema");
        db.raw_conn()
            .execute("INSERT INTO TAG_V1 (TAGNAME, ACTIVE) VALUES ('Casa', 1)", [])
            .expect("insert local tag");
        db.flush().expect("initial flush");
    }

    // 2. Riapri il database .emb ed esegui SOLO un ciclo di PUSH (pull = false)
    let remote_state = Arc::new(Mutex::new(MockRemoteState::default()));
    let mut remote = MockRemoteServer::new(remote_state.clone());
    {
        let mut db = DatabaseService::connect(&emb_path, false, Some(password), false)
            .expect("reopen emb for push");
        let options = SyncOptions {
            init: false,
            push: true,
            pull: false,
            force: false,
            verbose: false,
        };
        let mut engine = SyncEngine::new(&mut db, &mut remote, options, None);
        let (stats, ts) = engine.run_cycle().await.expect("run push-only cycle");
        assert_eq!(stats.pushed_records, 1);
        assert!(ts.is_none(), "Push-only non deve generare timestamp di pull");
    }

    // 3. Riapri il file .emb da disco e verifica che il nuovo pb_id e pb_is_dirty=0 siano stati salvati!
    {
        let db = DatabaseService::connect(&emb_path, false, Some(password), false)
            .expect("reopen emb after push-only");
        let dirty_tags = db.get_dirty_records("TAG_V1", false).expect("get dirty tags");
        assert!(
            dirty_tags.is_empty(),
            "Il file .emb su disco deve avere pb_is_dirty = 0 dopo un ciclo push-only"
        );
        let all_tags = db.get_dirty_records("TAG_V1", true).expect("get all tags");
        assert_eq!(all_tags.len(), 1);
        assert_eq!(
            all_tags[0].pb_id.as_deref(),
            Some("pb_TAG_V1_1"),
            "Il pb_id assegnato durante il push deve essere persistito nel file .emb su disco"
        );
    }
}

