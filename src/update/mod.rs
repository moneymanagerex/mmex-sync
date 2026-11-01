use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

const DEFAULT_REPO_OWNER: &str = "moneymanagerex";
const DEFAULT_REPO_NAME: &str = "mmex-sync";

/// Rappresenta una versione SemVer (Major.Minor.Patch)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemVer {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    pub raw: String,
}

impl SemVer {
    pub fn parse(s: &str) -> Option<Self> {
        let clean = s.trim().trim_start_matches(['v', 'V']);
        let main_part = clean.split(['-', '+']).next()?;
        let parts: Vec<&str> = main_part.split('.').collect();
        if parts.is_empty() {
            return None;
        }

        let major = parts[0].parse().ok()?;
        let minor = if parts.len() > 1 {
            parts[1].parse().ok()?
        } else {
            0
        };
        let patch = if parts.len() > 2 {
            parts[2].parse().ok()?
        } else {
            0
        };

        Some(Self {
            major,
            minor,
            patch,
            raw: s.to_string(),
        })
    }

    pub fn is_newer_than(&self, other: &SemVer) -> bool {
        (self.major, self.minor, self.patch) > (other.major, other.minor, other.patch)
    }
}

/// Asset associato a una GitHub Release
#[derive(Debug, Deserialize, Clone)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

/// Risposta JSON da GitHub Releases API
#[derive(Debug, Deserialize, Clone)]
pub struct GitHubRelease {
    pub tag_name: String,
    pub html_url: String,
    pub name: Option<String>,
    pub body: Option<String>,
    pub published_at: Option<String>,
    #[serde(default)]
    pub assets: Vec<GitHubAsset>,
}

/// Informazioni sintetizzate per l'aggiornamento
#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseInfo {
    pub tag_name: String,
    pub version: String,
    pub release_name: String,
    pub body: Option<String>,
    pub html_url: String,
    pub asset_name: String,
    pub download_url: String,
    pub is_zip: bool,
    pub size: u64,
}

/// Client per il controllo e l'installazione degli aggiornamenti
pub struct UpdateService {
    client: reqwest::Client,
    repo_owner: String,
    repo_name: String,
}

impl Default for UpdateService {
    fn default() -> Self {
        Self::new(DEFAULT_REPO_OWNER, DEFAULT_REPO_NAME)
    }
}

