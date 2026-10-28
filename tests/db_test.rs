use mmex_sync::db::DatabaseService;
use mmex_sync::domain::model::RemoteRecord;
use std::fs;
use std::path::Path;
use tempfile::tempdir;

#[test]
fn test_database_service_on_real_mmb() {
    let dir = tempdir().expect("tempdir");
    let test_mmb = dir.path().join("test_copy.mmb");

    // Copia il database reale test1.mmb per il test isolato
    let fixture_path = Path::new("test1.mmb");
    assert!(fixture_path.exists(), "test1.mmb deve esistere in root");
    fs::copy(fixture_path, &test_mmb).expect("copy test1.mmb");

    // 1. Connessione al database
    let mut db = DatabaseService::connect(&test_mmb, false, None, false).expect("connect");

    // 2. Inizializzazione dello schema di sync (trigger e colonne pb_*)
    db.init_schema().expect("init_schema");

    // Inseriamo un conto di test per verificare i trigger e il tracking dello stato
    db.raw_conn().execute(
        "INSERT INTO ACCOUNTLIST_V1 (ACCOUNTNAME, ACCOUNTTYPE, STATUS, FAVORITEACCT, CURRENCYID) VALUES ('Conto Corrente Test', 'Checking', 'Open', 'TRUE', 1)",
        [],
    ).expect("insert test account");

    let dirty_accounts = db
        .get_dirty_records("ACCOUNTLIST_V1", false)
        .expect("get_dirty");
    assert!(
        !dirty_accounts.is_empty(),
        "Il record appena inserito deve avere pb_is_dirty = 1"
    );

    // 4. Test marcatura synced
    let first_row = &dirty_accounts[0];
    db.set_synced_status("ACCOUNTLIST_V1", first_row.rowid, "pb_acc_001")
        .expect("set_synced_status");

    // 5. Test verifica marcatura
    let dirty_after_sync = db
        .get_dirty_records("ACCOUNTLIST_V1", false)
        .expect("get_dirty 2");
    assert_eq!(dirty_after_sync.len(), dirty_accounts.len() - 1);

    // 6. Test trigger DELETE su record sincronizzato (con pb_id)
    db.remove_record("ACCOUNTLIST_V1", first_row.rowid)
        .expect("remove_record");

    let deleted_log = db.get_deleted_log().expect("get_deleted_log");
    assert!(
        deleted_log
            .iter()
            .any(|e| e.table_name == "ACCOUNTLIST_V1" && e.pb_id == "pb_acc_001"),
        "La cancellazione di un record con pb_id deve essere registrata nel log"
    );

    // 7. Test pulizia dello schema tecnico
    db.clear_technical().expect("clear_technical");
}

