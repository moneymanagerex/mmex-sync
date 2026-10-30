use aes::cipher::{block_padding::NoPadding, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use hmac::{Hmac, Mac};
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use rusqlite::Connection;
use sha2::{Sha256, Sha512};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tempfile::NamedTempFile;

use crate::error::SyncError;

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;
type HmacSha512 = Hmac<Sha512>;

pub const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
pub const SQLCIPHER_PAGE_SIZE: usize = 4096;
pub const SALT_SIZE: usize = 16;
pub const IV_SIZE: usize = 16;
pub const HMAC_SIZE: usize = 64;
pub const RESERVE_SIZE: usize = IV_SIZE + HMAC_SIZE; // 80 byte (0x50) riservati a fine pagina per IV + HMAC-SHA512
pub const KEY_SIZE: usize = 32;

/// Parametri standard SQLCipher v4 (`PRAGMA cipher = 'sqlcipher'; PRAGMA legacy = 4;`)
pub const SQLCIPHER4_KDF_ITER: u32 = 256_000;
pub const SQLCIPHER4_FAST_KDF_ITER: u32 = 2;
pub const SQLCIPHER4_HMAC_SALT_MASK: u8 = 0x3a;

/// Verifica se il percorso indicato corrisponde a un file MMEX cifrato (.emb)
pub fn is_emb_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("emb"))
        .unwrap_or(false)
}

/// Deriva una chiave AES-256 a 32 byte dalla password e dal salt usando PBKDF2-HMAC-SHA256
pub fn derive_key(password: &str, salt: &[u8], iterations: u32) -> [u8; KEY_SIZE] {
    let mut key = [0u8; KEY_SIZE];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, iterations, &mut key);
    key
}

/// Deriva chiave usando PBKDF2-HMAC-SHA512 (standard SQLCipher 4)
pub fn derive_key_sha512(password: &str, salt: &[u8], iterations: u32) -> [u8; KEY_SIZE] {
    let mut key = [0u8; KEY_SIZE];
    pbkdf2_hmac::<Sha512>(password.as_bytes(), salt, iterations, &mut key);
    key
}

/// Deriva la coppia `(encryption_key, hmac_key)` secondo le specifiche SQLCipher v4 (`legacy = 4`):
/// - `enc_key`: PBKDF2-HMAC-SHA512(password, salt, 256_000) -> 32 byte
/// - `hmac_salt`: `salt[i] ^ 0x3a` -> 16 byte
/// - `hmac_key`: PBKDF2-HMAC-SHA512(enc_key, hmac_salt, 2) -> 32 byte
pub fn derive_sqlcipher4_keys(password: &str, salt: &[u8]) -> ([u8; KEY_SIZE], [u8; KEY_SIZE]) {
    let enc_key = derive_key_sha512(password, salt, SQLCIPHER4_KDF_ITER);

    let mut hmac_salt = [0u8; SALT_SIZE];
    for (i, b) in salt.iter().take(SALT_SIZE).enumerate() {
        hmac_salt[i] = *b ^ SQLCIPHER4_HMAC_SALT_MASK;
    }

    let mut hmac_key = [0u8; KEY_SIZE];
    pbkdf2_hmac::<Sha512>(
        &enc_key,
        &hmac_salt,
        SQLCIPHER4_FAST_KDF_ITER,
        &mut hmac_key,
    );

    (enc_key, hmac_key)
}

/// Calcola l'HMAC-SHA512 di una pagina SQLCipher v4 (`ciphertext || iv || page_no_le_u32`)
fn compute_page_hmac(
    hmac_key: &[u8; KEY_SIZE],
    ciphertext_and_iv: &[u8],
    page_no: u32,
) -> Result<[u8; HMAC_SIZE], SyncError> {
    let mut mac = <HmacSha512 as Mac>::new_from_slice(hmac_key).map_err(|e| {
        SyncError::Crypto(crate::i18n::t_fmt(
            "crypto.aes_cbc_init_failed",
            &[("error", &e.to_string())],
        ))
    })?;
    mac.update(ciphertext_and_iv);
    mac.update(&page_no.to_le_bytes());
    let digest = mac.finalize().into_bytes();

    let mut out = [0u8; HMAC_SIZE];
    out.copy_from_slice(&digest);
    Ok(out)
}

