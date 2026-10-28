#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

use crate::cli::CliArgs;
use crate::error::SyncError;

const CONFIG_FILE_EXTENSION: &str = "mmex-sync.json";
const GLOBAL_CONFIG_FILENAME: &str = "mmex-sync.config.json";
const DEFAULT_SERVER_TYPE: &str = "pocketbase";

/// Configurazione globale presente in mmex-sync.config.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalConfig {
    #[serde(rename = "defaultProfile", default = "default_profile_name")]
    pub default_profile: String,

    #[serde(rename = "language", skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

fn default_profile_name() -> String {
    "default".to_string()
}

/// Contenuto salvato nel file di profilo <profile>.mmex-sync.json
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProfileConfig {
    #[serde(rename = "dbPath", skip_serializing_if = "Option::is_none")]
    pub db_path: Option<String>,

    #[serde(rename = "serverType", default = "default_server_type_fn")]
    pub server_type: Option<String>,

    #[serde(rename = "pbUrl", skip_serializing_if = "Option::is_none")]
    pub pb_url: Option<String>,

    #[serde(rename = "pbAuthCollection", skip_serializing_if = "Option::is_none")]
    pub pb_auth_collection: Option<String>,

    #[serde(rename = "pbUser", skip_serializing_if = "Option::is_none")]
    pub pb_user: Option<String>,

    #[serde(rename = "encryptedToken", skip_serializing_if = "Option::is_none")]
    pub encrypted_token: Option<String>,

    #[serde(rename = "encryptedFilePassword", skip_serializing_if = "Option::is_none")]
    pub encrypted_file_password: Option<String>,

    #[serde(rename = "mmexExe", skip_serializing_if = "Option::is_none")]
    pub mmex_exe: Option<String>,

    #[serde(rename = "defaultMode", skip_serializing_if = "Option::is_none")]
    pub default_mode: Option<String>,

    #[serde(rename = "lastSync", skip_serializing_if = "Option::is_none")]
    pub last_sync: Option<String>,

    #[serde(rename = "isRunning", default)]
    pub is_running: bool,

    #[serde(rename = "savePassword", skip_serializing_if = "Option::is_none")]
    pub save_password: Option<String>,
}

fn default_server_type_fn() -> Option<String> {
    Some(DEFAULT_SERVER_TYPE.to_string())
}

/// Configurazione finale risolta (CLI > ENV > Profilo JSON > Default)
#[derive(Debug, Clone)]
pub struct EffectiveConfig {
    pub profile: String,
    pub db_path: PathBuf,
    pub file_password: Option<String>,
    pub save_file_password: bool,
    pub server_type: String,
    pub url: String,
    pub user: Option<String>,
    pub pass: Option<String>,
    pub token: Option<String>,
    pub auth_collection: Option<String>,
    pub mmex_exe: Option<PathBuf>,
    pub default_mode: String,
    pub last_sync: Option<String>,
    pub is_running: bool,
    pub verbose: bool,
    pub force: bool,
}

/// Restituisce la directory di configurazione dell'utente
pub fn get_config_dir() -> Result<PathBuf, SyncError> {
    let home = dirs::home_dir().ok_or_else(|| {
        SyncError::Config(crate::i18n::t("errors.home_not_found").to_string())
    })?;

    let dir = if cfg!(target_os = "windows") {
        dirs::data_dir()
            .unwrap_or_else(|| home.join("AppData").join("Roaming"))
            .join("mmex-sync")
    } else {
        home.join(".mmex-sync")
    };

    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }

    Ok(dir)
}

/// Espande la tilde iniziale (`~`) con la home directory
pub fn expand_tilde(path: &Path) -> PathBuf {
    let path_str = path.to_string_lossy();
    if path_str.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            if path_str == "~" {
                return home;
            }
            if path_str.starts_with("~/") || path_str.starts_with("~\\") {
                let stripped = &path_str[2..];
                return home.join(stripped);
            }
        }
    }
    path.to_path_buf()
}

/// Gestore della configurazione dei profili
pub struct ConfigManager {
    config_dir: PathBuf,
}

impl ConfigManager {
    pub fn new() -> Result<Self, SyncError> {
        let config_dir = get_config_dir()?;
        Ok(Self { config_dir })
    }

    pub fn global_config_path(&self) -> PathBuf {
        self.config_dir.join(GLOBAL_CONFIG_FILENAME)
    }

    pub fn profile_path(&self, profile_name: &str) -> PathBuf {
        self.config_dir
            .join(format!("{}.{}", profile_name, CONFIG_FILE_EXTENSION))
    }

    pub fn load_global_config(&self) -> Result<GlobalConfig, SyncError> {
        let path = self.global_config_path();
        if path.exists() {
            let content = fs::read_to_string(&path)?;
            if let Ok(global) = serde_json::from_str::<GlobalConfig>(&content) {
                return Ok(global);
            }
        }
        Ok(GlobalConfig {
            default_profile: "default".to_string(),
            language: None,
        })
    }

    pub fn get_default_profile(&self) -> Result<String, SyncError> {
        let global = self.load_global_config()?;
        if !global.default_profile.trim().is_empty() {
            return Ok(global.default_profile.trim().to_string());
        }
        let default_name = "default".to_string();
        self.set_default_profile(&default_name)?;
        Ok(default_name)
    }