#[test]
fn test_bidirectional_unique_conflict_and_fk_cascade() {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("cascade_test.mmb");

    // 1. Crea database vuoto da schema
    let mut db = DatabaseService::connect(&db_path, false, None, true).expect("connect create");
    db.init_schema().expect("init_schema");

    // 2. Inseriamo una valuta di default necessaria per ACCOUNTLIST
    let mut remote_curr = RemoteRecord {
        id: "curr_eur".to_string(),
        is_deleted: false,
        updated_at: None,
        fields: std::collections::HashMap::new(),
    };
    remote_curr
        .fields
        .insert("CURRENCYID".to_string(), serde_json::json!(1));
    remote_curr
        .fields
        .insert("CURRENCYNAME".to_string(), serde_json::json!("Euro"));
    remote_curr
        .fields
        .insert("CURRENCY_SYMBOL".to_string(), serde_json::json!("€"));
    remote_curr
        .fields
        .insert("CURRENCY_TYPE".to_string(), serde_json::json!("Fiat"));
    remote_curr
        .fields
        .insert("SCALE".to_string(), serde_json::json!(100));
    remote_curr
        .fields
        .insert("BASECONVRATE".to_string(), serde_json::json!(1.0));
    db.apply_remote_changes("CURRENCYFORMATS_V1", &remote_curr)
        .expect("apply curr");

    // 3. Creiamo un conto locale con ACCOUNTID = 100 e ACCOUNTNAME = "Banca Intesa"
    let mut local_acc = RemoteRecord {
        id: "pb_old_intesa".to_string(),
        is_deleted: false,
        updated_at: None,
        fields: std::collections::HashMap::new(),
    };
    local_acc
        .fields
        .insert("ACCOUNTID".to_string(), serde_json::json!(100));
    local_acc
        .fields
        .insert("ACCOUNTNAME".to_string(), serde_json::json!("Banca Intesa"));
    local_acc
        .fields
        .insert("ACCOUNTTYPE".to_string(), serde_json::json!("Checking"));
    local_acc
        .fields
        .insert("STATUS".to_string(), serde_json::json!("Open"));
    local_acc
        .fields
        .insert("FAVORITEACCT".to_string(), serde_json::json!("TRUE"));
    local_acc
        .fields
        .insert("CURRENCYID".to_string(), serde_json::json!(1));
    db.apply_remote_changes("ACCOUNTLIST_V1", &local_acc)
        .expect("insert local acc");

    // 4. Inseriamo una transazione locale collegata ad ACCOUNTID = 100
    let mut trans = RemoteRecord {
        id: "trans_001".to_string(),
        is_deleted: false,
        updated_at: None,
        fields: std::collections::HashMap::new(),
    };
    trans
        .fields
        .insert("TRANSID".to_string(), serde_json::json!(1));
    trans
        .fields
        .insert("ACCOUNTID".to_string(), serde_json::json!(100));
    trans
        .fields
        .insert("PAYEEID".to_string(), serde_json::json!(1));
    trans
        .fields
        .insert("TRANSCODE".to_string(), serde_json::json!("Withdrawal"));
    trans
        .fields
        .insert("TRANSAMOUNT".to_string(), serde_json::json!(50.0));
    trans
        .fields
        .insert("STATUS".to_string(), serde_json::json!("Reconciled"));
    trans
        .fields
        .insert("TRANSDATE".to_string(), serde_json::json!("2026-10-27"));
    db.apply_remote_changes("CHECKINGACCOUNT_V1", &trans)
        .expect("insert trans");

    // 5. Ora simuliamo l'arrivo dal server (PULL) dello stesso conto ("Banca Intesa")
    // con un ACCOUNTID diverso (es. 250) e pb_id "pb_server_intesa".
    let mut server_acc = RemoteRecord {
        id: "pb_server_intesa".to_string(),
        is_deleted: false,
        updated_at: Some("2026-10-27T22:00:00Z".to_string()),
        fields: std::collections::HashMap::new(),
    };
    server_acc
        .fields
        .insert("ACCOUNTID".to_string(), serde_json::json!(250));
    server_acc
        .fields
        .insert("ACCOUNTNAME".to_string(), serde_json::json!("Banca Intesa"));
    server_acc
        .fields
        .insert("ACCOUNTTYPE".to_string(), serde_json::json!("Checking"));
    server_acc
        .fields
        .insert("STATUS".to_string(), serde_json::json!("Open"));
    server_acc
        .fields
        .insert("FAVORITEACCT".to_string(), serde_json::json!("TRUE"));
    server_acc
        .fields
        .insert("CURRENCYID".to_string(), serde_json::json!(1));

    // L'inserimento diretto genererebbe un errore di chiave univoca su ACCOUNTNAME.
    // apply_remote_changes deve intercettarlo, sostituire il record e propagare la FK!
    db.apply_remote_changes("ACCOUNTLIST_V1", &server_acc)
        .expect("apply with conflict resolution");

    // 6. Verifica che nella tabella collegata CHECKINGACCOUNT_V1 l'ACCOUNTID sia stato
    // aggiornato automaticamente da 100 a 250 tramite FK_MAP!
    let checking_records = db
        .get_dirty_records("CHECKINGACCOUNT_V1", true)
        .expect("get checking");
    assert_eq!(checking_records.len(), 1);
    let linked_account_id = checking_records[0]
        .fields
        .get("ACCOUNTID")
        .and_then(|v| v.as_i64());
    assert_eq!(
        linked_account_id,
        Some(250),
        "L'ACCOUNTID nella transazione deve essere stato propagato a 250 tramite FK_MAP"
    );
}

#[test]
fn test_database_service_with_encrypted_emb() {
    let dir = tempdir().expect("tempdir");
    let emb_path = dir.path().join("secure_vault.emb");
    let password = "SuperSecretDbPassword!";

    // 1. Crea database cifrato .emb da zero
    {
        let mut db = DatabaseService::connect(&emb_path, false, Some(password), true)
            .expect("connect emb create");
        db.init_schema().expect("init schema emb");

        // Inserisci categoria
        let mut cat = RemoteRecord {
            id: "cat_001".to_string(),
            is_deleted: false,
            updated_at: None,
            fields: std::collections::HashMap::new(),
        };
        cat.fields
            .insert("CATEGID".to_string(), serde_json::json!(10));
        cat.fields
            .insert("CATEGNAME".to_string(), serde_json::json!("Stipendio"));
        cat.fields
            .insert("ACTIVE".to_string(), serde_json::json!(1));
        cat.fields
            .insert("PARENTID".to_string(), serde_json::json!(-1));

        db.apply_remote_changes("CATEGORY_V1", &cat)
            .expect("apply cat");
        db.flush().expect("flush to emb");
    }

    assert!(emb_path.exists());

    // 2. Riapri con password corretta
    {
        let db = DatabaseService::connect(&emb_path, false, Some(password), false)
            .expect("connect reopen");
        let categories = db
            .get_dirty_records("CATEGORY_V1", true)
            .expect("get categories");
        assert_eq!(categories.len(), 1);
        assert_eq!(
            categories[0]
                .fields
                .get("CATEGNAME")
                .and_then(|v| v.as_str()),
            Some("Stipendio")
        );
    }

    // 3. Tentativo di riapertura con password errata: deve fallire!
    {
        let wrong_open = DatabaseService::connect(&emb_path, false, Some("WrongPassword!"), false);
        assert!(
            wrong_open.is_err(),
            "L'apertura con password errata deve fallire"
        );
    }
}

