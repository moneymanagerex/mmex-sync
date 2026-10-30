# AS-IS Technical Specification: 01 — Database (`.mmb` / `.emb`) and Cryptography

> **Baseline Version:** `0.3.0` (Rust Edition 2021)  
> **Scope:** Local credential encryption (`src/crypto/credentials.rs`), `.emb` encrypted database container format (`src/crypto/emb.rs`), SQLite schema & triggers (`src/db/schema.rs`), MMEX tables/columns/FK metadata (`src/domain/sync_order.rs`), and `DatabaseService` transactional operations (`src/db/repository.rs`).

---

## 1. Local Credential Protection (`src/crypto/credentials.rs`)

Sensitive profile values (`encryptedToken` and `encryptedFilePassword` in `<profile>.mmex-sync.json`) are encrypted at rest using **AES-256-GCM**.

### Master Key Management (`get_or_create_master_key`)
- **File Location:** `<config_dir>/.key` (`~/.mmex-sync/.key` on Linux/macOS, `%APPDATA%\mmex-sync\.key` on Windows).
- **Format:** 32 raw random bytes (256 bits) generated via `rand::rngs::OsRng`.
- **Permissions:** On Unix (`#[cfg(unix)]`), created with file mode `0o600` (`rw-------`).
- **Validation:** If `.key` exists and is exactly 32 bytes long, it is reused; otherwise a new 32-byte key is generated and written.

### Payload Format (`protect` / `unprotect`)
- **Cipher:** `Aes256Gcm` (256-bit key, 96-bit / 12-byte random IV per encryption call, 128-bit / 16-byte authentication tag).
- **Serialized String Format:**
  ```text
  v1:<iv_base64>:<tag_base64>:<ciphertext_base64>
  ```
  where all three components use standard Base64 encoding (`BASE64_STANDARD`).
- **Behavior on Empty / Invalid Input:**
  - `protect("", _)` returns `Ok("")` without generating an IV.
  - `unprotect("", _)` returns `Ok(None)`.
  - If the payload does not have 4 colon-separated parts, does not start with `"v1"`, has an IV != 12 bytes, a tag != 16 bytes, or fails GCM authentication tag verification (tamper detection), `unprotect` returns `Ok(None)` without panicking.

---

## 2. Encrypted `.emb` Database Handling (`src/crypto/emb.rs`)

### Detection
- `DatabaseService::connect` treats a database as encrypted (`is_emb = true`) if:
  1. `is_emb_path(db_path)` is true (file extension is `.emb`, case-insensitive), **OR**
  2. `password.is_some()` is passed to `DatabaseService::connect`.

### Binary Container Format (`encrypt_sqlite_bytes`)
```text
+-------------------+-------------------+---------------------------------------+
| SALT (16 bytes)   | IV (16 bytes)     | CIPHERTEXT (AES-256-CBC + PKCS#7)     |
+-------------------+-------------------+---------------------------------------+
0                  16                  32                                     EOF
```
- **Encryption Parameters:**
  - `SALT`: 16 random bytes (`OsRng`).
  - `IV`: 16 random bytes (`OsRng`).
  - **Key Derivation:** `PBKDF2-HMAC-SHA256` with **64,000 iterations**, producing a 32-byte (256-bit) key.
  - **Cipher:** `AES-256-CBC` with **PKCS#7** block padding (`cbc::Encryptor<aes::Aes256>`).

### Multi-Fallback Decryption (`decrypt_sqlite_bytes`)
When opening an existing `.emb` file (must be at least `16 + 16 + 16 = 48` bytes), `decrypt_sqlite_bytes` extracts `salt = encrypted[0..16]`, `iv = encrypted[16..32]`, and `ciphertext = encrypted[32..]`, then attempts `AES-256-CBC` with PKCS#7 unpadding using three KDF profiles in sequence. A decryption attempt succeeds **only if** the resulting plaintext starts with the 16-byte SQLite header magic `b"SQLite format 3\0"`:

1. **Attempt 1 (Standard Container):** `PBKDF2-HMAC-SHA256`, **64,000 iterations**.
2. **Attempt 2 (SQLCipher 4 Default):** `PBKDF2-HMAC-SHA512`, **256,000 iterations**.
3. **Attempt 3 (wxSQLite3 / Legacy):** `PBKDF2-HMAC-SHA256`, **4,001 iterations**.

If all three attempts fail to produce a valid `SQLite format 3\0` header, `SyncError::Crypto(crypto.decryption_failed)` is returned.

