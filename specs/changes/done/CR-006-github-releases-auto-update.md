# Change Request (CR): GitHub Releases Auto-Update Mechanism

> **CR ID:** `CR-006`  
> **Title:** `GitHub Releases Auto-Update Mechanism`  
> **Status:** `DONE`  
> **Created Date:** `2026-11-01`  
> **Target Version:** `v0.4.0`  
> **Affected Baseline Specs:** `specs/as-is/00-architecture-and-ui.md`

---

## 1. Context & Motivation (Why)

Attualmente, l'applicazione `mmex-sync` non dispone di un meccanismo attivo per la ricerca e l'installazione automatica o semi-automatica degli aggiornamenti software.
Nella specifica di base `specs/as-is/00-architecture-and-ui.md` (sezione *Tabella Completa Argomenti CLI*), sono presenti due argomenti placeholder non ancora cablati:
- `--checkForUpdate`: presente in `CliArgs` ma privo di implementazione.
- `--autoDownloadUpdate`: presente in `CliArgs` ma non implementato e con una semantica non allineata al flusso utente desiderato.

Questo cambiamento implementa l'infrastruttura completa di auto-aggiornamento interrogando le **GitHub Releases** ufficiali (`moneymanagerex/mmex-sync`), fornendo sia il controllo che l'installazione sia da interfaccia a riga di comando (CLI) sia tramite la GUI (menu *Strumenti* / *Tools*), con supporto all'estrazione di archivi `.zip` e alla sostituzione a caldo del binario in esecuzione su Linux, Windows e macOS.

---

## 2. Proposed Functional Changes (What)

### 2.1 CLI & Argomenti di Comando
1. **Rimozione di `--autoDownloadUpdate`:**
   - Il flag obsoleto `--autoDownloadUpdate` viene rimosso da `CliArgs`.
2. **Implementazione di `--checkForUpdate`:**
   - Interroga l'API di GitHub Releases (`https://api.github.com/repos/moneymanagerex/mmex-sync/releases/latest`).
   - Confronta la versione corrente dell'applicazione (`CARGO_PKG_VERSION`) con il tag remoto della release (es. `v0.4.0`).
   - Stampa a video lo stato:
     - Se aggiornato: `MMEX-Sync è già aggiornato alla versione più recente (vX.Y.Z).`
     - Se è disponibile un aggiornamento: stampa la nuova versione, la data di rilascio, le note di rilascio sintetiche e l'URL dell'asset.
3. **Aggiunta di `--downloadUpdate`:**
   - Nuovo flag CLI `#[arg(long = "downloadUpdate")] pub download_update: bool`.
   - Se specificato, esegue il controllo versione e, qualora sia presente una nuova versione compatibile con la piattaforma corrente, scarica l'asset, estrae l'eseguibile (se archivio `.zip`), sostituisce il binario locale in esecuzione e notifica l'avvenuto completamento.

### 2.2 Convenzione Naming Asset GitHub Releases
Il meccanismo di aggiornamento cerca gli asset associati alla release secondo la seguente convenzione:
- **Archivio compresso (principale e retrocompatibilità legacy):**
  - Formato: `mmex-sync-v<version>-<os>.zip` (es. `mmex-sync-v0.4.0-linux.zip`, `mmex-sync-v0.4.0-windows.zip` / `mmex-sync-v0.4.0-win.zip`, `mmex-sync-v0.4.0-macos.zip`).
  - Nota di retrocompatibilità: il vecchio client JS (commit legacy) cercava asset con suffisso `-win.zip`, `-linux.zip`, `-macos.zip`. La pipeline di rilascio (`release.yml`) include il supporto commentato per generare entrambi gli alias Windows (`-win.zip` e `-windows.zip`).
  - Struttura interna allo zip: binario eseguibile senza prefisso/suffisso di versione né OS:
    - Su Linux/macOS: `mmex-sync`
    - Su Windows: `mmex-sync.exe`
- **Binario standalone (fallback):**
  - Formato: `mmex-sync-v<version>-<os>` o `mmex-sync-v<version>-<os>.exe`.

