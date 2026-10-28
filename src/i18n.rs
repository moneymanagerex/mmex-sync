use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::OnceLock;
use serde::{Deserialize, Serialize};

// File JSON di localizzazione incorporati direttamente nel binario a tempo di compilazione
const EN_JSON: &str = include_str!("../locales/en.json");
const IT_JSON: &str = include_str!("../locales/it.json");

static EN_MAP: OnceLock<HashMap<String, String>> = OnceLock::new();
static IT_MAP: OnceLock<HashMap<String, String>> = OnceLock::new();

// Locale globale attivo (0 = En, 1 = It)
static CURRENT_LOCALE: AtomicU8 = AtomicU8::new(0);

fn parse_locale(json_content: &str) -> HashMap<String, String> {
    serde_json::from_str(json_content).unwrap_or_default()
}

pub fn get_en_map() -> &'static HashMap<String, String> {
    EN_MAP.get_or_init(|| parse_locale(EN_JSON))
}

pub fn get_it_map() -> &'static HashMap<String, String> {
    IT_MAP.get_or_init(|| parse_locale(IT_JSON))
}

/// Imposta la lingua globale attiva dell'applicazione
pub fn set_current_locale(lang: Language) {
    CURRENT_LOCALE.store(lang.as_u8(), Ordering::SeqCst);
}

/// Restituisce la lingua globale attiva dell'applicazione
pub fn current_locale() -> Language {
    Language::from_u8(CURRENT_LOCALE.load(Ordering::SeqCst))
}

/// Lingue supportate dall'applicazione
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Language {
    #[default]
    En,
    It,
}

impl Language {
    pub const fn as_u8(&self) -> u8 {
        match self {
            Language::En => 0,
            Language::It => 1,
        }
    }

    pub const fn from_u8(val: u8) -> Self {
        match val {
            1 => Language::It,
            _ => Language::En,
        }
    }

    /// Converte una stringa di codice lingua normalizzato in `Language` se supportato
    pub fn try_from_code(code: &str) -> Option<Self> {
        let normalized = normalize_locale_code(code);
        match normalized.as_str() {
            "en" => Some(Language::En),
            "it" => Some(Language::It),
            _ => None,
        }
    }

    /// Converte una stringa di codice lingua in `Language`, con fallback su `En`
    pub fn from_code(code: &str) -> Self {
        Self::try_from_code(code).unwrap_or(Language::En)
    }

