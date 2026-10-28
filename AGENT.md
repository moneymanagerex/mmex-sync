# AGENTS.md - Linee Guida Architetturali per mmex-sync (Rust Rewrite)

## Contesto del Progetto
`mmex-sync` è un sidecar gateway di sincronizzazione multipiattaforma tra i database locali di **Money Manager Ex (MMEX)** (file `.mmb` SQLite standard e file `.emb` cifrati) e un backend cloud remoto.
Stiamo eseguendo una migrazione completa da Node.js a Rust sul branch `rust`.

## Regole Operative per l'Agente
1. **Riferimento Legacy:** Prima di implementare qualsiasi funzionalità in Rust, ispeziona il codice Node.js esistente per estrarre l'esatta logica di business, gli algoritmi di crittografia `.emb`, le query SQL e la struttura dati.
2. **Ciclo di Verifica Obbligatorio:** Dopo ogni modifica ai file `.rs`, DEVI eseguire `cargo check` e `cargo clippy` nel terminale. Non considerare mai un task completato se il codice non compila a zero errori.
3. **Preservazione Temporanea:** Sposta i file Node.js (`src/`, `package.json`, ecc.) in una cartella `_legacy_node/` durante la migrazione, così da poterli consultare senza inquinare la root di Cargo.

## Architettura: Clean & Hexagonal (Ports & Adapters)
Il progetto DEVE disaccoppiare completamente il database locale MMEX e il motore di sincronizzazione dallo specifico provider cloud remoto.

### Pattern `RemoteServer` (Multi-Backend Ready)
Il modulo `src/remoteserver/` deve definire un trait asincrono `RemoteServer` (usando `async-trait` o native async traits in Rust 2021/2024) che astrae le operazioni di autenticazione, pull, push e health-check.
- L'orchestratore di sync (`src/sync/`) deve dipendere **esclusivamente** dal trait `RemoteServer` (es. `Box<dyn RemoteServer>` o generici), mai direttamente da strutture specifiche di PocketBase.
- La configurazione (`config.rs` / CLI) deve prevedere un parametro `REMOTE_PROVIDER` (default: `pocketbase`, predisposto per estensioni future come `supabase` o `firebase`).
- L'implementazione di PocketBase deve risiedere in `src/remoteserver/pocketbase/` (o `src/remoteserver/pocketbase.rs`).

## Stack Tecnologico Obbligatorio
- **Runtime Asincrono:** `tokio` (full features) + `async-trait`.
- **Database Locale (MMEX):** `rusqlite` con feature `["bundled", "chrono"]`. **NON** usare SQLite di sistema.
  - Imposta sempre `busy_timeout` e valuta `journal_mode = WAL` per prevenire `Database Locked`.
  - Tutte le scritture multiple su SQLite DEVONO avvenire dentro una transazione atomica (`conn.transaction()`).
- **Rete e TLS:** `reqwest` con feature `["json", "rustls-tls"]` e `default-features = false` (zero dipendenze da OpenSSL di sistema per garantire cross-compilation pulita).
- **Serializzazione:** `serde` e `serde_json`. Le `struct` in `src/domain/` devono essere agnostiche rispetto al backend remoto; il mapping verso il formato JSON specifico di PocketBase (o futuri backend) deve avvenire dentro `src/remoteserver/<provider>`.
- **Crittografia `.emb`:** Crate puri della famiglia `RustCrypto` (`aes`, `cipher`, `sha2`, `pbkdf2` o `cbc` in base all'implementazione JS attuale). Gestione sicura dei file temporanei tramite crate `tempfile` o in-memory.
- **Gestione Errori:** `thiserror` per gli errori tipizzati (`SyncError`), `anyhow` solo nel `main.rs`.
  - **DIVIETO ASSOLUTO** di usare `.unwrap()` o `.expect()` nel codice di produzione (ammessi solo nei test).
- **CLI & Configurazione:** `clap` (macro `derive` + `env`) + `dotenvy`.
- **Logging:** `tracing` e `tracing-subscriber`.

## Struttura dei Moduli Target (`src/`)
- `main.rs` -> Entrypoint, parsing CLI, setup logger, iniezione delle dipendenze.
- `config.rs` -> Gestione configurazione, selezione del provider remoto ed `.env`.
- `error.rs` -> Definizione di `SyncError` con `thiserror`.
- `domain/` -> Struct pure agnostiche (Transazioni, Conti, Categorie, SyncPayload) e regole di risoluzione conflitti.
- `crypto/` -> Logica di decrittazione e crittografia nativa dei file `.emb` con unit test.
- `db/` -> Repository SQLite (`rusqlite`), query MMEX e transazioni atomiche.
- `remoteserver/` ->
  - `mod.rs` -> Trait `RemoteServer` e Factory di creazione del client.
  - `pocketbase.rs` (o sottocartella) -> Implementazione concreta per PocketBase.
- `sync/` -> Motore di sincronizzazione che orchestra `db` e `dyn RemoteServer`.