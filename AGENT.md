# AGENTS.md - Architectural and Operational Guidelines for mmex-sync

## Project Context
`mmex-sync` is a cross-platform (Windows, macOS, Linux) synchronization sidecar gateway between local **Money Manager Ex (MMEX)** databases (standard `.mmb` SQLite and encrypted `.emb` files) and remote cloud backends (e.g., PocketBase). 
The project is built entirely in **Rust** (Edition 2021).

## Spec-Driven Evolution Protocol (MANDATORY)
Do not invent or guess behaviors. Code evolution is strictly driven by documentation:
- **INTERNAL SPECS (`specs/`):** The `specs/as-is/` folder contains the exact internal specification of how the code works today. Modification requests are located in `specs/changes/CR-XXX-*.md`. This is your Single Source of Truth for development.
- **PUBLIC DOCS (`docs/`):** The `docs/` folder is used to generate the public-facing website. It MUST be updated when implementing significant user-facing changes (e.g., new CLI flags, new GUI behaviors), but with **extreme caution**. Write for the end-user and NEVER include sensitive internal engineering details, architectural secrets, or backend credentials. Consider also to update application help `docs/HELP.md`

**Workflow for implementing a Change Request (CR):**
1. **Context Reading:** Read the `CR-XXX` document and ALL files in `specs/as-is/` to understand the current state and the *System Invariants* that must be preserved.
2. **Impact Plan:** Set the CR status to `IN_PROGRESS`.
3. **Coding & Testing:** Modify the Rust code in `src/`, add/update unit tests, and update `locales/*.json` if there are new UI/CLI text strings.
4. **Strict Validation:** Run `cargo check`, `cargo clippy`, and `cargo test`. Never consider a task complete if there are compiler errors or warnings.
5. **Documentation Alignment:** 
   - **Internal:** Update the relevant files in `specs/as-is/` so they accurately reflect the newly implemented code behavior. Use english as default language for this files.
   - **Public:** If the CR introduces user-facing changes, cautiously update the public manual in `docs/` to help the end-users. Use english as default language for this files too.
6. **Closure:** Check off all acceptance criteria boxes in `CR-XXX` and set its status to `DONE` and move into subfolder `specs/changes/done/`.

**Backlog & Future Ideas Management:**
- The file `specs/backlog.md` contains ONLY embryonic ideas and future Change Requests. 
- PROHIBITION: Never write code based on items in `specs/backlog.md`. Read it strictly to understand the long-term architectural vision.
- To implement an idea, it must first be extracted from the backlog, formalized into a proper specification, and placed in `specs/changes/` as an active CR.

## Tech Stack & Architectural Rules
- **No Panics Allowed:** It is **STRICTLY FORBIDDEN** to use `.unwrap()` or `.expect()` in production code (only allowed in tests). Handle all errors gracefully by propagating them with `?` using `thiserror` (`SyncError`) and `anyhow`.
- **Async Runtime:** `tokio` (full features) + `async-trait`.
- **Local Database (MMEX):** `rusqlite` with features `["bundled", "chrono"]`. 
  - Always set `busy_timeout` and `journal_mode = WAL`. Multiple SQLite writes MUST happen inside an explicit atomic transaction (`conn.transaction()`).
- **RemoteServer Pattern:** `src/remoteserver/` uses a Ports & Adapters approach. The sync engine must depend exclusively on the generic `RemoteServer` trait, never directly on PocketBase structures.
- **Network & TLS:** `reqwest` with `rustls-tls` and `default-features = false` (zero system OpenSSL dependencies for clean cross-compilation).
- **`.emb` Cryptography:** Pure Rust crates from the `RustCrypto` family (`aes`, `cipher`, `pbkdf2`, `cbc`).
- **Native GUI:** `eframe` (`egui`) and `rfd` (enabled via the default `gui` feature in `Cargo.toml`).
- **Internationalization (i18n):** Text strings are saved in `locales/en.json` and `locales/it.json`, and embedded at compile time.

## Target Module Structure (`src/`)
- `main.rs` & `cli.rs` -> Entrypoint, CLI vs GUI dispatch, and `clap` argument parsing.
- `config.rs` -> JSON profile configuration management and `.env` loading.
- `error.rs` -> Centralized `SyncError` enum (`thiserror`).
- `i18n.rs` -> JSON translation logic and OS language detection fallback.
- `domain/` -> Pure structs, data models, and conflict resolution rules (agnostic to DB or Cloud).
- `crypto/` -> Decryption and native encryption logic for `.emb` files and `.key` credentials.
- `db/` -> SQLite repository, MMEX queries, atomic transactions, and schema migration.
- `remoteserver/` -> `RemoteServer` trait and concrete implementations (e.g., `pocketbase.rs`).
- `sync/` -> Async sync orchestrator (INIT, PUSH, PULL, RUN, WATCH modes).
- `gui/` -> Native `egui` application state, layout, and background worker threads.