impl UpdateService {
    pub fn new(repo_owner: &str, repo_name: &str) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        Self {
            client,
            repo_owner: repo_owner.to_string(),
            repo_name: repo_name.to_string(),
        }
    }

    /// Controlla la presenza di una nuova release su GitHub.
    /// Restituisce `Ok(Some(ReleaseInfo))` se è disponibile una versione più recente,
    /// oppure `Ok(None)` se l'applicazione è già aggiornata.
    pub async fn check_for_update(&self, current_version: &str) -> Result<Option<ReleaseInfo>> {
        let current_semver = SemVer::parse(current_version).ok_or_else(|| {
            anyhow!("Impossibile analizzare la versione corrente dell'applicazione: '{current_version}'")
        })?;

        let url = format!(
            "https://api.github.com/repos/{}/{}/releases/latest",
            self.repo_owner, self.repo_name
        );

        let user_agent = format!("mmex-sync/{}", current_version);
        let resp = self
            .client
            .get(&url)
            .header(reqwest::header::USER_AGENT, user_agent)
            .header(reqwest::header::ACCEPT, "application/vnd.github.v3+json")
            .send()
            .await
            .context("Connessione a GitHub API non riuscita")?;

        if resp.status() == reqwest::StatusCode::FORBIDDEN
            || resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
        {
            return Err(anyhow!(
                "Limite di richieste GitHub API superato (HTTP {}). Riprova più tardi.",
                resp.status()
            ));
        }

        if !resp.status().is_success() {
            return Err(anyhow!(
                "Errore durante l'interrogazione di GitHub Releases: HTTP {}",
                resp.status()
            ));
        }

        let release: GitHubRelease = resp
            .json()
            .await
            .context("Formato risposta GitHub Release non valido")?;

        let remote_semver = match SemVer::parse(&release.tag_name) {
            Some(v) => v,
            None => {
                tracing::warn!(
                    "Tag release remoto non conforme a SemVer: '{}'",
                    release.tag_name
                );
                return Ok(None);
            }
        };

        if !remote_semver.is_newer_than(&current_semver) {
            return Ok(None);
        }

        // Cerca l'asset idoneo per la piattaforma corrente
        let (asset, is_zip) = find_compatible_asset(&release.assets, std::env::consts::OS, std::env::consts::ARCH)
            .ok_or_else(|| {
                anyhow!(
                    "Nuova versione {} trovata, ma nessun pacchetto compatibile disponibile per OS: '{}' e ARCH: '{}'",
                    release.tag_name,
                    std::env::consts::OS,
                    std::env::consts::ARCH
                )
            })?;

        let release_name = release.name.unwrap_or_else(|| release.tag_name.clone());

        Ok(Some(ReleaseInfo {
            tag_name: release.tag_name.clone(),
            version: remote_semver.raw,
            release_name,
            body: release.body,
            html_url: release.html_url,
            asset_name: asset.name,
            download_url: asset.browser_download_url,
            is_zip,
            size: asset.size,
        }))
    }

    /// Scarica l'aggiornamento e aggiorna il binario in esecuzione
    pub async fn download_and_install<F>(
        &self,
        release: &ReleaseInfo,
        progress_callback: Option<F>,
    ) -> Result<PathBuf>
    where
        F: Fn(u64, u64) + Send + Sync + 'static,
    {
        let current_exe = std::env::current_exe()
            .context("Impossibile determinare il percorso dell'eseguibile corrente")?;
        let exe_dir = current_exe.parent().ok_or_else(|| {
            anyhow!("Impossibile determinare la cartella dell'eseguibile corrente")
        })?;

        // 1. Download asset con notifica di avanzamento
        let user_agent = format!("mmex-sync/{}", env!("CARGO_PKG_VERSION"));
        let mut response = self
            .client
            .get(&release.download_url)
            .header(reqwest::header::USER_AGENT, user_agent)
            .send()
            .await
            .context("Download dell'aggiornamento fallito")?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "Impossibile scaricare l'aggiornamento: HTTP {}",
                response.status()
            ));
        }

        let total_size = response.content_length().unwrap_or(release.size);
        let mut downloaded: u64 = 0;
        let mut bytes = Vec::with_capacity(if total_size > 0 {
            total_size as usize
        } else {
            1024 * 1024
        });

        while let Some(chunk) = response
            .chunk()
            .await
            .context("Errore durante lo streaming del file")?
        {
            downloaded += chunk.len() as u64;
            bytes.extend_from_slice(&chunk);
            if let Some(ref cb) = progress_callback {
                cb(downloaded, total_size);
            }
        }

        // 2. Estrazione binario da zip o uso diretto
        let binary_bytes = if release.is_zip {
            extract_binary_from_zip(&bytes, std::env::consts::OS)?
        } else {
            bytes
        };

        // 3. Scrittura su file temporaneo nella STESSA directory dell'eseguibile corrente
        // (necessario per garantire operatività sullo stesso mount/filesystem in fase di rename atomico)
        let temp_filename = format!(
            ".mmex-sync-update-{}.tmp",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );
        let temp_path = exe_dir.join(temp_filename);

        std::fs::write(&temp_path, &binary_bytes).with_context(|| {
            format!(
                "Impossibile scrivere il nuovo file binario temporaneo in '{}'. Verifica i permessi di scrittura.",
                temp_path.display()
            )
        })?;

        // Imposta permessi di esecuzione su sistemi Unix/Linux/macOS
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let perms = std::fs::Permissions::from_mode(0o755);
            if let Err(e) = std::fs::set_permissions(&temp_path, perms) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(anyhow!(
                    "Impossibile impostare i permessi di esecuzione su '{}': {}",
                    temp_path.display(),
                    e
                ));
            }
        }

        // 4. Sostituzione atomica del binario corrente
        if let Err(e) = replace_executable(&temp_path, &current_exe) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(e);
        }

        Ok(current_exe)
    }
}

