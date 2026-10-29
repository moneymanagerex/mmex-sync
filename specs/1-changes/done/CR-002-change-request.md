# CR-002: Risoluzione Bug Ciclo di Sync, Trigger Recursion e Ordine di Autenticazione
- **Stato:** DONE
- **Spec impattate:** `specs/0-as-is/00-architecture-and-ui.md`, `specs/0-as-is/01-db-and-crypto.md`, `specs/0-as-is/03-sync-engine.md`

---

## 1. Comportamento Attuale (AS-IS)
1. **Ricorsione dei Trigger sulle Eliminazioni Remote (Bug PULL):** Durante il PULL, se un record remoto risulta eliminato (`is_deleted == true`), il DB esegue un `DELETE` locale. Questo fa scattare il trigger `TRG_<table>_DELETE` (che agisce `WHEN OLD.pb_id IS NOT NULL`), loggando erroneamente l'eliminazione in `pb_DELETED_RECORDS_LOG`. Al ciclo di sync successivo, questa finta eliminazione locale viene pushata al server.
2. **Salvataggio `.emb` Omesso su Push-Only (Bug FLUSH):** Nel motore di sync, l'istruzione `self.db.flush()` (che esegue il ricircolo WAL e la crittografia nel file `.emb` definitivo) è innestata dentro il blocco `if self.options.pull`. Se si esegue un "Push Only", le modifiche avvengono nel file SQLite temporaneo decifrato ma non vengono mai salvate nel file `.emb` originale.
3. **Fallimento `--clearServer` per Mancata Autenticazione (Bug CLI):** Nell'avvio da terminale, il comando `--clearServer` viene eseguito immediatamente dopo l'istanziazione del `RemoteServer`, ma *prima* che avvenga l'autenticazione o il ripristino del token. Questo causa errori HTTP 401/403.

---

## 2. Nuovo Comportamento Desiderato (TO-BE)

### 2.1 Bypass Intenzionale del Trigger di Eliminazione (in `src/db/repository.rs`)
Per evitare che l'eliminazione innescata dal PULL finisca nel log delle eliminazioni locali:
- Nella funzione `apply_remote_changes`, quando si processa un record remoto con `remote.is_deleted == true` e si trova una corrispondenza locale (`Some(rowid)`):
  1. Eseguire prima un `UPDATE <table> SET pb_id = NULL WHERE ROWID = ?`.
  2. Eseguire poi il `DELETE FROM <table> WHERE ROWID = ?`.
- *Spiegazione:* Impostando `pb_id` a `NULL` appena prima di eliminare la riga, la condizione del trigger `WHEN OLD.pb_id IS NOT NULL` risulta falsa e il trigger non scatta, bypassando la tabella di log per le operazioni innescate dal motore stesso. Le transazioni atomiche garantiranno la sicurezza di questo doppio step.

### 2.2 Riposizionamento del Flush (`src/sync/engine.rs`)
- Spostare la chiamata a `self.db.flush()?` fuori dal blocco `if self.options.pull`.
- Il flush deve avvenire sempre alla fine di `run_cycle`, indipendentemente dal fatto che l'esecuzione sia stata solo INIT, PUSH, PULL o una combinazione di queste.

### 2.3 Posticipo logico di `--clearServer` (`src/main.rs` / `src/sync/runner.rs`)
- Spostare l'esecuzione di `--clearServer` (`remote.clear_remote_server(SYNC_ORDER).await`) a *dopo* il completamento del blocco di autenticazione remota (dove si valuta utente/password o si decifra e inietta il token salvato).
- In questo modo il client avrà le intestazioni di autorizzazione necessarie per invocare le API di eliminazione.

---

## 3. Vincoli e Invarianti da Preservare
1. **Atomicità:** Le operazioni combinate di `UPDATE` e `DELETE` per il bypass del trigger devono avvenire rigorosamente all'interno della medesima transazione SQLite già aperta per il record.
2. **Crash Recovery Integrato:** Anche spostando il flush alla fine del ciclo, il file `.emb` originale non deve essere toccato a meno che il database temporaneo non sia stato effettivamente modificato (sfruttare il flag `is_modified` del `EmbDatabaseHandler`).
3. **Reverse Order per Clear Server:** La funzione `clear_remote_server` deve continuare a processare le tabelle invertendo l'ordine di `SYNC_ORDER` per non violare i vincoli di foreign key sul database cloud.

---

## 4. Criteri di Accettazione & Test
- [x] L'eliminazione locale di un record remoto non inserisce record in `pb_DELETED_RECORDS_LOG`.
- [x] Eseguendo una sincronizzazione `--sync=push` su un file `.emb`, il file originale su disco viene correttamente aggiornato con i nuovi `pb_id`.
- [x] Il comando `--clearServer` esegue le API HTTP con il token di autorizzazione attivo e non restituisce errore di autenticazione.
- [x] Gli unit test esistenti rimangono verdi e coprono il bypass del trigger `DELETE`.
- [x] verifica che tutta la documentazione prodotta sia in inglese
- [x] Le specifiche `specs/as-is/` (00, 01, 03) sono state aggiornate col nuovo flusso, sempre in inglese.
- [x] Stato di questo documento impostato a `DONE`.
