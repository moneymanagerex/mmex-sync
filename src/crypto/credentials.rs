use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::prelude::*;
use rand::{rngs::OsRng, RngCore};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

use crate::config::get_config_dir;
use crate::error::SyncError;

const KEY_FILENAME: &str = ".key";
const PAYLOAD_PREFIX: &str = "v1";
const IV_LENGTH: usize = 12; // 96-bit IV
const TAG_LENGTH: usize = 16; // 128-bit tag
const KEY_LENGTH: usize = 32; // 256-bit key

/// Recupera o crea la Master Key a 256 bit memorizzata in `.key`
pub fn get_or_create_master_key(config_dir: Option<&Path>) -> Result<[u8; KEY_LENGTH], SyncError> {
    let dir: PathBuf = match config_dir {
        Some(d) => d.to_path_buf(),
        None => get_config_dir()?,
    };

    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }

    let key_path = dir.join(KEY_FILENAME);
    if key_path.exists() {
        if let Ok(raw) = fs::read(&key_path) {
            if raw.len() == KEY_LENGTH {
                let mut key = [0u8; KEY_LENGTH];
                key.copy_from_slice(&raw);
                return Ok(key);
            }
        }
    }

    // Generazione nuova chiave casuale
    let mut new_key = [0u8; KEY_LENGTH];
    OsRng.fill_bytes(&mut new_key);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true).mode(0o600);
        let _ = options.open(&key_path).and_then(|mut f| {
            use std::io::Write;
            f.write_all(&new_key)
        });
    }

    #[cfg(not(unix))]
    {
        fs::write(&key_path, &new_key)?;
    }

    Ok(new_key)
}

/// Cifra una stringa usando AES-256-GCM e la master key utente
/// Formato restituito: `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`
pub fn protect(text: &str, config_dir: Option<&Path>) -> Result<String, SyncError> {
    if text.is_empty() {
        return Ok(String::new());
    }

    let master_key = get_or_create_master_key(config_dir)?;
    let mut iv = [0u8; IV_LENGTH];
    OsRng.fill_bytes(&mut iv);

    let cipher = Aes256Gcm::new_from_slice(&master_key).map_err(|e| {
        SyncError::Crypto(crate::i18n::t_fmt(
            "crypto.aes_gcm_init_failed",
            &[("error", &e.to_string())],
        ))
    })?;

    let nonce = Nonce::from_slice(&iv);
    let ciphertext_with_tag = cipher.encrypt(nonce, text.as_bytes()).map_err(|e| {
        SyncError::Crypto(crate::i18n::t_fmt(
            "crypto.gcm_encryption_failed",
            &[("error", &e.to_string())],
        ))
    })?;

    // In aes-gcm il tag di 16 byte è accodato al ciphertext
    if ciphertext_with_tag.len() < TAG_LENGTH {
        return Err(SyncError::Crypto(
            crate::i18n::t("crypto.invalid_ciphertext_len").to_string(),
        ));
    }

    let split_pos = ciphertext_with_tag.len() - TAG_LENGTH;
    let ciphertext = &ciphertext_with_tag[..split_pos];
    let tag = &ciphertext_with_tag[split_pos..];

    let iv_b64 = BASE64_STANDARD.encode(iv);
    let tag_b64 = BASE64_STANDARD.encode(tag);
    let data_b64 = BASE64_STANDARD.encode(ciphertext);

    Ok(format!(
        "{}:{}:{}:{}",
        PAYLOAD_PREFIX, iv_b64, tag_b64, data_b64
    ))
}

/// Decifra un payload cifrato `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`
pub fn unprotect(payload: &str, config_dir: Option<&Path>) -> Result<Option<String>, SyncError> {
    if payload.is_empty() {
        return Ok(None);
    }

    let parts: Vec<&str> = payload.split(':').collect();
    if parts.len() != 4 || parts[0] != PAYLOAD_PREFIX {
        return Ok(None);
    }

    let iv = match BASE64_STANDARD.decode(parts[1]) {
        Ok(v) if v.len() == IV_LENGTH => v,
        _ => return Ok(None),
    };

    let tag = match BASE64_STANDARD.decode(parts[2]) {
        Ok(t) if t.len() == TAG_LENGTH => t,
        _ => return Ok(None),
    };

    let ciphertext = match BASE64_STANDARD.decode(parts[3]) {
        Ok(c) => c,
        _ => return Ok(None),
    };

    let master_key = get_or_create_master_key(config_dir)?;
    let cipher = Aes256Gcm::new_from_slice(&master_key).map_err(|e| {
        SyncError::Crypto(crate::i18n::t_fmt(
            "crypto.aes_gcm_init_failed",
            &[("error", &e.to_string())],
        ))
    })?;

    let nonce = Nonce::from_slice(&iv);

    // Ricostruisce il payload con tag accodato
    let mut combined = ciphertext;
    combined.extend_from_slice(&tag);

    match cipher.decrypt(nonce, combined.as_ref()) {
        Ok(plaintext_bytes) => match String::from_utf8(plaintext_bytes) {
            Ok(s) => Ok(Some(s)),
            Err(_) => Ok(None),
        },
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_protect_unprotect_roundtrip() {
        let dir = tempdir().expect("tempdir");
        let secret = "SuperSecretToken_12345!@#$%^&*()";

        let encrypted = protect(secret, Some(dir.path())).expect("protect");
        assert!(encrypted.starts_with("v1:"));

        let decrypted = unprotect(&encrypted, Some(dir.path()))
            .expect("unprotect")
            .expect("some");
        assert_eq!(decrypted, secret);
    }

    #[test]
    fn test_protect_multilingual() {
        let dir = tempdir().expect("tempdir");
        let secret = "Password 🔐 con accenti: àéîôù e CJK: 财务同步";

        let encrypted = protect(secret, Some(dir.path())).expect("protect");
        let decrypted = unprotect(&encrypted, Some(dir.path()))
            .expect("unprotect")
            .expect("some");
        assert_eq!(decrypted, secret);
    }

    #[test]
    fn test_unique_iv_per_call() {
        let dir = tempdir().expect("tempdir");
        let secret = "same-token";

        let enc1 = protect(secret, Some(dir.path())).expect("protect 1");
        let enc2 = protect(secret, Some(dir.path())).expect("protect 2");
        assert_ne!(enc1, enc2);

        assert_eq!(unprotect(&enc1, Some(dir.path())).unwrap().unwrap(), secret);
        assert_eq!(unprotect(&enc2, Some(dir.path())).unwrap().unwrap(), secret);
    }

    #[test]
    fn test_tamper_detection() {
        let dir = tempdir().expect("tempdir");
        let secret = "tamper-test";
        let encrypted = protect(secret, Some(dir.path())).expect("protect");

        let mut parts: Vec<String> = encrypted.split(':').map(|s| s.to_string()).collect();
        // Manomette il ciphertext
        let mut raw_data = BASE64_STANDARD.decode(&parts[3]).expect("decode");
        raw_data[0] ^= 0xFF;
        parts[3] = BASE64_STANDARD.encode(&raw_data);
        let tampered = parts.join(":");

        let result = unprotect(&tampered, Some(dir.path())).expect("unprotect");
        assert!(result.is_none());
    }
}