/// Sostituisce il binario in esecuzione su disco in modo sicuro per piattaforma
fn replace_executable(new_bin: &Path, current_exe: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        // Su Linux/macOS, rename() su un file aperto è supportato dallo standard POSIX (sostituzione atomica del dentry)
        std::fs::rename(new_bin, current_exe).with_context(|| {
            format!(
                "Impossibile sostituire l'eseguibile '{}' con il nuovo binario. Verifica i permessi (es. sudo).",
                current_exe.display()
            )
        })?;
    }

    #[cfg(windows)]
    {
        // Su Windows un file in esecuzione non può essere sovrascritto direttamente,
        // ma PUÒ essere rinominato. Rinominiamo il corrente in .exe.old, spostiamo il nuovo e puliamo.
        let old_exe = current_exe.with_extension("exe.old");
        if old_exe.exists() {
            let _ = std::fs::remove_file(&old_exe);
        }

        std::fs::rename(current_exe, &old_exe).with_context(|| {
            format!(
                "Impossibile rinominare il vecchio eseguibile '{}' in '{}'",
                current_exe.display(),
                old_exe.display()
            )
        })?;

        if let Err(e) = std::fs::rename(new_bin, current_exe) {
            // Ripristino di emergenza
            let _ = std::fs::rename(&old_exe, current_exe);
            return Err(anyhow!(
                "Impossibile posizionare il nuovo binario in '{}': {}",
                current_exe.display(),
                e
            ));
        }
    }

    Ok(())
}

/// Rimuove eventuali file temporanei di backup (`.exe.old` o `.old`) lasciati da precedenti aggiornamenti su Windows
pub fn cleanup_old_executables() {
    if let Ok(current_exe) = std::env::current_exe() {
        let old_exe = current_exe.with_extension("exe.old");
        if old_exe.exists() {
            let _ = std::fs::remove_file(old_exe);
        }
        let old_exe2 = current_exe.with_extension("old");
        if old_exe2.exists() {
            let _ = std::fs::remove_file(old_exe2);
        }
    }
}

/// Estrae il file eseguibile da un archivio ZIP
fn extract_binary_from_zip(zip_bytes: &[u8], os: &str) -> Result<Vec<u8>> {
    let reader = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader).context("Archivio ZIP non valido o corrotto")?;

    let expected_bin = if os == "windows" {
        "mmex-sync.exe"
    } else {
        "mmex-sync"
    };

    let mut target_index: Option<usize> = None;

    for i in 0..archive.len() {
        let file = archive.by_index(i).context("Errore lettura indice ZIP")?;
        let name = file.name();

        // Ignora metadati macOS __MACOSX
        if name.starts_with("__MACOSX") || file.is_dir() {
            continue;
        }

        let filename = Path::new(name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");

        if filename.eq_ignore_ascii_case(expected_bin) {
            target_index = Some(i);
            break;
        }

        // Se su Windows finisce per .exe o su Unix non ha estensione ed è il primo eseguibile trovato
        if (os == "windows" && filename.to_lowercase().ends_with(".exe"))
            || (os != "windows" && !filename.contains('.') && target_index.is_none())
        {
            target_index = Some(i);
        }
    }

    let index = target_index.ok_or_else(|| {
        anyhow!(
            "Nessun binario eseguibile '{}' trovato all'interno dell'archivio ZIP",
            expected_bin
        )
    })?;

    let mut file = archive
        .by_index(index)
        .context("Estrazione binario fallita")?;
    let mut buffer = Vec::with_capacity(file.size() as usize);
    std::io::copy(&mut file, &mut buffer)
        .context("Errore durante la lettura del file dall'archivio ZIP")?;

    Ok(buffer)
}

