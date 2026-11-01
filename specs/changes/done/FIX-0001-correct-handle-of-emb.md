# FIX-0001: Correct SQLCipher v4 (`legacy = 4`) handling for Money Manager Ex `.emb` files

**Status:** DONE
**Date:** 2026-10-30
**Impacted Modules:** `src/crypto/emb.rs`, `src/db/repository.rs`, `src/sync/runner.rs`

## 1. Reference Specification
- **Target Spec:** `specs/as-is/01-db-and-crypto.md` (Section 2: *Encrypted `.emb` Database Handling (`src/crypto/emb.rs`)* and Section 3: *SQLite Connection Pragma & Initialization*)
- **Spec Update Required?:** Yes — `specs/as-is/01-db-and-crypto.md` currently documents a custom monolithic whole-file `[SALT 16B][IV 16B][AES-256-CBC + PKCS#7]` container format instead of the SQLCipher v4 (`cipher = 'sqlcipher'`, `legacy = 4`) format required by Money Manager Ex for PC.

## 2. Observed Behavior (The Bug)
- Opening any real `.emb` encrypted database created by Money Manager Ex for PC (or by the legacy Node.js `mmex-sync` implementation) fails with `SyncError::Crypto` (`crypto.decryption_failed`).
- Conversely, `.emb` files created or saved by the current Rust implementation cannot be opened by Money Manager Ex for PC.
- **Root Cause Analysis:**
  1. **Monolithic Container vs. SQLCipher v4 Page Encryption:** `src/crypto/emb.rs` (`encrypt_sqlite_bytes` / `decrypt_sqlite_bytes`) currently treats `.emb` files as a single monolithic buffer `[SALT (16 bytes)] + [IV (16 bytes)] + [PKCS#7-padded AES-256-CBC ciphertext of the entire file]`.
  2. **Incorrect Page Layout & IV Offset:** In SQLCipher v4 (`cipher = 'sqlcipher'`, `legacy = 4`, default `page_size = 4096`, `reserve = 80` bytes per page = 16-byte IV + 64-byte HMAC-SHA512), encryption is performed **page by page** without PKCS#7 padding:
     - **Page 1 (`4096` bytes):** Bytes `0..16` contain the unencrypted 16-byte KDF salt (replacing `"SQLite format 3\0"`), bytes `16..4016` contain the AES-256-CBC ciphertext of plaintext bytes `16..4016`, bytes `4016..4032` store the Page 1 IV, and bytes `4032..4096` store the `HMAC-SHA512` tag.
     - **Pages `2..N` (`4096` bytes each):** Bytes `0..4016` contain the AES-256-CBC ciphertext, bytes `4016..4032` store the per-page IV, and bytes `4032..4096` store the `HMAC-SHA512` tag.
  3. **Invalid Magic Header Check on Decrypted Stream:** `decrypt_sqlite_bytes` expects the decrypted ciphertext starting at byte `32` to begin with `b"SQLite format 3\0"`, whereas SQLCipher v4 never encrypts the first 16 bytes of Page 1 (they are replaced by the salt on disk and restored to `b"SQLite format 3\0"` in plaintext).
  4. **Incompatible Encryption Parameters on Write:** `encrypt_sqlite_bytes` writes a monolithic stream using `PBKDF2-HMAC-SHA256` (64,000 iterations) instead of SQLCipher v4 (`PBKDF2-HMAC-SHA512` with 256,000 iterations for the encryption key, and `PBKDF2-HMAC-SHA512` with 2 iterations and `salt XOR 0x3a` for the HMAC-SHA512 key).
- **Steps to reproduce:**
  1. Create or encrypt a database (`.emb`) with a password in Money Manager Ex for PC.
  2. Configure `mmex-sync` (via GUI or CLI `--db <path.emb> --filePassword <password> --sync`) to open that `.emb` file.
  3. Observe that `DatabaseService::connect` -> `EmbDatabaseHandler::open_or_create` -> `decrypt_sqlite_bytes` fails immediately with `crypto.decryption_failed`.

## 3. Expected Behavior
- The `.emb` encryption and decryption logic must strictly match Money Manager Ex for PC and the working legacy Node.js implementation:
  ```javascript
  db = new DatabaseCipher(dbPath);
  db.pragma("cipher = 'sqlcipher'");
  db.pragma("legacy = 4");
  if (password) {
      db.pragma(`key = '${escapedPassword}'`);
  }
  db.prepare("SELECT count(*) FROM sqlite_master").get();
  return db;
  ```
- Specifically, `.emb` handling must align with **SQLCipher v4 (`cipher = 'sqlcipher'`, `legacy = 4`)**:
  - **Key Derivation:**
    - KDF Algorithm: `PBKDF2-HMAC-SHA512` with `kdf_iter = 256,000` over the 16-byte database salt (`offset 0..16` of Page 1) to derive the 32-byte AES-256 key.
    - HMAC Key Derivation: `PBKDF2-HMAC-SHA512` with `2` iterations using the 32-byte encryption key and `hmac_salt = salt XOR 0x3a` (16 bytes).
  - **Page Encryption / Decryption (or Native SQLCipher Pragma Execution):**
    - Cipher: `AES-256-CBC` per page (`page_size = 4096` bytes, `reserved = 80` bytes: 16-byte random IV + 64-byte `HMAC-SHA512` over `ciphertext || iv || page_no_le_u32`).
    - Page 1 plaintext bytes `0..16` are `b"SQLite format 3\0"` and byte `20` (reserved bytes per page) reflects the SQLite/SQLCipher reserve space (`80` in encrypted form, `0` when translated to a standard unencrypted temporary SQLite file, or handled natively via SQLCipher pragmas `PRAGMA cipher = 'sqlcipher'; PRAGMA legacy = 4; PRAGMA key = '...';`).
    - Password and database validity must be verified against `SELECT count(*) FROM sqlite_master` (and/or per-page `HMAC-SHA512` verification).
  - `.emb` files opened, modified, or created (`--create` / GUI `New DB...`) by `mmex-sync` must be 100% interoperable (read/write) with Money Manager Ex for PC.

## 4. Acceptance Criteria
- [x] The issue is fixed in the codebase without breaking existing tests.
- [x] `.emb` databases created by Money Manager Ex for PC (SQLCipher v4, `legacy = 4`) can be opened, synchronized, and saved by `mmex-sync`, and subsequently reopened in Money Manager Ex for PC without errors.
- [x] New `.emb` databases initialized by `mmex-sync` can be opened directly in Money Manager Ex for PC with the configured password.
- [x] A new unit test (or integration test) has been added to prevent regressions (testing SQLCipher v4 `legacy = 4` format roundtrip, `SELECT count(*) FROM sqlite_master` validation, and wrong-password rejection).
- [x] `cargo check`, `cargo clippy`, and `cargo test` pass with no warnings.
- [x] The `specs/as-is/01-db-and-crypto.md` documentation has been updated to reflect the SQLCipher v4 (`legacy = 4`) specification.