### 2.3 Integrazione Grafica GUI (`src/gui/app.rs`)
1. **Menu Strumenti / Tools:**
   - Aggiunta della voce di menu **"Verifica e Aggiorna..."** (`gui.menu.tools.check_update`).
2. **Flusso Utente e Modale di Aggiornamento:**
   - Al click, viene avviato un task asincrono in background che interroga le API di GitHub.
   - Durante il controllo, la GUI mostra un indicatore di caricamento o messaggio di stato nella status bar ("Verifica disponibilità aggiornamenti...").
   - **Esito 1 - Nessun aggiornamento:** compare un dialogo informativo modale: *"Sei già all'ultima versione disponibile (vX.Y.Z)"*.
   - **Esito 2 - Aggiornamento disponibile:** si apre un dialogo modale dedicato (**"Aggiornamento Disponibile"**) con:
     - Versione attuale vs Nuova versione disponibile.
     - Note di rilascio / Changelog (se disponibili).
     - Pulsante **"Scarica e Installa"** (`gui.update.btn.download_install`).
     - Pulsante **"Annulla"** (`gui.update.btn.cancel`).
   - **Fase di Installazione:**
     - Download con indicazione di avanzamento.
     - Estrazione e sostituzione dell'eseguibile.
     - Messaggio finale con opzione per riavviare l'applicazione o chiuderla.
3. **Gestione Errori:**
   - Assenza di connessione di rete, timeout, rate-limit API di GitHub (403), o permessi file insufficienti (es. installazione di sistema in `/usr/bin` senza privilegi di root): visualizzazione di un messaggio d'errore descrittivo ed elegante sia in console sia nella GUI.

### 2.4 Localizzazione (`locales/en.json`, `locales/it.json`, `src/i18n.rs`)
Aggiunta delle nuove chiavi di traduzione (con parità 100% IT / EN):
- `gui.menu.tools.check_update`
- `gui.update.modal.title`
- `gui.update.modal.checking`
- `gui.update.modal.up_to_date`
- `gui.update.modal.available_title`
- `gui.update.modal.available_body`
- `gui.update.modal.downloading`
- `gui.update.modal.install_success`
- `gui.update.modal.install_error`
- `gui.update.btn.download_install`
- `gui.update.btn.restart`
- `gui.update.btn.close`

---

## 3. Technical Design & Affected Modules (How)

### 3.1 Nuova dipendenza `zip` in `Cargo.toml`
Per supportare l'estrazione degli archivi compresi `.zip` senza dipendenze native di sistema (pure Rust):
```toml
[dependencies]
zip = { version = "2.2", default-features = false, features = ["deflate"] }
```

### 3.2 Moduli Impattati

| File / Modulo | Modifica Pianificata |
| :--- | :--- |
| `Cargo.toml` | Aggiunta dipendenza `zip` (con feature pure-Rust `deflate`). |
| `src/update/mod.rs` *(nuovo)* | Nuovo modulo dedicato alla gestione del ciclo di vita degli aggiornamenti (client API GitHub, confronto SemVer, download, unzipping e sostituzione binario). |
| `src/cli.rs` | Rimosso `--autoDownloadUpdate`, mantenuto `--checkForUpdate`, aggiunto `--downloadUpdate`. |
| `src/main.rs` | Routing ed esecuzione della logica CLI di update prima del ciclo principale (`handle_update_commands`). |
| `src/gui/app.rs` | Voce menu *Strumenti -> Verifica e Aggiorna...*, gestione stato asincrono `UpdateState`, modale di notifica/conferma/installazione e pulsante di riavvio. |
| `src/i18n.rs` | Metodi helper per le nuove chiavi i18n del modulo update. |
| `locales/en.json` | Chiavi di traduzione in lingua inglese per menu, modali e messaggi di update. |
| `locales/it.json` | Chiavi di traduzione in lingua italiana per menu, modali e messaggi di update. |
| `specs/as-is/00-architecture-and-ui.md` | Aggiornamento documentazione flag CLI e menu Strumenti. |

### 3.3 Dettagli Architetturali del Modulo `src/update/`