/// Verifica in tempo costante l'HMAC-SHA512 di una pagina SQLCipher v4
fn verify_page_hmac(
    hmac_key: &[u8; KEY_SIZE],
    ciphertext_and_iv: &[u8],
    page_no: u32,
    expected_hmac: &[u8],
) -> Result<(), SyncError> {
    let mut mac = <HmacSha512 as Mac>::new_from_slice(hmac_key).map_err(|e| {
        SyncError::Crypto(crate::i18n::t_fmt(
            "crypto.aes_cbc_init_failed",
            &[("error", &e.to_string())],
        ))
    })?;
    mac.update(ciphertext_and_iv);
    mac.update(&page_no.to_le_bytes());
    mac.verify_slice(expected_hmac)
        .map_err(|_| SyncError::Crypto(crate::i18n::t("crypto.decryption_failed").to_string()))
}

/// Costruisce un database SQLite vuoto di 1 pagina (4096 byte) preconfigurato con
/// `page_size = 4096` e `reserve_bytes = 80` (`0x50`), come richiesto da SQLCipher v4 (`legacy = 4`).
pub fn create_empty_sqlcipher_sqlite_page() -> [u8; SQLCIPHER_PAGE_SIZE] {
    let mut page = [0u8; SQLCIPHER_PAGE_SIZE];

    // 0..16: Magic header SQLite 3
    page[0..16].copy_from_slice(SQLITE_MAGIC);
    // 16..18: Page size = 4096 (0x1000 big-endian)
    page[16..18].copy_from_slice(&(SQLCIPHER_PAGE_SIZE as u16).to_be_bytes());
    // 18..20: File format write/read version (1 = rollback journal)
    page[18] = 1;
    page[19] = 1;
    // 20: Bytes of unused "reserved" space at the end of each page (80 = 16 IV + 64 HMAC-SHA512)
    page[20] = RESERVE_SIZE as u8;
    // 21..24: Payload fractions standard SQLite (64, 32, 32)
    page[21] = 64;
    page[22] = 32;
    page[23] = 32;
    // 24..28: File change counter = 1
    page[24..28].copy_from_slice(&1u32.to_be_bytes());
    // 28..32: Size of database file in pages = 1
    page[28..32].copy_from_slice(&1u32.to_be_bytes());
    // 40..44: Schema cookie = 0
    page[40..44].copy_from_slice(&0u32.to_be_bytes());
    // 44..48: Schema format number = 4
    page[44..48].copy_from_slice(&4u32.to_be_bytes());
    // 56..60: Database text encoding = 1 (UTF-8)
    page[56..60].copy_from_slice(&1u32.to_be_bytes());
    // 92..96: Version-valid-for number = 1
    page[92..96].copy_from_slice(&1u32.to_be_bytes());
    // 96..100: SQLITE_VERSION_NUMBER
    page[96..100].copy_from_slice(&3_046_000u32.to_be_bytes());

    // 100..108: B-tree leaf table header per sqlite_master vuoto
    page[100] = 0x0d; // Leaf table B-tree page (13)
    page[101..103].copy_from_slice(&0u16.to_be_bytes()); // First freeblock = 0
    page[103..105].copy_from_slice(&0u16.to_be_bytes()); // Number of cells = 0
    let usable_size = (SQLCIPHER_PAGE_SIZE - RESERVE_SIZE) as u16; // 4016 (0x0FB0)
    page[105..107].copy_from_slice(&usable_size.to_be_bytes()); // Start of cell content area
    page[107] = 0; // Fragmented free bytes = 0

    page
}

/// Cifra un buffer di byte contenente un database SQLite nel formato SQLCipher v4 (`legacy = 4`)
/// generando un nuovo salt casuale a 16 byte.
pub fn encrypt_sqlite_bytes(plaintext: &[u8], password: &str) -> Result<Vec<u8>, SyncError> {
    let mut salt = [0u8; SALT_SIZE];
    OsRng.fill_bytes(&mut salt);
    encrypt_sqlite_bytes_with_salt(plaintext, password, &salt)
}