    pub fn set_default_profile(&self, name: &str) -> Result<(), SyncError> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(SyncError::Config(
                crate::i18n::t("errors.profile_name_empty").to_string(),
            ));
        }
        let mut global = self.load_global_config()?;
        global.default_profile = trimmed.to_string();
        let serialized = serde_json::to_string_pretty(&global)?;
        fs::write(self.global_config_path(), serialized)?;
        Ok(())
    }

    pub fn get_saved_language(&self) -> Option<String> {
        self.load_global_config().ok().and_then(|g| g.language)
    }

    pub fn get_language(&self) -> String {
        self.get_saved_language()
            .unwrap_or_else(|| crate::i18n::detect_best_locale(None).code().to_string())
    }

    pub fn set_language(&self, lang: &str) -> Result<(), SyncError> {
        let mut global = self.load_global_config()?;
        global.language = Some(lang.to_string());
        let serialized = serde_json::to_string_pretty(&global)?;
        fs::write(self.global_config_path(), serialized)?;
        Ok(())
    }

    pub fn list_profiles(&self) -> Result<Vec<String>, SyncError> {
        let mut profiles = Vec::new();
        let suffix = format!(".{}", CONFIG_FILE_EXTENSION);

        if self.config_dir.exists() {
            for entry in fs::read_dir(&self.config_dir)? {
                let entry = entry?;
                let file_name = entry.file_name().to_string_lossy().to_string();
                if file_name.ends_with(&suffix) {
                    let profile_name = file_name.trim_end_matches(&suffix).to_string();
                    profiles.push(profile_name);
                }
            }
        }
        profiles.sort();
        Ok(profiles)
    }

    pub fn load_profile(&self, profile_name: &str) -> Result<ProfileConfig, SyncError> {
        let path = self.profile_path(profile_name);
        if !path.exists() {
            return Ok(ProfileConfig::default());
        }
        let content = fs::read_to_string(&path)?;
        let profile = serde_json::from_str::<ProfileConfig>(&content)?;
        Ok(profile)
    }

    pub fn save_profile(&self, profile_name: &str, config: &ProfileConfig) -> Result<(), SyncError> {
        let path = self.profile_path(profile_name);
        let content = serde_json::to_string_pretty(config)?;
        fs::write(path, content)?;
        Ok(())
    }

    pub fn delete_profile(&self, profile_name: &str) -> Result<bool, SyncError> {
        let path = self.profile_path(profile_name);
        if path.exists() {
            fs::remove_file(path)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn rename_profile(&self, from: &str, to: &str) -> Result<(), SyncError> {
        let from_path = self.profile_path(from);
        let to_path = self.profile_path(to);

        if !from_path.exists() {
            return Err(SyncError::Config(crate::i18n::t_fmt(
                "errors.profile_not_found",
                &[("name", from)],
            )));
        }
        if to_path.exists() {
            return Err(SyncError::Config(crate::i18n::t_fmt(
                "errors.profile_already_exists",
                &[("name", to)],
            )));
        }

        fs::rename(from_path, to_path)?;

        // Se era il default profile, aggiorna global config
        if let Ok(default_p) = self.get_default_profile() {
            if default_p == from {
                self.set_default_profile(to)?;
            }
        }

        Ok(())
    }

    pub fn get_effective_config(&self, args: &CliArgs) -> Result<EffectiveConfig, SyncError> {
        let profile_name = match &args.profile {
            Some(p) if !p.trim().is_empty() => p.trim().to_string(),
            _ => self.get_default_profile()?,
        };

        let profile = if args.ignore_profile {
            ProfileConfig::default()
        } else {
            self.load_profile(&profile_name)?
        };

        let db_path_raw = args
            .db
            .clone()
            .or_else(|| profile.db_path.map(PathBuf::from))
            .ok_or_else(|| {
                SyncError::Config(
                    crate::i18n::t("errors.db_path_not_specified").to_string(),
                )
            })?;
        let db_path = expand_tilde(&db_path_raw);

        let server_type = args
            .server_type
            .clone()
            .or(profile.server_type)
            .unwrap_or_else(|| DEFAULT_SERVER_TYPE.to_string());

        let url = args
            .url
            .clone()
            .or(profile.pb_url)
            .unwrap_or_else(|| "http://127.0.0.1:8090".to_string());

        let user = args.user.clone().or(profile.pb_user);
        let pass = args.pass.clone();

        let mmex_exe = args
            .exe
            .clone()
            .or_else(|| profile.mmex_exe.map(PathBuf::from))
            .map(|p| expand_tilde(&p));

        let default_mode = args
            .set_default_mode
            .clone()
            .or(profile.default_mode)
            .unwrap_or_else(|| "run".to_string());

        let save_file_password = args
            .save_file_password
            .as_deref()
            .map(|v| !matches!(v.to_lowercase().as_str(), "no" | "false" | "n"))
            .unwrap_or_else(|| {
                profile
                    .save_password
                    .as_deref()
                    .map(|v| !matches!(v.to_lowercase().as_str(), "no" | "false" | "n"))
                    .unwrap_or(true)
            });

        let file_password = args.file_password.clone();

        Ok(EffectiveConfig {
            profile: profile_name,
            db_path,
            file_password,
            save_file_password,
            server_type,
            url,
            user,
            pass,
            token: None, // Verrà popolato dopo decrittazione o auth
            auth_collection: profile.pb_auth_collection,
            mmex_exe,
            default_mode,
            last_sync: profile.last_sync,
            is_running: profile.is_running,
            verbose: args.verbose,
            force: args.force,
        })
    }
}