```rust
pub struct ReleaseInfo {
    pub tag_name: String,
    pub version: String,
    pub body: Option<String>,
    pub html_url: String,
    pub asset_name: String,
    pub download_url: String,
    pub is_zip: bool,
}

pub struct UpdateChecker {
    client: reqwest::Client,
    repo_owner: String,
    repo_name: String,
}

impl UpdateChecker {
    pub fn new() -> Self;
    pub async fn check_latest_release(&self) -> Result<Option<ReleaseInfo>>;
    pub async fn download_and_install(&self, release: &ReleaseInfo) -> Result<()>;
}
```

#### Meccanismo di Sostituzione Atomica del Binario:
1. Individuazione percorso binario corrente tramite `std::env::current_exe()?`.
2. Download asset in un file temporaneo (`tempfile::NamedTempFile` o directory temporanea).
3. Se `.zip`: scansione file archivio, estrazione del file `mmex-sync` / `mmex-sync.exe` in un file temporaneo nella stessa cartella del binario originale (per garantire stesso mount/filesystem).
4. Sostituzione:
   - **Linux / macOS:** impostazione permessi eseguibili (`0o755`) tramite `PermissionsExt`. Sostituzione atomica con `std::fs::rename` (oppure rimozione/unlink e spostamento del nuovo binario).
   - **Windows:** I file `.exe` in esecuzione non possono essere sovrascritti direttamente, ma possono essere *rinominati* (es. `mmex-sync.exe` -> `mmex-sync.exe.old`), dopodiché il nuovo file scaricato viene spostato in `mmex-sync.exe`. All'avvio successivo, l'applicazione controlla ed elimina eventuali file `.old`.

---

## 4. Impact on System Invariants (`Invarianti di Sistema`)

- [x] **3-State Loop-Prevention Protocol (`pb_is_dirty` `0`/`1`/`2`)** preservato: nessuna interferenza con la logica di replica o stato record.
- [x] **Topological `SYNC_ORDER` & Foreign Key Cascade (`FK_MAP`)** preservato: non tocca lo schema né il motore di sincronizzazione.
- [x] **`.emb` Atomic Flush & WAL Checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`)** preservato: nessuna modifica al layer crittografico o SQLite.
- [x] **Compile-Time Embedded Assets & `en.json` / `it.json` Key Parity** preservato: tutte le nuove chiavi sono duplicate e verificate al 100% in entrambi i file di localizzazione.
- [x] **Backward Compatibility with Existing User Profiles (`~/.mmex-sync` / `%APPDATA%\mmex-sync`)** preservato: nessuna variazione al formato dei profili o ai percorsi di configurazione.

---

## 5. Verification & Test Plan

1. **Unit / Integration Tests:**
   - [x] `test_semver_comparison`: verifica del corretto parsing e confronto tra tag di versione (es. `v0.3.0` vs `v0.4.0`, tag con o senza prefisso `v`).
   - [x] `test_asset_selection_for_platform`: verifica che per ogni combinazione OS (`linux`, `windows`, `macos`) venga selezionato l'asset appropriato con estensione `.zip` o binario standalone.
   - [x] `test_zip_extraction`: verifica dell'estrazione del binario interno da un archivio `.zip` sintetico di test.
   - [x] `test_json_key_parity`: verifica parità 100% chiavi di localizzazione tra `en.json` e `it.json`.
2. **Scenari di Verifica Manuale CLI:**
   - [x] `mmex-sync --checkForUpdate`: esegue la chiamata GitHub e restituisce stato formattato.
   - [x] `mmex-sync --downloadUpdate`: verifica che su versione già aggiornata non esegua download inutili e su nuova versione esegua download e rimpiazzo.
3. **Scenari di Verifica Manuale GUI:**
   - [x] Apertura menu *Strumenti -> Verifica e Aggiorna...*.
   - [x] Visualizzazione corretta del modale con i testi localizzati in Italiano e Inglese.
   - [x] Gestione corretta della disconnessione di rete o assenza di aggiornamenti (modal non bloccante).

