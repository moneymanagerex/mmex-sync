use std::path::{Path, PathBuf};
use std::process::Command;

use crate::config::expand_tilde;

/// Rappresenta un comando di lancio per Money Manager Ex (percorso diretto o comando + argomenti, es. Flatpak)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LauncherCommand {
    pub program: String,
    pub args: Vec<String>,
}

impl LauncherCommand {
    /// Esegue il parsing di una stringa configurata dall'utente (percorso file o comando shell-like).
    pub fn parse(raw: &str) -> Option<Self> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }

        // Se l'intera stringa punta a un file esistente su disco, evita lo split su spazi
        // (gestisce percorsi Windows tipo "C:\Program Files\Money Manager EX\bin\mmex.exe" senza virgolette).
        let direct_path = expand_tilde(Path::new(trimmed));
        if direct_path.exists() && direct_path.is_file() {
            return Some(Self {
                program: direct_path.to_string_lossy().to_string(),
                args: Vec::new(),
            });
        }

        // Altrimenti, effettua il token split rispettando apici singoli e doppi
        let tokens = tokenize_command(trimmed);
        let first = tokens.first()?;
        let expanded_prog = expand_tilde(Path::new(first));
        let program = expanded_prog.to_string_lossy().to_string();
        let args = tokens.into_iter().skip(1).collect();

        Some(Self { program, args })
    }

    /// Verifica se il binario/programma principale è raggiungibile su disco o tramite la variabile PATH.
    pub fn is_available(&self) -> bool {
        if self.program.is_empty() {
            return false;
        }
        let path = Path::new(&self.program);
        if path.is_absolute() || self.program.contains('/') || self.program.contains('\\') {
            let expanded = expand_tilde(path);
            expanded.exists() && expanded.is_file()
        } else {
            which(&self.program)
        }
    }

    /// Restituisce una rappresentazione leggibile dell'intero comando configurato (senza il db_path).
    pub fn display_command(&self) -> String {
        if self.args.is_empty() {
            self.program.clone()
        } else {
            format!("{} {}", self.program, self.args.join(" "))
        }
    }

    /// Prepara il `std::process::Command` pronto per l'esecuzione con il file database accodato.
    pub fn build_command(&self, db_path: &Path) -> Command {
        let mut cmd = Command::new(&self.program);
        cmd.args(&self.args);
        cmd.arg(db_path);
        cmd
    }
}

/// Suddivide una stringa di comando in token rispettando apici singoli (`'...'`) e doppi (`"..."`),
/// preservando i backslash dei percorsi Windows (tranne `\"` all'interno di doppi apici).
pub fn tokenize_command(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut has_token = false;

    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\'' if !in_double_quote => {
                in_single_quote = !in_single_quote;
                has_token = true;
            }
            '"' if !in_single_quote => {
                in_double_quote = !in_double_quote;
                has_token = true;
            }
            '\\' if in_double_quote => {
                if let Some(&'"') = chars.peek() {
                    let _ = chars.next();
                    current.push('"');
                } else {
                    current.push('\\');
                }
                has_token = true;
            }
            c if c.is_whitespace() && !in_single_quote && !in_double_quote => {
                if has_token {
                    tokens.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            c => {
                current.push(c);
                has_token = true;
            }
        }
    }

    if has_token {
        tokens.push(current);
    }

    tokens
}

/// Cerca un eseguibile nelle directory elencate nella variabile d'ambiente `PATH`.
pub fn find_in_path(program: &str) -> Option<PathBuf> {
    if program.trim().is_empty() {
        return None;
    }

    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(program);
        if candidate.exists() && candidate.is_file() {
            return Some(candidate);
        }

        if cfg!(target_os = "windows") && !program.to_lowercase().ends_with(".exe") {
            let candidate_exe = dir.join(format!("{}.exe", program));
            if candidate_exe.exists() && candidate_exe.is_file() {
                return Some(candidate_exe);
            }
        }
    }

    None
}

/// Restituisce `true` se `program` è presente nella variabile d'ambiente `PATH`.
pub fn which(program: &str) -> bool {
    find_in_path(program).is_some()
}