/// Cifra un buffer SQLite nel formato a pagine SQLCipher v4 (`cipher = 'sqlcipher'`, `legacy = 4`)
/// usando il `salt` a 16 byte specificato.
pub fn encrypt_sqlite_bytes_with_salt(
    plaintext: &[u8],
    password: &str,
    salt: &[u8; SALT_SIZE],
) -> Result<Vec<u8>, SyncError> {
    if plaintext.len() < SQLCIPHER_PAGE_SIZE
        || !plaintext.len().is_multiple_of(SQLCIPHER_PAGE_SIZE)
        || &plaintext[..16] != SQLITE_MAGIC
    {
        return Err(SyncError::Crypto(
            crate::i18n::t("crypto.invalid_sqlite_temp").to_string(),
        ));
    }

    let (enc_key, hmac_key) = derive_sqlcipher4_keys(password, salt);
    let num_pages = plaintext.len() / SQLCIPHER_PAGE_SIZE;
    let mut result = Vec::with_capacity(plaintext.len());

    let ciphertext_end = SQLCIPHER_PAGE_SIZE - RESERVE_SIZE; // 4016
    let iv_end = ciphertext_end + IV_SIZE; // 4032

    for page_idx in 0..num_pages {
        let page_no = (page_idx + 1) as u32;
        let plain_page =
            &plaintext[page_idx * SQLCIPHER_PAGE_SIZE..(page_idx + 1) * SQLCIPHER_PAGE_SIZE];

        let mut enc_page = [0u8; SQLCIPHER_PAGE_SIZE];
        let mut iv = [0u8; IV_SIZE];
        OsRng.fill_bytes(&mut iv);

        let offset = if page_no == 1 {
            enc_page[..SALT_SIZE].copy_from_slice(salt);
            SALT_SIZE
        } else {
            0
        };

        let mut plain_to_encrypt = plain_page[offset..ciphertext_end].to_vec();
        if page_no == 1 {
            // Byte 20 della Pagina 1 (indice 4 a partire da offset 16) indica i byte riservati per pagina (80)
            plain_to_encrypt[4] = RESERVE_SIZE as u8;
        }

        let encryptor = Aes256CbcEnc::new_from_slices(&enc_key, &iv).map_err(|e| {
            SyncError::Crypto(crate::i18n::t_fmt(
                "crypto.aes_cbc_init_failed",
                &[("error", &e.to_string())],
            ))
        })?;

        encryptor
            .encrypt_padded_b2b_mut::<NoPadding>(
                &plain_to_encrypt,
                &mut enc_page[offset..ciphertext_end],
            )
            .map_err(|e| {
                SyncError::Crypto(crate::i18n::t_fmt(
                    "crypto.db_encryption_failed",
                    &[("error", &e.to_string())],
                ))
            })?;

        enc_page[ciphertext_end..iv_end].copy_from_slice(&iv);

        let hmac = compute_page_hmac(&hmac_key, &enc_page[offset..iv_end], page_no)?;
        enc_page[iv_end..SQLCIPHER_PAGE_SIZE].copy_from_slice(&hmac);

        result.extend_from_slice(&enc_page);
    }

    Ok(result)
}