### Temporary File & Atomic Flush Lifecycle (`EmbDatabaseHandler`)
1. **Open/Decrypt:** `EmbDatabaseHandler::open_or_create` creates a `NamedTempFile` in the OS temp directory, decrypts the `.emb` bytes into that temporary file, and `rusqlite::Connection` opens the temporary file path.
2. **Modification Tracking:** Any write operation on `DatabaseService` calls `self.mark_modified()`, setting `is_modified = true` on `EmbDatabaseHandler`.
3. **Flush & Atomic Persistence (`DatabaseService::flush`):**
   - If `is_modified` is `false`, `flush_to_emb()` is a no-op.
   - Executes `PRAGMA wal_checkpoint(TRUNCATE)` on the SQLite connection so all WAL frames are merged back into the main temporary SQLite file.
   - Reads the temporary file and verifies that its first 16 bytes equal `b"SQLite format 3\0"`.
   - Encrypts the bytes using `encrypt_sqlite_bytes` (PBKDF2-HMAC-SHA256, 64,000 iterations).
   - Creates a `NamedTempFile::new_in(parent_dir)` **in the same directory as the target `.emb` file**, writes and flushes the encrypted bytes, and atomically replaces the target `.emb` file via `atomic_temp.persist(&self.emb_path)`.

---

## 3. SQLite Connection Pragma & Initialization (`src/db/repository.rs`, `src/db/schema.rs`)

When `DatabaseService::connect` opens a SQLite connection:
- If `create == true` and `!is_emb` and `db_path.exists()`, removes the existing `.mmb` file (along with any `-wal` and `-shm` sidecar files) before opening the SQLite connection so the database is recreated cleanly from scratch.
- Sets `conn.busy_timeout(Duration::from_secs(10))` (10,000 ms busy wait for lock contention with MMEX Desktop).
- Executes `PRAGMA journal_mode = WAL`.
- If `create == true` or (`!db_path.exists() && !is_emb`):
  - Executes the embedded DDL script `tables_v1_for_sync.sql` (`DEFAULT_SCHEMA_SQL`).
  - Executes `PRAGMA user_version = 21`.
  - Marks the database modified (`service.mark_modified()`) and immediately calls `service.flush()?` so newly created `.emb` databases are encrypted and persisted to disk right away.
- Calls `refresh_schemas()` to inspect all tables in `SYNC_ORDER` via `PRAGMA table_info(<table>)`.

---

## 4. Technical Sync Schema & Triggers (`src/db/schema.rs`)

`DatabaseService::init_schema()` runs `init_sync_schema(&mut self.conn)` inside a single SQLite transaction (`conn.transaction()`):

### 4.1 Metadata & Deletion Log Tables
1. **`pb_sync_info`**:
   ```sql
   CREATE TABLE IF NOT EXISTS "pb_sync_info" (
       "KEY" TEXT PRIMARY KEY,
       "VAL" TEXT NOT NULL
   );
   INSERT OR IGNORE INTO pb_sync_info (KEY, VAL) VALUES ('VERSION', '1');
   ```
   - **Schema Migration (`CURRENT_SYNC_VERSION = "3"`):** If `VAL < 3`, drops all `TRG_<table>_DELETE` triggers across `SYNC_ORDER` so they are recreated with the v3 definition, and updates `VERSION` to `'3'`.
2. **`pb_DELETED_RECORDS_LOG`**:
   ```sql
   CREATE TABLE IF NOT EXISTS "pb_DELETED_RECORDS_LOG" (
       "table_name"   TEXT NOT NULL,
       "pb_id"        TEXT NOT NULL,
       "deleted_at"   TEXT DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'NOW')),
       PRIMARY KEY("table_name", "pb_id")
   );
   ```