#[test]
fn test_apply_remote_delete_bypasses_delete_trigger() {
    let dir = tempdir().expect("tempdir");
    let db_path = dir.path().join("remote_del_trigger_test.mmb");

    let mut db = DatabaseService::connect(&db_path, false, None, true).expect("connect create");
    db.init_schema().expect("init_schema");

    // 1. Inserisce un tag proveniente dal remoto (o sincronizzato)
    let mut remote_tag = RemoteRecord {
        id: "pb_tag_remote_1".to_string(),
        is_deleted: false,
        updated_at: Some("2026-10-28T10:00:00Z".to_string()),
        fields: std::collections::HashMap::new(),
    };
    remote_tag
        .fields
        .insert("TAGID".to_string(), serde_json::json!(1));
    remote_tag
        .fields
        .insert("TAGNAME".to_string(), serde_json::json!("Vacanze"));
    remote_tag
        .fields
        .insert("ACTIVE".to_string(), serde_json::json!(1));

    db.apply_remote_changes("TAG_V1", &remote_tag)
        .expect("insert remote tag");

    // Verifica che il tag esista localmente
    let all_tags = db.get_dirty_records("TAG_V1", true).expect("get all tags");
    assert_eq!(all_tags.len(), 1);
    assert_eq!(all_tags[0].pb_id.as_deref(), Some("pb_tag_remote_1"));

    // 2. Simula la ricezione in PULL di una cancellazione remota (is_deleted = true)
    let deleted_remote_tag = RemoteRecord {
        id: "pb_tag_remote_1".to_string(),
        is_deleted: true,
        updated_at: Some("2026-10-28T11:00:00Z".to_string()),
        fields: std::collections::HashMap::new(),
    };
    db.apply_remote_changes("TAG_V1", &deleted_remote_tag)
        .expect("apply remote delete");

    // 3. Il record locale deve essere stato rimosso
    let remaining_tags = db
        .get_dirty_records("TAG_V1", true)
        .expect("get remaining tags");
    assert!(
        remaining_tags.is_empty(),
        "Il record locale deve essere stato eliminato dal PULL"
    );

    // 4. CR-002: TRG_TAG_V1_DELETE NON deve aver inserito il record in pb_DELETED_RECORDS_LOG
    let deleted_log = db.get_deleted_log().expect("get_deleted_log");
    assert!(
        deleted_log.is_empty(),
        "L'eliminazione innescata da PULL non deve scrivere in pb_DELETED_RECORDS_LOG"
    );
}

#[test]
fn test_create_flag_recreates_existing_mmb_and_flushes_emb_immediately() {
    let dir = tempdir().expect("tempdir");

    // 1. Verifica che create = true su un file .mmb già esistente lo ricrei vuoto da zero
    let mmb_path = dir.path().join("recreate_test.mmb");
    {
        let mut db = DatabaseService::connect(&mmb_path, false, None, true).expect("create 1");
        db.init_schema().expect("init_schema 1");
        db.raw_conn()
            .execute(
                "INSERT INTO TAG_V1 (TAGNAME, ACTIVE) VALUES ('VecchioTag', 1)",
                [],
            )
            .expect("insert old tag");
    }
    {
        let mut db = DatabaseService::connect(&mmb_path, false, None, true).expect("recreate 2");
        db.init_schema().expect("init_schema 2");
        let tags = db
            .get_dirty_records("TAG_V1", true)
            .expect("get tags after recreate");
        assert!(
            tags.is_empty(),
            "create = true deve ricreare da zero il file .mmb rimuovendo i dati preesistenti"
        );
    }

    // 2. Verifica che create = true su un file .emb cifrato scriva subito il file .emb su disco
    let emb_path = dir.path().join("immediate_create.emb");
    let pwd = "ImmediateCreatePwd!";
    {
        let _db = DatabaseService::connect(&emb_path, false, Some(pwd), true)
            .expect("create emb with immediate flush");
        assert!(
            emb_path.exists(),
            "Il file .emb deve essere immediatamente persistito su disco da connect(..., true)"
        );
    }
    // Riapertura senza ulteriore flush per verificare che il file .emb su disco sia valido e decifrabile
    {
        let _reopened = DatabaseService::connect(&emb_path, false, Some(pwd), false)
            .expect("reopen created emb");
    }
}