    /// Codice ISO della lingua
    pub fn code(&self) -> &'static str {
        match self {
            Language::En => "en",
            Language::It => "it",
        }
    }

    /// Nome leggibile della lingua
    pub fn display_name(&self) -> &'static str {
        match self {
            Language::En => "English",
            Language::It => "Italiano",
        }
    }

    /// Traduce una chiave per la lingua selezionata con fallback automatico su en.json
    pub fn t(&self, key: &str) -> &'static str {
        translate(*self, key)
    }

    /// Traduce una chiave per la lingua selezionata e interpola parametri
    pub fn t_fmt(&self, key: &str, args: &[(&str, &str)]) -> String {
        t_fmt_lang(*self, key, args)
    }

    // --- METODI STRUTTURATI PER LA UI ---

    // Menu Bar
    pub fn menu_profiles(&self) -> &'static str { self.t("gui.menu.profiles") }
    pub fn menu_profile_new(&self) -> &'static str { self.t("gui.menu.profile.new") }
    pub fn menu_profile_open(&self) -> &'static str { self.t("gui.menu.profile.open") }
    pub fn menu_profile_save(&self) -> &'static str { self.t("gui.menu.profile.save") }
    pub fn menu_profile_save_as(&self) -> &'static str { self.t("gui.menu.profile.save_as") }
    pub fn menu_profile_rename(&self) -> &'static str { self.t("gui.menu.profile.rename") }
    pub fn menu_profile_set_default(&self) -> &'static str { self.t("gui.menu.profile.set_default") }
    pub fn menu_profile_delete(&self) -> &'static str { self.t("gui.menu.profile.delete") }
    pub fn menu_profile_exit(&self) -> &'static str { self.t("gui.menu.profile.exit") }

    pub fn menu_edit(&self) -> &'static str { self.t("gui.menu.edit") }
    pub fn menu_edit_db(&self) -> &'static str { self.t("gui.menu.edit.db") }
    pub fn menu_edit_new_db(&self) -> &'static str { self.t("gui.menu.edit.new_db") }
    pub fn menu_edit_db_pwd(&self) -> &'static str { self.t("gui.menu.edit.db_pwd") }
    pub fn menu_edit_exe(&self) -> &'static str { self.t("gui.menu.edit.exe") }
    pub fn menu_edit_remote(&self) -> &'static str { self.t("gui.menu.edit.remote") }
    pub fn menu_edit_mode(&self) -> &'static str { self.t("gui.menu.edit.mode") }

    pub fn menu_sync(&self) -> &'static str { self.t("gui.menu.sync") }
    pub fn menu_sync_all(&self) -> &'static str { self.t("gui.menu.sync.all") }
    pub fn menu_sync_push(&self) -> &'static str { self.t("gui.menu.sync.push") }
    pub fn menu_sync_pull(&self) -> &'static str { self.t("gui.menu.sync.pull") }
    pub fn menu_sync_test(&self) -> &'static str { self.t("gui.menu.sync.test") }
    pub fn menu_sync_force_mode(&self) -> &'static str { self.t("gui.menu.sync.force_mode") }

    pub fn menu_preferences(&self) -> &'static str { self.t("gui.menu.preferences") }
    pub fn menu_preferences_lang(&self) -> &'static str { self.t("gui.menu.preferences.lang") }

    pub fn menu_tools(&self) -> &'static str { self.t("gui.menu.tools") }
    pub fn menu_tools_clear_db(&self) -> &'static str { self.t("gui.menu.tools.clear_db") }
    pub fn menu_tools_clear_server(&self) -> &'static str { self.t("gui.menu.tools.clear_server") }

    pub fn menu_help(&self) -> &'static str { self.t("gui.menu.help") }
    pub fn menu_help_about(&self) -> &'static str { self.t("gui.menu.help.about") }

    // Dashboard & Sezioni
    pub fn active_profile_label(&self) -> &'static str { self.t("gui.dashboard.active_profile") }
    pub fn default_badge(&self) -> &'static str { self.t("gui.dashboard.default_badge") }
    pub fn last_sync_label(&self) -> &'static str { self.t("gui.dashboard.last_sync") }
    pub fn never(&self) -> &'static str { self.t("gui.dashboard.never") }

    pub fn section_db(&self) -> &'static str { self.t("gui.section.db") }
    pub fn section_remote(&self) -> &'static str { self.t("gui.section.remote") }
    pub fn section_runner(&self) -> &'static str { self.t("gui.section.runner") }

    // Campi
    pub fn field_db_path(&self) -> &'static str { self.t("gui.field.db_path") }
    pub fn field_db_password(&self) -> &'static str { self.t("gui.field.db_password") }
    pub fn field_save_password(&self) -> &'static str { self.t("gui.field.save_password") }
    pub fn field_server_type(&self) -> &'static str { self.t("gui.field.server_type") }
    pub fn field_server_url(&self) -> &'static str { self.t("gui.field.server_url") }
    pub fn field_server_user(&self) -> &'static str { self.t("gui.field.server_user") }
    pub fn field_server_password(&self) -> &'static str { self.t("gui.field.server_password") }
    pub fn field_auth_collection(&self) -> &'static str { self.t("gui.field.auth_collection") }
    pub fn field_mmex_exe(&self) -> &'static str { self.t("gui.field.mmex_exe") }
    pub fn field_default_mode(&self) -> &'static str { self.t("gui.field.default_mode") }

    pub fn toggle_force_mode(&self) -> &'static str { self.t("gui.toggle.force_mode") }
    pub fn toggle_verbose(&self) -> &'static str { self.t("gui.toggle.verbose") }
    pub fn toggle_auto_start(&self) -> &'static str { self.t("gui.toggle.auto_start") }

    // Pulsanti
    pub fn btn_browse(&self) -> &'static str { self.t("gui.btn.browse") }
    pub fn btn_new_db(&self) -> &'static str { self.t("gui.btn.new_db") }
    pub fn btn_stop_watch(&self) -> &'static str { self.t("gui.btn.stop_watch") }
    pub fn btn_sync_full(&self) -> &'static str { self.t("gui.btn.sync_full") }
    pub fn btn_push_only(&self) -> &'static str { self.t("gui.btn.push_only") }
    pub fn btn_pull_only(&self) -> &'static str { self.t("gui.btn.pull_only") }
    pub fn btn_test_conn(&self) -> &'static str { self.t("gui.btn.test_conn") }
    pub fn btn_save(&self) -> &'static str { self.t("gui.btn.save") }
    pub fn btn_clear_logs(&self) -> &'static str { self.t("gui.btn.clear_logs") }
    pub fn btn_ok(&self) -> &'static str { self.t("gui.btn.ok") }
    pub fn btn_cancel(&self) -> &'static str { self.t("gui.btn.cancel") }
    pub fn btn_close(&self) -> &'static str { self.t("gui.btn.close") }

    // Log Console
    pub fn log_console_title(&self) -> &'static str { self.t("gui.log.console_title") }

    // Dialoghi
    pub fn dialog_new_profile_title(&self) -> &'static str { self.t("gui.dialog.new_profile.title") }
    pub fn dialog_new_emb_pwd_title(&self) -> &'static str { self.t("gui.dialog.new_emb_pwd.title") }
    pub fn dialog_new_emb_pwd_prompt(&self) -> &'static str { self.t("gui.dialog.new_emb_pwd.prompt") }
    pub fn dialog_save_as_title(&self) -> &'static str { self.t("gui.dialog.save_as.title") }
    pub fn dialog_rename_title(&self) -> &'static str { self.t("gui.dialog.rename.title") }
    pub fn dialog_name_prompt(&self) -> &'static str { self.t("gui.dialog.name_prompt") }
    pub fn dialog_delete_confirm_title(&self) -> &'static str { self.t("gui.dialog.delete_confirm.title") }

    pub fn dialog_delete_confirm_msg(&self, name: &str) -> String {
        self.t_fmt("gui.dialog.delete_confirm.msg", &[("name", name)])
    }

    pub fn dialog_clear_db_title(&self) -> &'static str { self.t("gui.dialog.clear_db.title") }
    pub fn dialog_clear_db_msg(&self) -> &'static str { self.t("gui.dialog.clear_db.msg") }
    pub fn dialog_clear_server_title(&self) -> &'static str { self.t("gui.dialog.clear_server.title") }
    pub fn dialog_clear_server_msg(&self) -> &'static str { self.t("gui.dialog.clear_server.msg") }

    pub fn about_title(&self) -> &'static str { self.t("gui.about.title") }
    pub fn about_content(&self) -> &'static str { self.t("gui.about.content") }

    // Messaggi di stato
    pub fn msg_profile_saved(&self) -> &'static str { self.t("gui.msg.profile_saved") }
    pub fn msg_error(&self) -> &'static str { self.t("gui.msg.error") }
    pub fn msg_sync_running(&self) -> &'static str { self.t("gui.msg.sync_running") }
    pub fn msg_ready(&self) -> &'static str { self.t("gui.msg.ready") }
    pub fn msg_operation_in_progress(&self) -> &'static str { self.t("gui.msg.operation_in_progress") }
}