### 4.2 Technical Columns Added to Each Synchronized MMEX Table
For every table in `SYNC_ORDER`, `ensure_technical_columns` checks `PRAGMA table_info` and adds any missing column:
- `pb_id TEXT`: Remote record identifier (e.g., PocketBase 15-char ID).
- `pb_is_dirty INTEGER DEFAULT 0`: 3-state synchronization status (`0` = Synced, `1` = Dirty/Local change, `2` = Pending/Cloud ingress).
- `pb_updated_at TEXT`: ISO-8601 UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`).

### 4.3 Automatic Change-Tracking Triggers
For every table in `SYNC_ORDER`, three triggers are created:

1. **`TRG_<table>_INSERT`**:
   ```sql
   CREATE TRIGGER IF NOT EXISTS TRG_<table>_INSERT
   AFTER INSERT ON <table>
   FOR EACH ROW WHEN NEW.pb_is_dirty IS NOT 2
   BEGIN
       UPDATE <table> SET pb_is_dirty = 1,
              pb_updated_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'NOW')
              WHERE ROWID = NEW.ROWID;
   END;
   ```
2. **`TRG_<table>_UPDATE`** (fires **only** on non-PK, non-technical domain columns `fields.join(", ")`):
   ```sql
   CREATE TRIGGER IF NOT EXISTS TRG_<table>_UPDATE
   AFTER UPDATE OF <domain_col_1, domain_col_2, ...> ON <table>
   WHEN (NEW.pb_is_dirty != 2)
   BEGIN
       UPDATE <table> SET pb_is_dirty = 1,
              pb_updated_at = STRFTIME('%Y-%m-%dT%H:%M:%SZ', 'NOW')
              WHERE ROWID = NEW.ROWID;
   END;
   ```
3. **`TRG_<table>_DELETE`** (logs deletion only if the record was previously synced and has a `pb_id`):
   ```sql
   CREATE TRIGGER IF NOT EXISTS TRG_<table>_DELETE
   BEFORE DELETE ON <table>
   FOR EACH ROW
   WHEN OLD.pb_id IS NOT NULL
   BEGIN
       INSERT OR REPLACE INTO pb_DELETED_RECORDS_LOG (table_name, pb_id) VALUES ('<table>', OLD.pb_id);
   END;
   ```
   - **Intentional Trigger Bypass on Remote Deletions:** When `DatabaseService::apply_remote_changes` processes a remote deletion (`remote.is_deleted == true`) for a matching local `rowid`, it first executes `UPDATE <table> SET pb_id = NULL WHERE ROWID = ?` and then `DELETE FROM <table> WHERE ROWID = ?` within the same transaction. Because `TRG_<table>_UPDATE` only watches domain columns, setting `pb_id = NULL` does not fire the update trigger, and `OLD.pb_id IS NOT NULL` evaluates to `false` on `DELETE`, preventing remote deletions from being re-logged into `pb_DELETED_RECORDS_LOG`.

### 4.4 Schema Cleanup (`clear_technical_schema` / `--clearDb`)
Inside a single transaction, for all 22 tables in `SYNC_ORDER`:
1. Drops `TRG_<table>_INSERT`, `TRG_<table>_UPDATE`, and `TRG_<table>_DELETE`.
2. Executes `ALTER TABLE <table> DROP COLUMN pb_id`, `pb_is_dirty`, and `pb_updated_at`.
3. Drops tables `pb_DELETED_RECORDS_LOG` and `pb_sync_info`.

---

## 5. Synchronized MMEX Tables (`SYNC_ORDER`), Unique Constraints, and Foreign Key Map (`src/domain/sync_order.rs`)

### 5.1 Topological `SYNC_ORDER` (22 Tables)

| # | Tier | Table Name | Primary Key (`pk`) | Unique Constraints (`unique`) | Domain Columns (`fields`) |
| :-: | :-: | :--- | :--- | :--- | :--- |
| 1 | L1 | `INFOTABLE_V1` | `INFOID` | `Single("INFONAME")` | `INFONAME`, `INFOVALUE` |
| 2 | L1 | `CURRENCYFORMATS_V1` | `CURRENCYID` | `Single("CURRENCYNAME")`, `Single("CURRENCY_SYMBOL")` | `CURRENCYNAME`, `PFX_SYMBOL`, `SFX_SYMBOL`, `DECIMAL_POINT`, `GROUP_SEPARATOR`, `UNIT_NAME`, `CENT_NAME`, `SCALE`, `BASECONVRATE`, `CURRENCY_SYMBOL`, `CURRENCY_TYPE` |
| 3 | L1 | `TAG_V1` | `TAGID` | *(none)* | `TAGNAME`, `ACTIVE` |
| 4 | L1 | `BUDGETYEAR_V1` | `BUDGETYEARID` | `Single("BUDGETYEARNAME")` | `BUDGETYEARNAME` |
| 5 | L1 | `CUSTOMFIELD_V1` | `FIELDID` | *(none)* | `REFTYPE`, `DESCRIPTION`, `TYPE`, `PROPERTIES` |
| 6 | L2 | `CATEGORY_V1` | `CATEGID` | `Composite(["CATEGNAME", "PARENTID"])` | `CATEGNAME`, `ACTIVE`, `PARENTID` |
| 7 | L2 | `PAYEE_V1` | `PAYEEID` | `Single("PAYEENAME")` | `PAYEENAME`, `CATEGID`, `NUMBER`, `WEBSITE`, `NOTES`, `ACTIVE`, `PATTERN` |
| 8 | L2 | `ACCOUNTLIST_V1` | `ACCOUNTID` | `Single("ACCOUNTNAME")` | `ACCOUNTNAME`, `ACCOUNTTYPE`, `ACCOUNTNUM`, `STATUS`, `NOTES`, `HELDAT`, `WEBSITE`, `CONTACTINFO`, `ACCESSINFO`, `INITIALBAL`, `INITIALDATE`, `FAVORITEACCT`, `CURRENCYID`, `STATEMENTLOCKED`, `STATEMENTDATE`, `MINIMUMBALANCE`, `CREDITLIMIT`, `INTERESTRATE`, `PAYMENTDUEDATE`, `MINIMUMPAYMENT` |
| 9 | L3 | `ASSETS_V1` | `ASSETID` | *(none)* | `STARTDATE`, `ASSETNAME`, `ASSETSTATUS`, `CURRENCYID`, `VALUECHANGEMODE`, `VALUE`, `VALUECHANGE`, `NOTES`, `VALUECHANGERATE`, `ASSETTYPE` |
| 10 | L3 | `STOCK_V1` | `STOCKID` | *(none)* | `HELDAT`, `PURCHASEDATE`, `STOCKNAME`, `SYMBOL`, `NUMSHARES`, `PURCHASEPRICE`, `NOTES`, `CURRENTPRICE`, `VALUE`, `COMMISSION` |
| 11 | L3 | `CHECKINGACCOUNT_V1` | `TRANSID` | *(none)* | `ACCOUNTID`, `TOACCOUNTID`, `PAYEEID`, `TRANSCODE`, `TRANSAMOUNT`, `STATUS`, `TRANSACTIONNUMBER`, `NOTES`, `CATEGID`, `TRANSDATE`, `LASTUPDATEDTIME`, `DELETEDTIME`, `FOLLOWUPID`, `TOTRANSAMOUNT`, `COLOR` |
| 12 | L3 | `BILLSDEPOSITS_V1` | `BDID` | *(none)* | `ACCOUNTID`, `TOACCOUNTID`, `PAYEEID`, `TRANSCODE`, `TRANSAMOUNT`, `STATUS`, `TRANSACTIONNUMBER`, `NOTES`, `CATEGID`, `TRANSDATE`, `FOLLOWUPID`, `TOTRANSAMOUNT`, `REPEATS`, `NEXTOCCURRENCEDATE`, `NUMOCCURRENCES`, `COLOR` |
| 13 | L3 | `BUDGETTABLE_V1` | `BUDGETENTRYID` | *(none)* | `BUDGETYEARID`, `CATEGID`, `PERIOD`, `AMOUNT`, `NOTES`, `ACTIVE` |
| 14 | L4 | `SPLITTRANSACTIONS_V1` | `SPLITTRANSID` | *(none)* | `TRANSID`, `CATEGID`, `SPLITTRANSAMOUNT`, `NOTES` |
| 15 | L4 | `BUDGETSPLITTRANSACTIONS_V1` | `SPLITTRANSID` | *(none)* | `TRANSID`, `CATEGID`, `SPLITTRANSAMOUNT`, `NOTES` |
| 16 | L4 | `CURRENCYHISTORY_V1` | `CURRHISTID` | `Composite(["CURRENCYID", "CURRDATE"])` | `CURRENCYID`, `CURRDATE`, `CURRVALUE`, `CURRUPDTYPE` |
| 17 | L4 | `STOCKHISTORY_V1` | `HISTID` | `Composite(["SYMBOL", "DATE"])` | `SYMBOL`, `DATE`, `VALUE`, `UPDTYPE` |
| 18 | L4 | `ATTACHMENT_V1` | `ATTACHMENTID` | *(none)* | `REFTYPE`, `REFID`, `DESCRIPTION`, `FILENAME` |
| 19 | L4 | `TAGLINK_V1` | `TAGLINKID` | `Composite(["REFTYPE", "REFID", "TAGID"])` | `REFTYPE`, `REFID`, `TAGID` |
| 20 | L4 | `TRANSLINK_V1` | `TRANSLINKID` | *(none)* | `CHECKINGACCOUNTID`, `LINKTYPE`, `LINKRECORDID` |
| 21 | L4 | `SHAREINFO_V1` | `SHAREINFOID` | *(none)* | `CHECKINGACCOUNTID`, `SHARENUMBER`, `SHAREPRICE`, `SHARECOMMISSION`, `SHARELOT` |
| 22 | L4 | `CUSTOMFIELDDATA_V1` | `FIELDATADID` | `Composite(["FIELDID", "REFID"])` | `FIELDID`, `REFID`, `CONTENT` |

### 5.2 Foreign Key Cascade Map (`get_referencing_fk_columns`)
When a conflict resolution changes a record's Primary Key (`old_pk != new_pk`), `replace_record_and_references` iterates over all 22 tables in `SYNC_ORDER` and updates any column matching `get_referencing_fk_columns(pk_column)`:

| Primary Key Column (`pk_column`) | Referencing Foreign Key Columns Updated Across `SYNC_ORDER` |
| :--- | :--- |
| `ACCOUNTID` | `ACCOUNTID`, `TOACCOUNTID` |
| `CATEGID` | `CATEGID`, `PARENTID` |
| `PAYEEID` | `PAYEEID` |
| `CURRENCYID` | `CURRENCYID` |
| `TAGID` | `TAGID` |
| `BUDGETYEARID` | `BUDGETYEARID` |
| `FIELDID` | `FIELDID` |
| `TRANSID` | `TRANSID`, `CHECKINGACCOUNTID` |
| `ASSETID` | `ASSETID` |
| `STOCKID` | `STOCKID` |

---

## Invarianti di Sistema

1. **3-State Loop-Prevention Protocol (`pb_is_dirty`):**
   - `0` (`Synced`): Record is aligned with the remote server.
   - `1` (`Dirty`): Record was inserted or updated locally by MMEX Desktop; must be pushed.
   - `2` (`Pending` / Cloud Ingress): Record is currently being inserted or updated by `mmex-sync` during a PULL or conflict resolution. Both `TRG_<table>_INSERT` and `TRG_<table>_UPDATE` MUST ignore changes when `NEW.pb_is_dirty == 2`, and `DatabaseService` MUST immediately reset `pb_is_dirty = 0` after the write completes.
2. **Crash Recovery of Pending Records (`reset_unfinished_ops`):** Any record left in state `pb_is_dirty = 2` after a table pull MUST be reset to `pb_is_dirty = 1` (`UPDATE <table> SET pb_is_dirty = 1 WHERE pb_is_dirty = 2`) so interrupted operations are not silently lost.
3. **Atomic `.emb` Persistence & WAL Checkpoint:** Before re-encrypting a temporary SQLite database back to `.emb`, `PRAGMA wal_checkpoint(TRUNCATE)` MUST be executed so that no data remains trapped in the `-wal` file, and the encrypted output MUST be written to a temporary file in the same directory and atomically persisted (`NamedTempFile::persist`).
4. **SQLite Magic Header Verification:** Decryption of `.emb` files and pre-encryption validation in `flush_to_emb` MUST always verify the 16-byte header `b"SQLite format 3\0"` to prevent overwriting a user's `.emb` database with corrupted or uninitialized data.
5. **Trigger Scope on Domain Columns Only & Remote Deletion Bypass:** `TRG_<table>_UPDATE` MUST only watch domain columns (`AFTER UPDATE OF <non_tech_cols>`), never `pb_id`, `pb_is_dirty`, or `pb_updated_at`, preventing infinite trigger recursion when `set_synced_status` updates `pb_id` and `pb_is_dirty = 0`. Similarly, when `apply_remote_changes` deletes a local row due to `remote.is_deleted == true`, it MUST first set `pb_id = NULL` before executing `DELETE` in the same transaction so `TRG_<table>_DELETE` (`WHEN OLD.pb_id IS NOT NULL`) is bypassed and does not re-queue the remote deletion into `pb_DELETED_RECORDS_LOG`.
6. **Foreign Key Referential Integrity on PK Realignment:** Whenever a local record is merged with a remote record that has a different integer Primary Key (`old_pk != new_pk`), `replace_record_and_references` MUST update both the record's PK and all referencing FK columns across `SYNC_ORDER` within the same SQLite transaction.