/// Decifra i byte di un database `.emb` cifrato con SQLCipher v4 (`cipher = 'sqlcipher'`, `legacy = 4`),
/// verificando l'HMAC-SHA512 di ogni pagina e ricostruendo l'header SQLite standard.
pub fn decrypt_sqlite_bytes(encrypted: &[u8], password: &str) -> Result<Vec<u8>, SyncError> {
    if encrypted.len() < SQLCIPHER_PAGE_SIZE || !encrypted.len().is_multiple_of(SQLCIPHER_PAGE_SIZE)
    {
        return Err(SyncError::Crypto(
            crate::i18n::t("crypto.file_corrupted").to_string(),
        ));
    }

    let salt = &encrypted[..SALT_SIZE];
    let (enc_key, hmac_key) = derive_sqlcipher4_keys(password, salt);

    let num_pages = encrypted.len() / SQLCIPHER_PAGE_SIZE;
    let mut result = Vec::with_capacity(encrypted.len());

    let ciphertext_end = SQLCIPHER_PAGE_SIZE - RESERVE_SIZE; // 4016
    let iv_end = ciphertext_end + IV_SIZE; // 4032

    for page_idx in 0..num_pages {
        let page_no = (page_idx + 1) as u32;
        let enc_page =
            &encrypted[page_idx * SQLCIPHER_PAGE_SIZE..(page_idx + 1) * SQLCIPHER_PAGE_SIZE];

        // In SQLCipher le pagine oltre la prima interamente composte da zeri sono trattate come pagine vuote
        if page_no > 1 && enc_page.iter().all(|&b| b == 0) {
            result.extend_from_slice(&[0u8; SQLCIPHER_PAGE_SIZE]);
            continue;
        }

        let offset = if page_no == 1 { SALT_SIZE } else { 0 };
        let ciphertext = &enc_page[offset..ciphertext_end];
        let iv = &enc_page[ciphertext_end..iv_end];
        let stored_hmac = &enc_page[iv_end..SQLCIPHER_PAGE_SIZE];

        // 1. Verifica integrità e autenticità della pagina tramite HMAC-SHA512
        verify_page_hmac(&hmac_key, &enc_page[offset..iv_end], page_no, stored_hmac)?;

        // 2. Decrittazione AES-256-CBC (senza padding PKCS#7, blocchi multipli esatti di 16 byte)
        let decryptor = Aes256CbcDec::new_from_slices(&enc_key, iv).map_err(|_| {
            SyncError::Crypto(crate::i18n::t("crypto.decryption_failed").to_string())
        })?;

        let mut plain_page = [0u8; SQLCIPHER_PAGE_SIZE];
        if page_no == 1 {
            plain_page[..SALT_SIZE].copy_from_slice(SQLITE_MAGIC);
        }

        decryptor
            .decrypt_padded_b2b_mut::<NoPadding>(
                ciphertext,
                &mut plain_page[offset..ciphertext_end],
            )
            .map_err(|_| {
                SyncError::Crypto(crate::i18n::t("crypto.decryption_failed").to_string())
            })?;

        // I 80 byte finali (4016..4096) rimangono azzerati come area riservata SQLite
        result.extend_from_slice(&plain_page);
    }

    // Verifica validità dell'header SQLite ricostruito nella Pagina 1
    let page_size = u16::from_be_bytes([result[16], result[17]]) as usize;
    if &result[..16] != SQLITE_MAGIC
        || page_size != SQLCIPHER_PAGE_SIZE
        || result[21] != 64
        || result[22] != 32
        || result[23] != 32
    {
        return Err(SyncError::Crypto(
            crate::i18n::t("crypto.decryption_failed").to_string(),
        ));
    }

    Ok(result)
}

/// Verifica che un file SQLite decifrato sia leggibile eseguendo `SELECT count(*) FROM sqlite_master`
fn verify_sqlite_master(db_path: &Path) -> Result<(), SyncError> {
    let conn = Connection::open(db_path)
        .map_err(|_| SyncError::Crypto(crate::i18n::t("crypto.decryption_failed").to_string()))?;
    let _: i64 = conn
        .query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get(0))
        .map_err(|_| SyncError::Crypto(crate::i18n::t("crypto.decryption_failed").to_string()))?;
    Ok(())
}

/// Gestore del ciclo di vita del database cifrato .emb
/// Mantiene il database temporaneo decifrato e si occupa della ricifratura atomica su salvataggio
pub struct EmbDatabaseHandler {
    emb_path: PathBuf,
    password: Option<String>,
    salt: [u8; SALT_SIZE],
    temp_file: NamedTempFile,
    is_modified: bool,
}

impl EmbDatabaseHandler {
    /// Inizializza l'handler decifrando il file .emb esistente o preparando un file temporaneo SQLCipher-compatibile
    pub fn open_or_create(
        emb_path: &Path,
        password: Option<&str>,
        create: bool,
    ) -> Result<Self, SyncError> {
        let pwd = password.filter(|p| !p.is_empty()).ok_or_else(|| {
            SyncError::Crypto(crate::i18n::t_fmt(
                "crypto.password_required",
                &[("path", &emb_path.display().to_string())],
            ))
        })?;

        let temp_file = NamedTempFile::new()?;
        let mut salt = [0u8; SALT_SIZE];

        let existing_len = fs::metadata(emb_path).map(|m| m.len()).unwrap_or(0);

        if emb_path.exists() && existing_len > 0 && !create {
            let mut raw_bytes = Vec::new();
            File::open(emb_path)?.read_to_end(&mut raw_bytes)?;

            if raw_bytes.len() < SQLCIPHER_PAGE_SIZE {
                return Err(SyncError::Crypto(
                    crate::i18n::t("crypto.file_corrupted").to_string(),
                ));
            }
            salt.copy_from_slice(&raw_bytes[..SALT_SIZE]);

            let decrypted_bytes = decrypt_sqlite_bytes(&raw_bytes, pwd)?;
            fs::write(temp_file.path(), decrypted_bytes)?;

            // Verifica esplicita equivalente a `db.prepare("SELECT count(*) FROM sqlite_master").get()`
            verify_sqlite_master(temp_file.path())?;
        } else {
            OsRng.fill_bytes(&mut salt);
            let empty_page = create_empty_sqlcipher_sqlite_page();
            fs::write(temp_file.path(), empty_page)?;
        }

        Ok(Self {
            emb_path: emb_path.to_path_buf(),
            password: Some(pwd.to_string()),
            salt,
            temp_file,
            is_modified: false,
        })
    }