/// Traduce una chiave per la lingua richiesta con fallback automatico su en.json
pub fn translate(lang: Language, key: &str) -> &'static str {
    let map = match lang {
        Language::En => get_en_map(),
        Language::It => get_it_map(),
    };

    if let Some(val) = map.get(key) {
        return val.as_str();
    }

    // Fallback automatico su en.json se la chiave non è presente nella lingua corrente
    if lang != Language::En {
        if let Some(val) = get_en_map().get(key) {
            return val.as_str();
        }
    }

    // Se non trovata neppure in en.json, fallback su stringa vuota
    ""
}

/// Traduce una chiave per la lingua globale attiva
pub fn t(key: &str) -> &'static str {
    translate(current_locale(), key)
}

/// Traduce una chiave per la lingua specificata e interpola i placeholder {param}
pub fn t_fmt_lang(lang: Language, key: &str, args: &[(&str, &str)]) -> String {
    let raw = translate(lang, key);
    let mut template = if raw.is_empty() { key.to_string() } else { raw.to_string() };
    for (k, v) in args {
        template = template.replace(&format!("{{{k}}}"), v);
    }
    template
}

/// Traduce una chiave per la lingua globale attiva e interpola i placeholder {param}
pub fn t_fmt(key: &str, args: &[(&str, &str)]) -> String {
    t_fmt_lang(current_locale(), key, args)
}