/// Individua il miglior asset compatibile per l'OS e l'architettura corrente
pub fn find_compatible_asset(
    assets: &[GitHubAsset],
    os: &str,
    arch: &str,
) -> Option<(GitHubAsset, bool)> {
    let os_aliases: &[&str] = match os {
        "linux" => &["linux"],
        "windows" => &["windows", "win"],
        "macos" => &["macos", "darwin"],
        _ => &[os],
    };

    let arch_aliases: &[&str] = match arch {
        "x86_64" => &["x86_64", "amd64", "x64"],
        "aarch64" => &["aarch64", "arm64"],
        _ => &[arch],
    };

    // 1. Priorità: archivio .zip che contiene l'alias OS e (se specificato) l'architettura
    for asset in assets {
        let name_lower = asset.name.to_lowercase();
        if !name_lower.ends_with(".zip") {
            continue;
        }

        let matches_os = os_aliases.iter().any(|alias| name_lower.contains(alias));
        if matches_os {
            let matches_arch = arch_aliases
                .iter()
                .any(|arch_alias| name_lower.contains(arch_alias));
            // Se arch combacia oppure se l'asset non specifica architettura (es. mmex-sync-v0.4.0-linux.zip)
            if matches_arch
                || !name_lower.contains("x86_64")
                    && !name_lower.contains("arm64")
                    && !name_lower.contains("aarch64")
            {
                return Some((asset.clone(), true));
            }
        }
    }

    // 2. Seconda scelta: qualsiasi .zip che matcha l'OS
    for asset in assets {
        let name_lower = asset.name.to_lowercase();
        if name_lower.ends_with(".zip") && os_aliases.iter().any(|alias| name_lower.contains(alias))
        {
            return Some((asset.clone(), true));
        }
    }

    // 3. Fallback: binario standalone (non zip)
    for asset in assets {
        let name_lower = asset.name.to_lowercase();
        if name_lower.ends_with(".zip") {
            continue;
        }

        let matches_os = os_aliases.iter().any(|alias| name_lower.contains(alias));
        if matches_os {
            let matches_arch = arch_aliases
                .iter()
                .any(|arch_alias| name_lower.contains(arch_alias));
            if matches_arch {
                return Some((asset.clone(), false));
            }
        }
    }

    // 4. Ultimo fallback: qualsiasi binario che matcha l'OS
    for asset in assets {
        let name_lower = asset.name.to_lowercase();
        if !name_lower.ends_with(".zip")
            && os_aliases.iter().any(|alias| name_lower.contains(alias))
        {
            return Some((asset.clone(), false));
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_semver_parsing() {
        assert_eq!(
            SemVer::parse("v0.3.0"),
            Some(SemVer {
                major: 0,
                minor: 3,
                patch: 0,
                raw: "v0.3.0".into()
            })
        );
        assert_eq!(
            SemVer::parse("0.4.1"),
            Some(SemVer {
                major: 0,
                minor: 4,
                patch: 1,
                raw: "0.4.1".into()
            })
        );
        assert_eq!(
            SemVer::parse("v1.0.0-beta.1"),
            Some(SemVer {
                major: 1,
                minor: 0,
                patch: 0,
                raw: "v1.0.0-beta.1".into()
            })
        );
        assert_eq!(SemVer::parse("invalid"), None);
    }

    #[test]
    fn test_semver_comparison() {
        let v030 = SemVer::parse("v0.3.0").unwrap();
        let v031 = SemVer::parse("v0.3.1").unwrap();
        let v040 = SemVer::parse("0.4.0").unwrap();
        let v100 = SemVer::parse("1.0.0").unwrap();

        assert!(v031.is_newer_than(&v030));
        assert!(v040.is_newer_than(&v031));
        assert!(v100.is_newer_than(&v040));
        assert!(!v030.is_newer_than(&v030));
        assert!(!v030.is_newer_than(&v031));
    }

    #[test]
    fn test_find_compatible_asset() {
        let assets = vec![
            GitHubAsset {
                name: "mmex-sync-v0.4.0-linux.zip".into(),
                browser_download_url: "https://example.com/linux.zip".into(),
                size: 1000,
            },
            GitHubAsset {
                name: "mmex-sync-v0.4.0-win.zip".into(),
                browser_download_url: "https://example.com/win.zip".into(),
                size: 2000,
            },
            GitHubAsset {
                name: "mmex-sync-linux-x86_64".into(),
                browser_download_url: "https://example.com/linux_bin".into(),
                size: 3000,
            },
        ];

        // Linux test
        let (linux_asset, is_zip) = find_compatible_asset(&assets, "linux", "x86_64").unwrap();
        assert_eq!(linux_asset.name, "mmex-sync-v0.4.0-linux.zip");
        assert!(is_zip);

        // Windows test (matching -win.zip)
        let (win_asset, is_zip) = find_compatible_asset(&assets, "windows", "x86_64").unwrap();
        assert_eq!(win_asset.name, "mmex-sync-v0.4.0-win.zip");
        assert!(is_zip);

        // Fallback standalone when no zip exists
        let non_zip_assets = vec![GitHubAsset {
            name: "mmex-sync-linux-x86_64".into(),
            browser_download_url: "https://example.com/linux_bin".into(),
            size: 3000,
        }];
        let (bin_asset, is_zip) =
            find_compatible_asset(&non_zip_assets, "linux", "x86_64").unwrap();
        assert_eq!(bin_asset.name, "mmex-sync-linux-x86_64");
        assert!(!is_zip);
    }

    #[test]
    fn test_zip_extraction() {
        // Create an in-memory zip archive containing "mmex-sync"
        let mut buffer = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
            let options = zip::write::SimpleFileOptions::default();
            zip.start_file("mmex-sync", options).unwrap();
            zip.write_all(b"fake binary content").unwrap();
            zip.finish().unwrap();
        }

        let extracted = extract_binary_from_zip(&buffer, "linux").unwrap();
        assert_eq!(extracted, b"fake binary content");
    }
}
