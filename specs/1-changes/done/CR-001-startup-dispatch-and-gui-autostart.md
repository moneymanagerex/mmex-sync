# CR-001: Semplificazione Dispatch CLI/GUI, Rimozione `--nogui` / `has_cli_action` e Auto-Start con Countdown in GUI
- **Stato:** DONE
- **Spec impattate:** `specs/0-as-is/00-architecture-and-ui.md`, `specs/0-as-is/03-sync-engine.md`

---

## 1. Comportamento Attuale (AS-IS)
1. **Dispatch ambiguo in `src/main.rs`:** L'avvio della GUI dipende da calcoli impliciti e combinazioni di flag come `has_cli_action`[cite: 1].
2. **Mancanza di `--cli` esplicito:** Non esiste un flag `--cli` chiaro per forzare l'esecuzione da terminale.
3. **Nessun Auto-Start in GUI:** Si apre sempre la schermata di configurazione statica senza avviare il sync in automatico all'apertura[cite: 1, 4].

---

## 2. Nuovo Comportamento Desiderato (TO-BE)

### 2.1 Regole di Avvio Esplicite (`src/cli.rs` e `src/main.rs`)
1. **Modifica Flag CLI (`src/cli.rs`):**
   - **Rimosso** completamente `--nogui` e l'inferenza di `has_cli_action`.
   - **Aggiunto** `--cli` (`#[arg(long = "cli")]`) per forzare l'esecuzione headless nel terminale.
   - **Mantenuto** `--gui` (`#[arg(long = "gui")]`) per aprire la GUI bloccando l'auto-start.
2. **Logica di Dispatch in `src/main.rs`:**
   - **Se `args.cli == true` (o comandi espliciti di profilo):** Esegue `run_cli(args)` senza finestre grafiche[cite: 1].
   - **Se `args.gui == true`:** Avvia la GUI (`run_gui(args, false)`) in modalità pura configurazione.
   - **Se nessun flag è passato (`!args.cli && !args.gui`):** Avvia la GUI (`run_gui(args, true)`). Se il profilo è completo e `autoStart == true`, parte il countdown di 3 secondi per l'esecuzione automatica del `default_mode`[cite: 1, 4].

### 2.2 Flag `autoStart` nel Profilo (`src/config.rs`)
- Aggiunto `auto_start: bool` (`"autoStart"`) in `ProfileConfig` con default a `true`[cite: 1].

### 2.3 Countdown e Launcher nella GUI (`src/gui/app.rs`)
- Implementato il countdown di 3 secondi interrompibile (tramite tasto `Esc` o click su "Annulla") e supporto completo all'esecuzione dei flussi `run`, `sync`, `watch` all'interno della GUI[cite: 1, 4].

---

## 3. Criteri di Accettazione & Test
- [x] Rimossi `--nogui` e `has_cli_action`. Introdotti `--cli` e `--gui` con comportamento deterministico.
- [x] Avvio senza argomenti apre la GUI con countdown e auto-start (se il profilo è pronto).
- [x] `cargo check`, `cargo clippy` e `cargo test` passano al 100%.
- [x] Specifiche `specs/0-as-is/` aggiornate.
- [x] Stato CR impostato a `DONE`.