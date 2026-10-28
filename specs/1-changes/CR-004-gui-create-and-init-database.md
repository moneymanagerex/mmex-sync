# CR-004: Creazione e Inizializzazione Nuovo Database MMEX (`.mmb` / `.emb`) da GUI
- **Stato:** READY
- **Spec impattate:** `specs/0-as-is/00-architecture-and-ui.md`, `specs/0-as-is/01-db-and-crypto.md`

---

## 1. Comportamento Attuale (AS-IS)
1. **Assenza di `--create` nella GUI (`src/gui/app.rs`):**
   - Il pulsante **Sfoglia...** e la voce **Modifica -> Database MMEX...** utilizzano esclusivamente `rfd::FileDialog::new().pick_file()`, che consente di selezionare solo file `.mmb`/`.emb` già esistenti su disco.
   - Tutte le connessioni aperte dalla GUI invocano `DatabaseService::connect(..., false)`. Non esiste alcun comando o pulsante grafico per creare da zero un nuovo file database MMEX e inizializzarlo con lo schema SQL standard (`tables_v1_for_sync.sql`, `PRAGMA user_version = 21` e schema tecnico `pb_*`).
2. **Gestione `--create` su file esistenti e `.emb` (`src/db/repository.rs`):**
   - In `DatabaseService::connect`, quando `create == true`:
     - Se il file `.mmb` esiste già su disco, non viene ricreato da zero prima di eseguire `create_empty_database`.
     - Se il file è un `.emb` cifrato, `create_empty_database` scrive nel file temporaneo decifrato e chiama `mark_modified()`, ma se non segue un'operazione di `flush()` (es. creazione pura), il contenitore `.emb` cifrato non viene riversato immediatamente su disco.

---

## 2. Nuovo Comportamento Desiderato (TO-BE)

### 2.1 Pulsante e Voce di Menu "Nuovo DB..." nella GUI (`src/gui/app.rs`)
1. **Sezione "Database MMEX Locale" e Menu "Modifica":**
   - Aggiunto il pulsante **"➕ Nuovo DB..."** (`gui.btn.new_db`) accanto al pulsante **Sfoglia...** nella sezione *Database MMEX Locale*.
   - Aggiunta la voce **"Crea Nuovo Database MMEX..."** (`gui.menu.edit.new_db`) nel menu *Modifica*.
2. **Flusso di Selezione e Creazione (`save_file`):**
   - Il click apre il selettore file nativo in modalità salvataggio:
     ```rust
     rfd::FileDialog::new()
         .add_filter("MMEX Database", &["mmb", "emb"])
         .set_file_name("new_database.mmb")
         .save_file()
     ```
   - Se l'utente non specifica un'estensione, viene aggiunta automaticamente `.mmb`.
   - Il percorso selezionato viene impostato in `self.db_path`.
   - **Caso `.mmb` (in chiaro):** Avvia immediatamente in background `trigger_create_db_async()`, che crea il file SQLite, applica `create_empty_database` (`tables_v1_for_sync.sql` + `PRAGMA user_version = 21`), inizializza lo schema tecnico di sincronizzazione (`init_schema()`), salva il profilo e mostra il messaggio di conferma nella barra di stato e nel log.
   - **Caso `.emb` (cifrato):** 
     - azzera i riferimetni preesistenti quali `self.file_password`
     - apre un dialogo modale dedicato (**"Imposta Password Nuovo Database (.emb)"**) in cui l'utente inserisce la password prima di avviare `trigger_create_db_async()`.
     - viene salvata la password `self.file_password` ,

### 2.2 Perfezionamento `DatabaseService::connect` con `create = true` (`src/db/repository.rs`)
1. Se `create == true` e il file `.mmb` esiste già su disco, viene rimosso prima di aprire la connessione SQLite in modo da garantire un database vuoto e pulito (come specificato dalla semantica di `--create`: *"Delete and Recreates a new empty database"*).
2. Al termine di `create_empty_database` durante `connect(..., true)`, viene invocato `service.flush()?` così che anche un nuovo database `.emb` cifrato venga immediatamente cifrato e scritto su disco.

### 2.3 Localizzazione (`locales/en.json`, `locales/it.json`, `src/i18n.rs`)
- Aggiunta delle chiavi di traduzione IT/EN per il pulsante, la voce di menu, l'eventuale dialogo password `.emb` e i messaggi di stato/log di creazione completata.

---

## 3. Criteri di Accettazione & Test
- [ ] Pulsante **"➕ Nuovo DB..."** e voce di menu presenti nella GUI con apertura di `rfd::FileDialog::save_file()`.
- [ ] Creazione e inizializzazione funzionanti sia per file `.mmb` sia per file `.emb` cifrati (con richiesta password se mancante).
- [ ] `DatabaseService::connect(..., true)` ricrea correttamente il database anche se il file esiste già e persiste subito su disco i file `.emb`.
- [ ] Parità 100% delle chiavi tra `locales/en.json` e `locales/it.json`.
- [ ] `cargo check`, `cargo clippy` e `cargo test` passano al 100%.
- [ ] Specifiche `specs/0-as-is/` aggiornate e stato CR impostato a `DONE`.

