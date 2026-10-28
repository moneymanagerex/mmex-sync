use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use sha2::{Sha256, Sha512};
use tempfile::NamedTempFile;

use crate::error::SyncError;

type Aes256CbcEnc = cbc::Encryptor<aes::Aes256>;
type Aes256CbcDec = cbc::Decryptor<aes::Aes256>;

pub const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
const SALT_SIZE: usize = 16;
const IV_SIZE: usize = 16;
const KEY_SIZE: usize = 32;

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

/// Cifra un buffer di byte contenente un database SQLite in formato .emb (AES-256-CBC con salt e IV)
pub fn encrypt_sqlite_bytes(plaintext: &[u8], password: &str) -> Result<Vec<u8>, SyncError> {
    let mut salt = [0u8; SALT_SIZE];
    OsRng.fill_bytes(&mut salt);

    let mut iv = [0u8; IV_SIZE];
    OsRng.fill_bytes(&mut iv);

    // Iterazioni PBKDF2 (compatibile e robusto)
    let key = derive_key(password, &salt, 64_000);

    let encryptor = Aes256CbcEnc::new_from_slices(&key, &iv)
        .map_err(|e| SyncError::Crypto(crate::i18n::t_fmt("crypto.aes_cbc_init_failed", &[("error", &e.to_string())])))?;

    // Calcolo dimensione con padding PKCS#7
    let mut ciphertext = vec![0u8; plaintext.len() + 16];
    let encrypted_len = encryptor
        .encrypt_padded_b2b_mut::<Pkcs7>(plaintext, &mut ciphertext)
        .map_err(|e| SyncError::Crypto(crate::i18n::t_fmt("crypto.db_encryption_failed", &[("error", &e.to_string())])))?
        .len();
    ciphertext.truncate(encrypted_len);

    // Formato payload contenitore: [SALT 16 byte] + [IV 16 byte] + [CIPHERTEXT]
    let mut result = Vec::with_capacity(SALT_SIZE + IV_SIZE + ciphertext.len());
    result.extend_from_slice(&salt);
    result.extend_from_slice(&iv);
    result.extend_from_slice(&ciphertext);

    Ok(result)
}

/// Decifra i byte di un database .emb verificando che il risultato sia un database SQLite valido
pub fn decrypt_sqlite_bytes(encrypted: &[u8], password: &str) -> Result<Vec<u8>, SyncError> {
    if encrypted.len() < (SALT_SIZE + IV_SIZE + 16) {
        return Err(SyncError::Crypto(
            crate::i18n::t("crypto.file_corrupted").to_string(),
        ));
    }

    let salt = &encrypted[..SALT_SIZE];
    let iv = &encrypted[SALT_SIZE..SALT_SIZE + IV_SIZE];
    let ciphertext = &encrypted[SALT_SIZE + IV_SIZE..];

    // Tentativo 1: PBKDF2-HMAC-SHA256 (64,000 iterazioni - contenitore standard)
    let key_sha256 = derive_key(password, salt, 64_000);
    if let Ok(decryptor) = Aes256CbcDec::new_from_slices(&key_sha256, iv) {
        let mut buf = vec![0u8; ciphertext.len()];
        if let Ok(pt) = decryptor.decrypt_padded_b2b_mut::<Pkcs7>(ciphertext, &mut buf) {
            if pt.len() >= 16 && &pt[..16] == SQLITE_MAGIC {
                return Ok(pt.to_vec());
            }
        }
    }

    // Tentativo 2: PBKDF2-HMAC-SHA512 (256,000 iterazioni - SQLCipher default)
    let key_sha512 = derive_key_sha512(password, salt, 256_000);
    if let Ok(decryptor) = Aes256CbcDec::new_from_slices(&key_sha512, iv) {
        let mut buf = vec![0u8; ciphertext.len()];
        if let Ok(pt) = decryptor.decrypt_padded_b2b_mut::<Pkcs7>(ciphertext, &mut buf) {
            if pt.len() >= 16 && &pt[..16] == SQLITE_MAGIC {
                return Ok(pt.to_vec());
            }
        }
    }

    // Tentativo 3: PBKDF2-HMAC-SHA256 con 4,001 iterazioni (wxSQLite3 / legacy)
    let key_legacy = derive_key(password, salt, 4_001);
    if let Ok(decryptor) = Aes256CbcDec::new_from_slices(&key_legacy, iv) {
        let mut buf = vec![0u8; ciphertext.len()];
        if let Ok(pt) = decryptor.decrypt_padded_b2b_mut::<Pkcs7>(ciphertext, &mut buf) {
            if pt.len() >= 16 && &pt[..16] == SQLITE_MAGIC {
                return Ok(pt.to_vec());
            }
        }
    }

    Err(SyncError::Crypto(
        crate::i18n::t("crypto.decryption_failed").to_string(),
    ))
}

