# Change Request (CR): Improve Linux & Multi-Platform MMEX Launcher (Flatpak & Custom Commands)

> **CR ID:** `CR-007`  
> **Title:** `Improve Linux & Multi-Platform MMEX Launcher (Flatpak & Custom Commands)`  
> **Status:** `DONE`  
> **Created Date:** `2026-11-04`  
> **Target Version:** `v0.4.0`  
> **Affected Baseline Specs:** `specs/as-is/00-architecture-and-ui.md`

---

## 1. Context & Motivation (Why)

Attualmente, l'applicazione `mmex-sync` assume che Money Manager Ex (MMEX) sia sempre un binario eseguibile locale puntato da un percorso file statico su filesystem (`mmex_exe: Option<PathBuf>`).
Nei flussi di esecuzione `run` e `watch` (sia in CLI tramite `src/sync/runner.rs` sia in GUI tramite `src/gui/app.rs`), il sistema valida l'eseguibile verificando esclusivamente `exe.exists()`. Se la verifica fallisce:
1. In modalità `run`, emette un warning `sync.mmex_not_configured_fallback` ("*⚠️ MMEX executable not found or not configured. Falling back to SYNC mode.*") ed esegue solo il sync senza avviare MMEX.
2. In modalità `watch`, non spawna il processo in background.

### Il Problema su Linux e Ambienti Moderni
Su Linux, MMEX viene frequentemente distribuito e installato tramite **Flatpak** (ID applicazione: `org.moneymanagerex.MMEX`), oppure gestito tramite wrapper di sistema o comandi presenti nel `$PATH` (es. `flatpak run org.moneymanagerex.MMEX` o semplicemente `mmex`).
Nel paradigma attuale:
- Se l'utente inserisce la stringa di comando `flatpak run org.moneymanagerex.MMEX`, `Path::new("flatpak run org.moneymanagerex.MMEX").exists()` restituisce `false` perché non esiste alcun file con quel nome letterale.
- Anche se l'utente inserisse il nome di un eseguibile nel `$PATH` (es. `mmex`), `Path::new("mmex").exists()` fallisce a meno che l'eseguibile non si trovi nella directory di lavoro corrente.
- Inoltre, `Command::new(exe).arg(db_path)` fallisce se `exe` contiene argomenti multipli, poiché `std::process::Command::new` interpreta l'intera stringa come il percorso del singolo binario senza effettuare alcun word splitting.

Questa CR risolve la limitazione trasformando `mmexExe` da un semplice percorso file obbligatorio a un **comando di lancio flessibile (Launcher Command)** in grado di accettare:
1. Percorsi assoluti/relativi tradizionali (es. `/usr/bin/mmex`, `C:\Program Files\MoneyManagerEx\bin\mmex.exe`).
2. Comandi complessi con argomenti (es. `flatpak run org.moneymanagerex.MMEX`).
3. Binari risolvibili tramite la variabile d'ambiente `$PATH` di sistema (es. `mmex`, `flatpak`).
4. Supporto nativo all'**auto-rilevamento multipiattaforma** dell'installazione di MMEX all'interno della GUI (su Windows, Linux e macOS).

---

## 2. Proposed Functional Changes (What)

### 2.1 Gestione Configurazione & CLI
1. **Riconcettualizzazione del campo `mmex_exe`:**
   - Nel file di profilo `<profile>.mmex-sync.json`, la chiave JSON `mmexExe` viene mantenuta per totale retrocompatibilità.
   - Il valore serializzato/deserializzato continua a essere una stringa opzionale (`Option<String>`), ma ora accetta sia percorsi sia intere stringhe di comando (es. `"flatpak run org.moneymanagerex.MMEX"`).
2. **Aggiornamento CLI (`src/cli.rs`):**
   - L'argomento `--exe` (env `MMEX_EXE_PATH`) viene convertito da `Option<PathBuf>` a `Option<String>` per consentire l'inserimento di comandi completi con spazi e flag (es. `--exe "flatpak run org.moneymanagerex.MMEX"`).
   - Viene aggiornata la docstring dell'argomento per chiarire il supporto a percorsi e comandi Flatpak.

### 2.2 Algoritmo di Risoluzione e Validazione del Launcher
Viene introdotta una struttura helper (`LauncherCommand`) incaricata del parsing e della validazione:
1. **Rilevamento percorso diretto con spazi:** Se l'intera stringa rappresenta un percorso esistente su disco (es. `C:\Program Files\MoneyManagerEx\bin\mmex.exe` o `/usr/bin/mmex`), viene trattata come singolo binario senza argomenti iniziali.
2. **Tokenizzazione Shell / Word Splitting:** Se la stringa non è un file esistente, viene effettuato il parsing tenendo conto di apici singoli/doppi e spazi.
   - Il primo token è il programma principale (`program`, es. `flatpak` o `mmex`).
   - I token successivi sono gli argomenti di default (`args`, es. `["run", "org.moneymanagerex.MMEX"]`).