    /// Ricarica e decifra nuovamente il file `.emb` da disco nel file temporaneo
    /// (utilizzato dopo modifiche esterne di Money Manager Ex in modalità `run` o `watch`)
    pub fn reload_from_emb(&mut self) -> Result<(), SyncError> {
        if !self.emb_path.exists() {
            return Ok(());
        }

        let pwd = self.password.as_deref().ok_or_else(|| {
            SyncError::Crypto(crate::i18n::t_fmt(
                "crypto.password_required",
                &[("path", &self.emb_path.display().to_string())],
            ))
        })?;

        let mut raw_bytes = Vec::new();
        File::open(&self.emb_path)?.read_to_end(&mut raw_bytes)?;

        if raw_bytes.len() < SQLCIPHER_PAGE_SIZE {
            return Err(SyncError::Crypto(
                crate::i18n::t("crypto.file_corrupted").to_string(),
            ));
        }
        self.salt.copy_from_slice(&raw_bytes[..SALT_SIZE]);

        let decrypted_bytes = decrypt_sqlite_bytes(&raw_bytes, pwd)?;
        fs::write(self.temp_file.path(), decrypted_bytes)?;
        verify_sqlite_master(self.temp_file.path())?;
        self.is_modified = false;
        Ok(())
    }

    /// Restituisce il percorso del file SQLite temporaneo decifrato (su cui connettere rusqlite)
    pub fn temp_db_path(&self) -> &Path {
        self.temp_file.path()
    }

    /// Segna il database come modificato (richiederà re-cifratura al commit)
    pub fn mark_modified(&mut self) {
        self.is_modified = true;
    }