/// Gestore del ciclo di vita del database cifrato .emb
/// Mantiene il database temporaneo decifrato e si occupa della ricifratura atomica su salvataggio
pub struct EmbDatabaseHandler {
    emb_path: PathBuf,
    password: Option<String>,
    temp_file: NamedTempFile,
    is_modified: bool,
}

impl EmbDatabaseHandler {
    /// Inizializza l'handler decifrando il file .emb esistente o creando un file temporaneo per nuovo DB
    pub fn open_or_create(emb_path: &Path, password: Option<&str>, create: bool) -> Result<Self, SyncError> {
        let temp_file = NamedTempFile::new()?;

        if emb_path.exists() && !create {
            let pwd = password.ok_or_else(|| {
                SyncError::Crypto(crate::i18n::t_fmt(
                    "crypto.password_required",
                    &[("path", &emb_path.display().to_string())],
                ))
            })?;

            let mut raw_bytes = Vec::new();
            File::open(emb_path)?.read_to_end(&mut raw_bytes)?;

            let decrypted_bytes = decrypt_sqlite_bytes(&raw_bytes, pwd)?;
            fs::write(temp_file.path(), decrypted_bytes)?;
        }

        Ok(Self {
            emb_path: emb_path.to_path_buf(),
            password: password.map(|s| s.to_string()),
            temp_file,
            is_modified: false,
        })
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
        if decrypted_bytes.len() < 16 || &decrypted_bytes[..16] != SQLITE_MAGIC {
            return Err(SyncError::Crypto(
                crate::i18n::t("crypto.invalid_sqlite_temp").to_string(),
            ));
        }

        let encrypted_bytes = encrypt_sqlite_bytes(&decrypted_bytes, pwd)?;

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
        // Simuliamo un header SQLite valido
        let mut fake_sqlite = Vec::from(*SQLITE_MAGIC);
        fake_sqlite.extend_from_slice(b"fake database content 1234567890");

        let password = "SecretPassword123!";
        let encrypted = encrypt_sqlite_bytes(&fake_sqlite, password).expect("encrypt");
        assert_ne!(encrypted, fake_sqlite);

        let decrypted = decrypt_sqlite_bytes(&encrypted, password).expect("decrypt");
        assert_eq!(decrypted, fake_sqlite);
    }

    #[test]
    fn test_decrypt_with_wrong_password_fails() {
        let mut fake_sqlite = Vec::from(*SQLITE_MAGIC);
        fake_sqlite.extend_from_slice(b"fake database content");

        let encrypted = encrypt_sqlite_bytes(&fake_sqlite, "correct_pass").expect("encrypt");
        let result = decrypt_sqlite_bytes(&encrypted, "wrong_pass");
        assert!(result.is_err());
    }

    #[test]
    fn test_emb_handler_lifecycle() {
        let dir = tempdir().expect("tempdir");
        let emb_path = dir.path().join("wallet.emb");
        let password = "WalletPassword456";

        // 1. Creazione iniziale
        let mut handler = EmbDatabaseHandler::open_or_create(&emb_path, Some(password), true)
            .expect("open_or_create");

        // Scriviamo un database finto nel file temporaneo
        let mut initial_db = Vec::from(*SQLITE_MAGIC);
        initial_db.extend_from_slice(b"dummy initial table data");
        fs::write(handler.temp_db_path(), &initial_db).expect("write temp");
        handler.mark_modified();
        handler.flush_to_emb().expect("flush_to_emb");

        assert!(emb_path.exists());

        // 2. Riapertura del file .emb
        let reopen_handler = EmbDatabaseHandler::open_or_create(&emb_path, Some(password), false)
            .expect("reopen");
        let read_back = fs::read(reopen_handler.temp_db_path()).expect("read temp");
        assert_eq!(read_back, initial_db);
    }
}