3. **Validazione dell'esistenza:**
   - Se `program` è un percorso (contiene separatori di directory `/` o `\`), si verifica `Path::new(program).exists()`.
   - Altrimenti, si verifica se `program` è presente in una delle directory elencate nella variabile d'ambiente `$PATH` del sistema operativo (tramite scansione portabile di `std::env::split_paths`).
4. **Composizione del Comando di Avvio:**
   Al momento del lancio, il file database MMEX (`db_path`) viene accodato come argomento finale:
   `Command::new(program).args(&initial_args).arg(db_path)`

### 2.3 Integrazione Grafica GUI (`src/gui/app.rs`)
1. **Aggiornamento Sezione Runner & Esecuzione:**
   - La label `gui.field.mmex_exe` viene aggiornata a *"Eseguibile / Comando MMEX:"* (*"MMEX Executable / Command:"*).
   - Nel campo di testo viene mostrato un testo di suggerimento (*hint text* / placeholder): `es. /usr/bin/mmex o flatpak run org.moneymanagerex.MMEX`.
   - Il pulsante *"Sfoglia..."* (`Browse...`) rimane invariato per chi utilizza binari locali.
2. **Pulsante / Rilevamento Automatico Multipiattaforma (`Auto-Detect`):**
   - Accanto al campo di input (o al posto di un pulsante rigido di solo Browse), viene aggiunto il pulsante **"Rileva"** / **"Auto-Detect"** (`gui.btn.detect_mmex`).
   - Il click invoca la funzione di rilevamento heuristico `auto_detect_mmex()`, differenziata per sistema operativo:
     - **Windows (`target_os = "windows"`):**
       1. Cerca `mmex.exe` nelle directory definite in `%PATH%`.
       2. Esamina i percorsi di installazione standard:
          - `%ProgramFiles%\Money Manager EX\bin\mmex.exe`
          - `%ProgramFiles%\MoneyManagerEx\bin\mmex.exe`
          - `%ProgramFiles(x86)%\Money Manager EX\bin\mmex.exe`
          - `%ProgramFiles(x86)%\MoneyManagerEx\bin\mmex.exe`
          - `%LOCALAPPDATA%\Programs\Money Manager EX\bin\mmex.exe`
     - **Linux (`target_os = "linux"`):**
       1. Verifica se l'app Flatpak è presente (tramite lookup filesystem in `~/.local/share/flatpak/app/org.moneymanagerex.MMEX` o `/var/lib/flatpak/app/org.moneymanagerex.MMEX`, oppure `flatpak info org.moneymanagerex.MMEX`). Se presente, restituisce: `"flatpak run org.moneymanagerex.MMEX"`.
       2. Cerca `mmex` nel `$PATH`.
       3. Cerca nei percorsi tipici di sistema: `/usr/bin/mmex`, `/usr/local/bin/mmex`, `/snap/bin/mmex`.
     - **macOS (`target_os = "macos"`):**
       1. `/Applications/MoneyManagerEx.app/Contents/MacOS/mmex`
       2. `~/Applications/MoneyManagerEx.app/Contents/MacOS/mmex`
       3. `mmex` nel `$PATH`.
   - **Feedback all'utente:**
     - Se rilevato: compila automaticamente il campo `mmex_exe` e mostra un messaggio informativo (`gui.msg.mmex_detected`).
     - Se non trovato: mostra un avviso non bloccante (`gui.msg.mmex_not_found`) invitando l'utente a specificare il percorso manualmente o tramite "Sfoglia...".
3. **Aggiornamento Messaggi di Log e Status Bar:**
   - Il messaggio di avvio `sync.mmex_process_start` mostrerà la linea di comando completa invocata anziché solo il percorso raw.

### 2.4 Localizzazione (`locales/en.json`, `src/i18n.rs`)
In conformità con le linee guida Crowdin (`AGENT.md`), **solo `locales/en.json`** viene modificato come *Single Source of Truth* (le altre lingue sono gestite da Crowdin con fallback automatico su `en.json` a runtime):
- `gui.field.mmex_exe`: aggiornata in `"MMEX Executable / Command:"`.
- `gui.hint.mmex_cmd`: `"e.g. /usr/bin/mmex or flatpak run org.moneymanagerex.MMEX"`.
- `gui.btn.detect_mmex`: `"Auto-Detect"`.
- `gui.msg.mmex_detected`: `"MMEX installation detected: {cmd}"`.
- `gui.msg.mmex_not_found`: `"No standard MMEX installation detected."`.
- `sync.mmex_not_configured_fallback`: `"MMEX executable or launch command not found or not configured. Falling back to SYNC mode."`.

---

## 3. Technical Design & Affected Modules (How)

### 3.1 Moduli Impattati

| File / Modulo | Modifica Pianificata |
| :--- | :--- |
| `src/cli.rs` | Cambio tipo di `exe` da `Option<PathBuf>` a `Option<String>` con descrizione aggiornata. |
| `src/config.rs` | `ConfigResolved.mmex_exe` converte da `Option<PathBuf>` a `Option<String>` (o `Option<LauncherCommand>`), preservando `profile.mmex_exe`. |
| `src/sync/runner.rs` | Utilizzo del nuovo `LauncherCommand::build_command()` per preparare ed eseguire il processo in modalità `run` e `watch`. |
| `src/gui/app.rs` | Aggiornamento del campo di input, integrazione del pulsante di autodetect multipiattaforma, ed esecuzione del comando tokenizzato. |
| `src/util/launcher.rs` *(nuovo)* | Modulo puro dedicato al parsing, word splitting con apici, lookup in `$PATH`, euristica di auto-rilevamento multipiattaforma (`auto_detect_mmex()`) e generazione di `std::process::Command`. |
| `locales/en.json` & `src/i18n.rs` | Aggiornamento etichette, placeholder e chiavi inglesi (Single Source of Truth per Crowdin). |

### 3.2 Modello Dati & Firma del Launcher (`src/util/launcher.rs`)

```rust
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
        let direct_path = crate::config::expand_tilde(std::path::Path::new(trimmed));
        if direct_path.exists() {
            return Some(Self {
                program: direct_path.to_string_lossy().to_string(),
                args: Vec::new(),
            });
        }

        // Altrimenti, effettua il token split rispettando apici singoli e doppi
        let tokens = tokenize_command(trimmed);
        if tokens.is_empty() {
            return None;
        }

        let program = tokens[0].clone();
        let args = tokens[1..].to_vec();

        Some(Self { program, args })
    }

    /// Verifica se il binario/programma è raggiungibile su disco o tramite la variabile PATH.
    pub fn is_available(&self) -> bool {
        let path = std::path::Path::new(&self.program);
        if path.is_absolute() || self.program.contains('/') || self.program.contains('\\') {
            crate::config::expand_tilde(path).exists()
        } else {
            // Cerca nelle directory del PATH di sistema
            which(&self.program)
        }
    }

    /// Prepara il `std::process::Command` pronto per l'esecuzione con il file database accodato.
    pub fn build_command(&self, db_path: &std::path::Path) -> std::process::Command {
        let mut cmd = std::process::Command::new(&self.program);
        cmd.args(&self.args);
        cmd.arg(db_path);
        cmd
    }
}