    /// Salva e ricifra atomicamente il database SQLite nel file di destinazione .emb
    pub fn flush_to_emb(&mut self) -> Result<(), SyncError> {
        if !self.is_modified {
            return Ok(());
        }

        let pwd = self.password.as_deref().ok_or_else(|| {
            SyncError::Crypto(crate::i18n::t("crypto.cannot_save_missing_pwd").to_string())
        })?;

        let mut decrypted_bytes = Vec::new();
        File::open(self.temp_file.path())?.read_to_end(&mut decrypted_bytes)?;

        // Verifica che il file temporaneo sia ancora un SQLite valido
        if decrypted_bytes.len() < SQLCIPHER_PAGE_SIZE || &decrypted_bytes[..16] != SQLITE_MAGIC {
            return Err(SyncError::Crypto(
                crate::i18n::t("crypto.invalid_sqlite_temp").to_string(),
            ));
        }

        let encrypted_bytes = encrypt_sqlite_bytes_with_salt(&decrypted_bytes, pwd, &self.salt)?;

        // Scrittura atomica tramite file temporaneo nella stessa directory del file .emb
        let parent_dir = self.emb_path.parent().unwrap_or_else(|| Path::new("."));
        let mut atomic_temp = NamedTempFile::new_in(parent_dir)?;
        atomic_temp.write_all(&encrypted_bytes)?;
        atomic_temp.flush()?;

        atomic_temp
            .persist(&self.emb_path)
            .map_err(|e| SyncError::Io(e.error))?;

        self.is_modified = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_is_emb_path() {
        assert!(is_emb_path(Path::new("test.emb")));
        assert!(is_emb_path(Path::new("/path/to/my_data.EMB")));
        assert!(!is_emb_path(Path::new("test.mmb")));
        assert!(!is_emb_path(Path::new("test.sqlite")));
    }

    #[test]
    fn test_encrypt_decrypt_sqlite_roundtrip() {
        let initial_sqlite = create_empty_sqlcipher_sqlite_page();

        let password = "SecretPassword123!";
        let encrypted = encrypt_sqlite_bytes(&initial_sqlite, password).expect("encrypt");
        assert_eq!(encrypted.len(), SQLCIPHER_PAGE_SIZE);
        assert_ne!(&encrypted[..], &initial_sqlite[..]);
        // I primi 16 byte del file cifrato sono il salt casuale, non l'header SQLite in chiaro
        assert_ne!(&encrypted[..16], SQLITE_MAGIC);

        let decrypted = decrypt_sqlite_bytes(&encrypted, password).expect("decrypt");
        assert_eq!(decrypted, initial_sqlite);
    }

    #[test]
    fn test_decrypt_with_wrong_password_fails() {
        let initial_sqlite = create_empty_sqlcipher_sqlite_page();

        let encrypted = encrypt_sqlite_bytes(&initial_sqlite, "correct_pass").expect("encrypt");
        let result = decrypt_sqlite_bytes(&encrypted, "wrong_pass");
        assert!(result.is_err());
    }

    #[test]
    fn test_decrypt_tampered_hmac_fails() {
        let initial_sqlite = create_empty_sqlcipher_sqlite_page();
        let mut encrypted = encrypt_sqlite_bytes(&initial_sqlite, "correct_pass").expect("encrypt");

        // Alteriamo 1 byte nel tag HMAC-SHA512 a fine pagina
        encrypted[SQLCIPHER_PAGE_SIZE - 1] ^= 0x01;
        let result = decrypt_sqlite_bytes(&encrypted, "correct_pass");
        assert!(result.is_err());
    }

    #[test]
    fn test_emb_handler_lifecycle_with_real_sqlite_queries() {
        let dir = tempdir().expect("tempdir");
        let emb_path = dir.path().join("wallet.emb");
        let password = "WalletPassword456";

        // 1. Creazione iniziale e popolamento tramite rusqlite reale
        let mut handler = EmbDatabaseHandler::open_or_create(&emb_path, Some(password), true)
            .expect("open_or_create");

        {
            let conn = Connection::open(handler.temp_db_path()).expect("open temp sqlite");
            conn.execute_batch(
                "CREATE TABLE INFOTABLE_V1 (INFOID INTEGER PRIMARY KEY, INFONAME TEXT, INFOVALUE TEXT);
                 INSERT INTO INFOTABLE_V1 (INFONAME, INFOVALUE) VALUES ('DATAVERSION', '3');",
            )
            .expect("create and insert");
        }

        handler.mark_modified();
        handler.flush_to_emb().expect("flush_to_emb");
        assert!(emb_path.exists());

        // Verifica che il file su disco sia cifrato (non inizia con SQLite format 3)
        let raw_emb = fs::read(&emb_path).expect("read emb");
        assert!(raw_emb.len() >= SQLCIPHER_PAGE_SIZE);
        assert_eq!(raw_emb.len() % SQLCIPHER_PAGE_SIZE, 0);
        assert_ne!(&raw_emb[..16], SQLITE_MAGIC);

        // 2. Riapertura del file .emb e verifica query su sqlite_master e INFOTABLE_V1
        let reopen_handler =
            EmbDatabaseHandler::open_or_create(&emb_path, Some(password), false).expect("reopen");
        let conn = Connection::open(reopen_handler.temp_db_path()).expect("open reopened sqlite");
        let val: String = conn
            .query_row(
                "SELECT INFOVALUE FROM INFOTABLE_V1 WHERE INFONAME = 'DATAVERSION'",
                [],
                |r| r.get(0),
            )
            .expect("query INFOVALUE");
        assert_eq!(val, "3");

        // Verifica che i byte riservati per pagina nell'header SQLite siano rimasti 80 (0x50)
        let plain_bytes = fs::read(reopen_handler.temp_db_path()).expect("read plain temp");
        assert_eq!(plain_bytes[20], RESERVE_SIZE as u8);

        // 3. Verifica che l'apertura con password errata fallisca
        let wrong_pwd = EmbDatabaseHandler::open_or_create(&emb_path, Some("wrong"), false);
        assert!(wrong_pwd.is_err());
    }
}
