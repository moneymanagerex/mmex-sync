# Change Request (CR): Add In-App Application Help Viewer (`docs/HELP.md`)

> **CR ID:** `CR-008`  
> **Title:** `Add In-App Application Help Viewer (docs/HELP.md)`  
> **Status:** `IN_PROGRESS`  
> **Created Date:** `2026-11-04`  
> **Target Version:** `v0.4.0`  
> **Affected Baseline Specs:** `specs/as-is/00-architecture-and-ui.md`

---

## 1. Context & Motivation (Why)

Attualmente, il menu **Help** (`gui.menu.help`) nell'interfaccia grafica desktop nativa (`src/gui/app.rs`, righe 1682–1689) espone unicamente la voce **About MMEX-Sync** (`gui.menu.help.about`), che apre una finestra modale sintetica (`dialog_about`) contenente la versione del software e brevi note architetturali.

Nel repository è già presente il manuale utente e di riferimento completo in formato Markdown (`docs/HELP.md`), che documenta in dettaglio:
- Le modalità operative (`run`, `watch`, `sync`, `--force`) e il meccanismo di Auto-Start Countdown.
- Tutte le sezioni della GUI e le azioni della barra degli strumenti.
- I parametri CLI, le variabili d'ambiente (`.env`) e la precedenza di configurazione dei profili.
- La gestione dei database cifrati `.emb` (SQLCipher / AES) e le operazioni di manutenzione (`--clearDb`, `--clearServer`).
- La risoluzione dei problemi comuni (troubleshooting).

Tuttavia, l'utente che utilizza la GUI desktop non ha alcun modo di consultare questa guida direttamente dall'applicazione. Inoltre, per rispettare l'**Invariante di Sistema #1** (*Zero External Runtime Asset Dependencies*), il binario compilato `mmex-sync` deve rimanere 100% portabile come singolo eseguibile standalone, senza dipendere dalla presenza sul filesystem della cartella `docs/HELP.md` a runtime.

Questa CR introduce un visualizzatore della guida utente integrato nella GUI sotto il menu **Help**, incorporando `docs/HELP.md` a tempo di compilazione (`include_str!`).

---

## 2. Proposed Functional Changes (What)

### 2.1 Incorporazione Compile-Time di `docs/HELP.md`
- Il contenuto del file `docs/HELP.md` viene incorporato direttamente nel binario a tempo di compilazione tramite `include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/docs/HELP.md"))`.
- Non è richiesto alcun accesso al disco o alla rete a runtime per visualizzare la documentazione.

### 2.2 Espansione del Menu `Help` nella GUI (`src/gui/app.rs`)
1. **Nuova voce di menu:**
   - All'interno del menu **Help** (`self.lang.menu_help()`) nella barra superiore, viene aggiunta la voce **"User Guide"** (`gui.menu.help.guide`), posizionata sopra `About MMEX-Sync` e separata da `ui.separator()`.
   - Al click:
     - Annulla l'eventuale countdown di Auto-Start in corso (`self.cancel_autostart_countdown()`).
     - Imposta `self.dialog_help = true`.
     - Chiude il menu a tendina (`ui.close_menu()`).
2. **Scorciatoia da tastiera (`F1`):**
   - La pressione del tasto `F1` (`egui::Key::F1`) nella finestra principale annulla l'eventuale countdown di Auto-Start e apre (o porta in primo piano) la finestra della guida (`self.dialog_help = true`).

### 2.3 Finestra Visualizzatore Guida (`egui::Window`)
Quando `self.dialog_help == true`, viene renderizzata una finestra `egui::Window` dedicata:
- **Titolo:** `self.lang.help_title()` (`gui.help.title`).
- **Proprietà finestra:** Ridimensionabile (`resizable(true)`), chiudibile tramite pulsante `X` nativo della finestra (`open(&mut self.dialog_help)`) e tramite pulsante **Close** (`self.lang.btn_close()`) a piè di finestra, con dimensioni predefinite ampie (es. `default_size([700.0, 520.0])`, `min_size([480.0, 360.0])`).
- **Barra di Ricerca / Filtro Rapido:**
  - Nella parte superiore della finestra è presente un campo di testo (`self.help_search_query: String`) con placeholder `self.lang.help_search_hint()` (`gui.help.search_hint`) e un pulsante `✖` per azzerare il filtro.
  - Quando l'utente digita una query di ricerca (case-insensitive), il visualizzatore filtra o evidenzia i paragrafi/sezioni corrispondenti di `docs/HELP.md`.