/// Rileva automaticamente la presenza di un'installazione di MMEX sul sistema operativo host.
pub fn auto_detect_mmex() -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        // 1. Cerca mmex.exe nel PATH
        if which("mmex.exe") {
            return Some("mmex.exe".to_string());
        }

        // 2. Cartelle Program Files, Program Files (x86), LocalAppData
        let candidates = [
            std::env::var("ProgramFiles").map(|p| format!(r"{}\Money Manager EX\bin\mmex.exe", p)),
            std::env::var("ProgramFiles").map(|p| format!(r"{}\MoneyManagerEx\bin\mmex.exe", p)),
            std::env::var("ProgramFiles(x86)").map(|p| format!(r"{}\Money Manager EX\bin\mmex.exe", p)),
            std::env::var("ProgramFiles(x86)").map(|p| format!(r"{}\MoneyManagerEx\bin\mmex.exe", p)),
            std::env::var("LOCALAPPDATA").map(|p| format!(r"{}\Programs\Money Manager EX\bin\mmex.exe", p)),
        ];

        for candidate in candidates.into_iter().flatten() {
            if std::path::Path::new(&candidate).exists() {
                return Some(candidate);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // 1. Verifica Flatpak (filesystem check per org.moneymanagerex.MMEX)
        let home = dirs::home_dir().unwrap_or_default();
        let flatpak_user = home.join(".local/share/flatpak/app/org.moneymanagerex.MMEX");
        let flatpak_system = std::path::Path::new("/var/lib/flatpak/app/org.moneymanagerex.MMEX");
        if flatpak_user.exists() || flatpak_system.exists() || which("flatpak") {
            // Se flatpak è disponibile e l'app è installata o invocabile
            if flatpak_user.exists() || flatpak_system.exists() {
                return Some("flatpak run org.moneymanagerex.MMEX".to_string());
            }
        }

        // 2. Cerca nel PATH
        if which("mmex") {
            return Some("mmex".to_string());
        }

        // 3. Percorsi standard Linux
        for path in &["/usr/bin/mmex", "/usr/local/bin/mmex", "/snap/bin/mmex"] {
            if std::path::Path::new(path).exists() {
                return Some(path.to_string());
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        for path in &[
            "/Applications/MoneyManagerEx.app/Contents/MacOS/mmex",
            "~/Applications/MoneyManagerEx.app/Contents/MacOS/mmex",
        ] {
            let expanded = crate::config::expand_tilde(std::path::Path::new(path));
            if expanded.exists() {
                return Some(expanded.to_string_lossy().to_string());
            }
        }
        if which("mmex") {
            return Some("mmex".to_string());
        }
    }

    None
}
```

---

## 4. Impact on System Invariants (`Invarianti di Sistema`)

- [x] **3-State Loop-Prevention Protocol (`pb_is_dirty` `0`/`1`/`2`)**: Preservato. La logica di sincronizzazione non viene alterata.
- [x] **Topological `SYNC_ORDER` & Foreign Key Cascade (`FK_MAP`)**: Preservato. Nessun impatto sul motore di sync.
- [x] **`.emb` Atomic Flush & WAL Checkpoint**: Preservato. Dopo la chiusura del processo MMEX (lanciato tramite Flatpak o nativo), il reload `.reload_if_emb()` e la sincronizzazione finale continuano a operare normalmente.
- [x] **Compile-Time Embedded Assets & `en.json` Single Source of Truth**: Tutte le nuove chiavi sono aggiunte esclusivamente in `locales/en.json` (con fallback automatico per gli altri file locale gestiti da Crowdin).
- [x] **Backward Compatibility with Existing User Profiles**: Preservato al 100%. I profili esistenti contenenti percorsi a file eseguibili (es. `"mmexExe": "/usr/bin/mmex"` o percorsi Windows) continuano a funzionare esattamente come prima senza richiedere modifiche ai file JSON.

---

## 5. Verification & Test Plan

### 5.1 Test Unitari Automatici (`cargo test`)
1. **`test_launcher_parse_direct_path`**:
   - Verifica che un percorso esistente su disco non venga frammentato anche se contiene spazi.
2. **`test_launcher_parse_flatpak_command`**:
   - Input: `"flatpak run org.moneymanagerex.MMEX"`.
   - Output atteso: `program == "flatpak"`, `args == ["run", "org.moneymanagerex.MMEX"]`.
3. **`test_launcher_parse_with_quotes`**:
   - Input: `"/opt/my app/mmex" --custom-flag "some value"`.
   - Output atteso: corretta preservazione dei token con apici.
4. **`test_launcher_path_lookup`**:
   - Verifica che eseguibili standard di sistema (es. `sh` o `ls` su Unix, `cmd` su Windows) vengano rilevati correttamente come disponibili tramite `$PATH`.
5. **`test_launcher_build_command`**:
   - Verifica che il database path venga accodato come ultimo argomento del comando.

### 5.2 Scenari di Verifica Manuale
1. **Ambiente Windows (Auto-Detect & Program Files):**
   - Installare Money Manager EX su Windows nel percorso standard `C:\Program Files\Money Manager EX\bin\mmex.exe`.
   - Nella GUI, lasciare il campo vuoto e premere *"Rileva"* (`Auto-Detect`): verificare che il percorso del binario venga inserito correttamente nel campo.
   - Eseguire *"Run (MMEX Launcher)"*: verificare che il binario con spazi nel percorso venga avviato senza errori passando il file database come argomento.
2. **Ambiente Linux con Flatpak MMEX:**
   - Installare `org.moneymanagerex.MMEX` via Flatpak.
   - Nella GUI, premere *"Rileva"*: verificare che compili `flatpak run org.moneymanagerex.MMEX`.
   - Eseguire `mmex-sync --cli --run`: verificare che avvii la pre-sincronizzazione, apra regolarmente MMEX Flatpak con il database specificato, e attenda la chiusura prima del sync finale.
3. **Ambiente GUI Generale:**
   - Digitare la stringa o usare l'auto-rilevamento.
   - Verificare che il salvataggio del profilo persista la stringa in `mmexExe`.
   - Eseguire *"Run (MMEX Launcher)"* dal menu o countdown e verificare il corretto avvio.
4. **Retrocompatibilità:**
   - Aprire un profilo esistente con percorso classico `/usr/bin/mmex` o binario Windows configurato in precedenza.
   - Verificare che continui a funzionare senza regressioni.