/// Normalizza i codici regionali e identificatori di lingua (es. it-IT, it_IT.UTF-8 -> it)
pub fn normalize_locale_code(raw: &str) -> String {
    let clean = raw.trim();
    if clean.is_empty() {
        return String::new();
    }

    // 1. Rimuove encoding o modificatori es. ".UTF-8", ".utf8", "@euro"
    let before_dot = clean.split('.').next().unwrap_or(clean);
    let before_at = before_dot.split('@').next().unwrap_or(before_dot);

    // 2. Prende la parte prima del separatore regionale ('-' o '_')
    before_at
        .split(['-', '_'])
        .next()
        .unwrap_or(before_at)
        .to_lowercase()
}

/// Rileva la migliore lingua da utilizzare seguendo le priorità:
/// 1. Lingua impostata dall'utente nella configurazione/CLI (se presente e supportata)
/// 2. Lingua del sistema operativo tramite `sys_locale::get_locale()`, normalizzata
/// 3. Fallback automatico su `en`
pub fn detect_best_locale(user_preference: Option<&str>) -> Language {
    detect_best_locale_from(user_preference, sys_locale::get_locale().as_deref())
}

/// Helper di risoluzione locale testabile in modo deterministico
pub fn detect_best_locale_from(user_preference: Option<&str>, os_locale: Option<&str>) -> Language {
    // 1. Lingua impostata dall'utente (se presente e supportata)
    if let Some(pref) = user_preference {
        if let Some(lang) = Language::try_from_code(pref) {
            return lang;
        }
    }

    // 2. Lingua del sistema operativo normalizzata
    if let Some(os) = os_locale {
        if let Some(lang) = Language::try_from_code(os) {
            return lang;
        }
    }

    // 3. Fallback automatico su en
    Language::En
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_locale_code() {
        assert_eq!(normalize_locale_code("it"), "it");
        assert_eq!(normalize_locale_code("IT"), "it");
        assert_eq!(normalize_locale_code("it-IT"), "it");
        assert_eq!(normalize_locale_code("it_IT.UTF-8"), "it");
        assert_eq!(normalize_locale_code("it_IT@euro"), "it");
        assert_eq!(normalize_locale_code("en_US.UTF-8"), "en");
        assert_eq!(normalize_locale_code("en-GB"), "en");
        assert_eq!(normalize_locale_code("fr-FR"), "fr");
        assert_eq!(normalize_locale_code(""), "");
    }

    #[test]
    fn test_detect_best_locale_priorities() {
        assert_eq!(
            detect_best_locale_from(Some("it"), Some("en_US.UTF-8")),
            Language::It
        );
        assert_eq!(
            detect_best_locale_from(Some("it-IT"), Some("en_US.UTF-8")),
            Language::It
        );
        assert_eq!(
            detect_best_locale_from(Some("en"), Some("it_IT.UTF-8")),
            Language::En
        );
        assert_eq!(
            detect_best_locale_from(None, Some("it-IT")),
            Language::It
        );
        assert_eq!(
            detect_best_locale_from(None, Some("it_IT.UTF-8")),
            Language::It
        );
        assert_eq!(
            detect_best_locale_from(None, Some("en_US.UTF-8")),
            Language::En
        );
        assert_eq!(
            detect_best_locale_from(None, Some("fr-FR")),
            Language::En
        );
        assert_eq!(
            detect_best_locale_from(None, None),
            Language::En
        );
    }

    #[test]
    fn test_json_key_parity() {
        let en_map = get_en_map();
        let it_map = get_it_map();

        let mut missing_in_it = Vec::new();
        for key in en_map.keys() {
            if !it_map.contains_key(key) {
                missing_in_it.push(key.clone());
            }
        }

        let mut missing_in_en = Vec::new();
        for key in it_map.keys() {
            if !en_map.contains_key(key) {
                missing_in_en.push(key.clone());
            }
        }

        assert!(
            missing_in_it.is_empty(),
            "Chiavi presenti in en.json ma mancanti in it.json: {:?}",
            missing_in_it
        );
        assert!(
            missing_in_en.is_empty(),
            "Chiavi presenti in it.json ma mancanti in en.json: {:?}",
            missing_in_en
        );
        assert_eq!(
            en_map.len(),
            it_map.len(),
            "Il numero totale di chiavi deve essere identico"
        );
    }

    #[test]
    fn test_t_fmt_interpolation() {
        set_current_locale(Language::En);
        let res_en = t_fmt("cli.profile_item_default", &[("name", "work")]);
        assert_eq!(res_en, "  * work (default)");

        set_current_locale(Language::It);
        let res_it = t_fmt("cli.profile_item_default", &[("name", "work")]);
        assert_eq!(res_it, "  * work (predefinito)");

        // Multiple arguments
        let banner_it = t_fmt("cli.profile_renamed", &[("old", "home"), ("new", "casa")]);
        assert_eq!(banner_it, "✅ Profilo 'home' rinominato in 'casa'");
    }

    #[test]
    fn test_embedded_translations_integrity() {
        let it = Language::It;
        let en = Language::En;

        assert_ne!(it.menu_profiles(), en.menu_profiles());
        assert_ne!(it.menu_sync(), en.menu_sync());
        assert_ne!(it.menu_sync_force_mode(), en.menu_sync_force_mode());
        assert_ne!(it.menu_preferences(), en.menu_preferences());
        assert_ne!(it.msg_profile_saved(), en.msg_profile_saved());
        assert_ne!(it.section_db(), en.section_db());
        assert_ne!(it.about_content(), en.about_content());

        assert_eq!(it.menu_profiles(), "Profili");
        assert_eq!(en.menu_profiles(), "Profiles");
        assert_eq!(it.menu_sync_force_mode(), "Usa Modalità Forzata (Force Mode)");
        assert_eq!(en.menu_sync_force_mode(), "Use Force Mode (Ignore timestamps/dirty)");

        assert_eq!(
            it.dialog_delete_confirm_msg("famiglia"),
            "Sei sicuro di voler eliminare definitivamente il profilo 'famiglia'?"
        );
        assert_eq!(
            en.dialog_delete_confirm_msg("family"),
            "Are you sure you want to permanently delete profile 'family'?"
        );
    }

    #[test]
    fn test_fallback_on_missing_key() {
        let fallback_result = translate(Language::It, "gui.dashboard.default_badge");
        assert_eq!(fallback_result, "PREDEFINITO");

        let missing = translate(Language::It, "non_existent_key_xyz");
        assert_eq!(missing, "");
    }
}