/// Rileva automaticamente la presenza di un'installazione di MMEX sul sistema operativo host.
pub fn auto_detect_mmex() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        // 1. Cerca mmex.exe nel PATH
        if let Some(found) = find_in_path("mmex.exe") {
            return Some(found.to_string_lossy().to_string());
        }

        // 2. Cartelle Program Files, Program Files (x86), LocalAppData
        let mut candidates = Vec::new();
        for env_key in &["ProgramFiles", "ProgramFiles(x86)"] {
            if let Ok(base) = std::env::var(env_key) {
                candidates.push(format!(r"{}\Money Manager EX\bin\mmex.exe", base));
                candidates.push(format!(r"{}\MoneyManagerEx\bin\mmex.exe", base));
            }
        }
        if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
            candidates.push(format!(
                r"{}\Programs\Money Manager EX\bin\mmex.exe",
                local_appdata
            ));
            candidates.push(format!(
                r"{}\Programs\MoneyManagerEx\bin\mmex.exe",
                local_appdata
            ));
        }
        candidates.push(r"C:\Program Files\Money Manager EX\bin\mmex.exe".to_string());
        candidates.push(r"C:\Program Files (x86)\Money Manager EX\bin\mmex.exe".to_string());

        for candidate in candidates {
            let p = Path::new(&candidate);
            if p.exists() && p.is_file() {
                return Some(candidate);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // 1. Verifica Flatpak (filesystem check o comando flatpak info per org.moneymanagerex.MMEX)
        let home = dirs::home_dir().unwrap_or_default();
        let flatpak_user = home.join(".local/share/flatpak/app/org.moneymanagerex.MMEX");
        let flatpak_system = Path::new("/var/lib/flatpak/app/org.moneymanagerex.MMEX");

        let flatpak_installed = flatpak_user.exists()
            || flatpak_system.exists()
            || (which("flatpak")
                && Command::new("flatpak")
                    .args(["info", "org.moneymanagerex.MMEX"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false));

        if flatpak_installed {
            return Some("flatpak run org.moneymanagerex.MMEX".to_string());
        }

        // 2. Cerca nel PATH
        if let Some(found) = find_in_path("mmex") {
            return Some(found.to_string_lossy().to_string());
        }

        // 3. Percorsi standard Linux
        for path in &["/usr/bin/mmex", "/usr/local/bin/mmex", "/snap/bin/mmex"] {
            let p = Path::new(path);
            if p.exists() && p.is_file() {
                return Some((*path).to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        for path in &[
            "/Applications/MoneyManagerEx.app/Contents/MacOS/mmex",
            "~/Applications/MoneyManagerEx.app/Contents/MacOS/mmex",
        ] {
            let expanded = expand_tilde(Path::new(path));
            if expanded.exists() && expanded.is_file() {
                return Some(expanded.to_string_lossy().to_string());
            }
        }
        if let Some(found) = find_in_path("mmex") {
            return Some(found.to_string_lossy().to_string());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_launcher_parse_direct_path_with_spaces() {
        let dir = tempdir().expect("create temp dir");
        let sub = dir.path().join("Money Manager EX").join("bin");
        fs::create_dir_all(&sub).expect("create subdirs");
        let fake_exe = sub.join("mmex.exe");
        fs::write(&fake_exe, b"binary").expect("write fake exe");

        let raw = fake_exe.to_string_lossy().to_string();
        let parsed = LauncherCommand::parse(&raw).expect("parse direct path");
        assert_eq!(parsed.program, raw);
        assert!(parsed.args.is_empty());
        assert!(parsed.is_available());
    }

    #[test]
    fn test_launcher_parse_flatpak_command() {
        let parsed = LauncherCommand::parse("flatpak run org.moneymanagerex.MMEX")
            .expect("parse flatpak command");
        assert_eq!(parsed.program, "flatpak");
        assert_eq!(parsed.args, vec!["run", "org.moneymanagerex.MMEX"]);
        assert_eq!(
            parsed.display_command(),
            "flatpak run org.moneymanagerex.MMEX"
        );
    }

    #[test]
    fn test_launcher_parse_with_quotes() {
        let parsed = LauncherCommand::parse(r#""/opt/my app/mmex" --custom-flag "some value""#)
            .expect("parse quoted command");
        assert_eq!(parsed.program, "/opt/my app/mmex");
        assert_eq!(parsed.args, vec!["--custom-flag", "some value"]);
    }

    #[test]
    fn test_launcher_parse_windows_quoted_path_preserves_backslashes() {
        let parsed = LauncherCommand::parse(
            r#""C:\Program Files\Money Manager EX\bin\mmex.exe" --portable"#,
        )
        .expect("parse windows quoted path");
        assert_eq!(
            parsed.program,
            r"C:\Program Files\Money Manager EX\bin\mmex.exe"
        );
        assert_eq!(parsed.args, vec!["--portable"]);
    }

    #[test]
    fn test_launcher_path_lookup() {
        #[cfg(unix)]
        {
            let cmd = LauncherCommand::parse("sh -c").expect("parse sh");
            assert!(cmd.is_available());
        }
        #[cfg(windows)]
        {
            let cmd = LauncherCommand::parse("cmd /C").expect("parse cmd");
            assert!(cmd.is_available());
        }

        let missing =
            LauncherCommand::parse("non_existent_mmex_binary_xyz_999").expect("parse missing");
        assert!(!missing.is_available());
    }

    #[test]
    fn test_launcher_build_command() {
        let parsed = LauncherCommand::parse("flatpak run org.moneymanagerex.MMEX")
            .expect("parse flatpak command");
        let db_path = Path::new("/tmp/my_accounts.mmb");
        let cmd = parsed.build_command(db_path);

        assert_eq!(cmd.get_program(), "flatpak");
        let args: Vec<String> = cmd
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert_eq!(
            args,
            vec!["run", "org.moneymanagerex.MMEX", "/tmp/my_accounts.mmb"]
        );
    }
}