- **Rendering Strutturato del Markdown:**
  - Un'area scorrevole verticale (`egui::ScrollArea::vertical()`) visualizza il contenuto di `docs/HELP.md` tramite un renderer Markdown leggero nativo `egui` (senza introdurre dipendenze esterne pesanti):
    - Titoli `#`, `##`, `###` renderizzati con `egui::RichText::heading()` / `strong()` e spaziatura dedicata.
    - Blocchi di codice (fenced code blocks ` ``` `) renderizzati in un `egui::Frame` scuro con font `monospace`.
    - Liste puntate/numerate, citazioni/alert (`>`) e separatori orizzontali (`---` -> `ui.separator()`).
    - Tabelle Markdown e formattazione inline di base (`**bold**`, `` `code` ``).

### 2.4 Localizzazione (`locales/en.json` & `src/i18n.rs`)
In conformità con le linee guida Crowdin (`AGENT.md`), **solo `locales/en.json`** viene modificato come *Single Source of Truth* (le altre lingue sono gestite da Crowdin con fallback automatico su `en.json` a runtime):
- `"gui.menu.help.guide": "User Guide"`
- `"gui.help.title": "MMEX-Sync — User Guide"`
- `"gui.help.search_hint": "Search in guide..."`

---

## 3. Technical Design & Affected Modules (How)

### 3.1 Moduli Impattati

| File / Modulo | Modifica Pianificata |
| :--- | :--- |
| `src/gui/mod.rs` (o `src/gui/help.rs`) | Incorporazione compile-time di `docs/HELP.md` (`HELP_MD`) e funzione di rendering Markdown leggero per `egui::Ui` con supporto al filtro di ricerca. |
| `src/gui/app.rs` | Aggiunta dei campi `dialog_help: bool` e `help_search_query: String` in `MmexSyncGuiApp`; aggiunta della voce `menu_help_guide()` nel menu `Help` e gestione scorciatoia `F1`; rendering della finestra `egui::Window` in `render_dialogs()`. |
| `src/i18n.rs` | Aggiunta dei metodi helper `menu_help_guide()`, `help_title()`, `help_search_hint()` su `Language`. |
| `locales/en.json` | Aggiunta delle chiavi `"gui.menu.help.guide"`, `"gui.help.title"` e `"gui.help.search_hint"`. |

### 3.2 Data Model / Struct Diff (`src/gui/app.rs` & `src/i18n.rs`)

```rust
// In src/gui/mod.rs (o src/gui/help.rs)
pub const HELP_MARKDOWN: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/docs/HELP.md"
));

// In src/gui/app.rs (struct MmexSyncGuiApp)
pub struct MmexSyncGuiApp {
    // ...
    dialog_about: bool,
    dialog_help: bool,
    help_search_query: String,
    update_state: UpdateDialogState,
}

// In src/gui/app.rs (Menu Help)
ui.menu_button(self.lang.menu_help(), |ui| {
    if ui.button(self.lang.menu_help_guide()).clicked() {
        self.cancel_autostart_countdown();
        self.dialog_help = true;
        ui.close_menu();
    }
    ui.separator();
    if ui.button(self.lang.menu_help_about()).clicked() {
        self.cancel_autostart_countdown();
        self.dialog_about = true;
        ui.close_menu();
    }
});

// In src/i18n.rs (impl Language)
pub fn menu_help_guide(&self) -> &'static str {
    self.t("gui.menu.help.guide")
}
pub fn help_title(&self) -> &'static str {
    self.t("gui.help.title")
}
pub fn help_search_hint(&self) -> &'static str {
    self.t("gui.help.search_hint")
}
```

---

## 4. Impact on System Invariants (`Invarianti di Sistema`)

- [x] **3-State Loop-Prevention Protocol (`pb_is_dirty` `0`/`1`/`2`)** preserved? **Sì.** Nessun impatto sul database o sul motore di sincronizzazione.
- [x] **Topological `SYNC_ORDER` & Foreign Key Cascade (`FK_MAP`)** preserved? **Sì.** Nessun impatto.
- [x] **`.emb` Atomic Flush & WAL Checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`)** preserved? **Sì.** Nessun impatto.
- [x] **Compile-Time Embedded Assets & `en.json` Single Source of Truth** preserved? **Sì.** `docs/HELP.md` viene incorporato a compile-time tramite `include_str!`, mantenendo il binario 100% standalone, e le nuove chiavi di traduzione vengono aggiunte esclusivamente a `locales/en.json`.
- [x] **Backward Compatibility with Existing User Profiles (`~/.mmex-sync` / `%APPDATA%\mmex-sync`)** preserved? **Sì.** Nessuna modifica allo schema JSON dei profili o della configurazione globale.

---

## 5. Verification & Test Plan

1. **Unit / Integration Tests (`cargo test`):**
   - `test_help_markdown_embedded_non_empty`: verifica che la costante `HELP_MARKDOWN` incorporata da `docs/HELP.md` non sia vuota e contenga le sezioni principali della guida.
   - `test_help_i18n_keys`: verifica che `Language::En.menu_help_guide()`, `Language::En.help_title()` e `Language::En.help_search_hint()` restituiscano stringhe valide e non vuote (con fallback per le altre lingue).
   - `test_help_markdown_filter`: verifica il filtraggio case-insensitive delle sezioni/blocchi quando viene fornita una query di ricerca.
2. **Edge Cases & Regression Checks:**
   - Verificare che l'apertura di `Help -> User Guide` (o la pressione di `F1`) durante i 3 secondi iniziali annulli correttamente il countdown di Auto-Start.
   - Verificare il ridimensionamento, lo scrolling fluido e la chiusura della finestra della guida tramite sia il pulsante `X` della finestra sia il pulsante `Close`.
   - Eseguire `cargo check`, `cargo clippy`, `cargo fmt --all -- --check` e `cargo test` senza warning o errori.

