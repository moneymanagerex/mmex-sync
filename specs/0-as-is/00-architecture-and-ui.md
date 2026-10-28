# AS-IS Technical Specification: 00 — Architecture, CLI, Configuration, GUI, and i18n

> **Baseline Version:** `0.3.0` (Rust Edition 2021)  
> **Scope:** Module organization, application startup lifecycle, CLI arguments, `.env` variables, profile/configuration persistence, native desktop GUI (`eframe`/`egui`), and internationalization (`i18n`).

---

## 1. Module Architecture Overview

The `mmex-sync` crate is structured as both a library (`mmex_sync` in `src/lib.rs`) and a binary (`mmex-sync` in `src/main.rs`).

```text
src/
├── main.rs                 # Binary entry point: .env loading, CLI parsing, i18n init, logging, GUI vs CLI dispatch
├── lib.rs                  # Root library exports
├── cli.rs                  # Clap-based CLI argument definitions and environment variable bindings
├── config.rs               # GlobalConfig, ProfileConfig, EffectiveConfig, and ConfigManager
├── error.rs                # SyncError domain error enum with localized Display implementation
├── i18n.rs                 # Compile-time embedded JSON localization (en.json / it.json) and locale detection
├── crypto/
│   ├── mod.rs              # Re-exports for credentials and .emb encryption
│   ├── credentials.rs      # AES-256-GCM local secret protection using a 256-bit master key (.key)
│   └── emb.rs              # AES-256-CBC + PBKDF2 handler for encrypted MMEX databases (.emb)
├── db/
│   ├── mod.rs              # Re-exports for DatabaseService and schema helpers
│   ├── schema.rs           # DDL creation, pb_sync_info, pb_DELETED_RECORDS_LOG, pb_* columns, and SQLite triggers
│   └── repository.rs       # DatabaseService: CRUD, dirty record queries, pull application, and FK cascade
├── domain/
│   ├── mod.rs              # Domain re-exports
│   ├── model.rs            # SyncStatus, RecordValue, LocalRecord, RemoteRecord, DeletedRecordEntry, TableSchemaInfo
│   ├── sync_order.rs       # SYNC_ORDER (22 tables), TableConfig, UniqueConstraint, and FK_MAP
│   └── conflict.rs         # ConflictResolutionAction, resolve_lww_conflict, check_pk_cascade_needed
├── remoteserver/
│   ├── mod.rs              # RemoteServer async trait, AuthResponse, and create_remote_server factory
│   └── pocketbase.rs       # Concrete PocketBaseClient REST adapter
├── sync/
│   ├── mod.rs              # Re-exports for SyncEngine and SyncRunner
│   ├── engine.rs           # SyncEngine: atomic INIT -> PUSH (deletions + records) -> PULL orchestration
│   └── runner.rs           # SyncRunner: execution modes ("sync", "run", "watch")
└── gui/                    # Compiled only when feature "gui" is enabled (default = ["gui"])
    ├── mod.rs              # eframe::run_native launcher (800x640 viewport, min 640x480)
    ├── app.rs              # MmexSyncGuiApp state machine, background worker threads, and egui rendering
    └── i18n.rs             # Re-exports crate::i18n::*
```

### Cargo Features
- `default = ["gui"]`
- `gui = ["dep:eframe", "dep:rfd"]`: Enables the native desktop interface (`eframe` `0.30` with `default_fonts`, `glow`, `x11`, `wayland` and `rfd` `0.15` with `default-features = false, features = ["gtk3"]` for direct GTK3 native file dialogs on Linux/WSL without requiring a D-Bus `xdg-desktop-portal` service).
- Building with `--no-default-features` produces a headless CLI-only binary (used for cross-compiling to macOS from Linux when the Apple Cocoa SDK is unavailable).

---

## 2. Startup Lifecycle (`src/main.rs`)

When `mmex-sync` starts, `main()` executes the following sequential steps:

1. **Environment File Loading:** Calls `dotenvy::dotenv()` (ignoring errors if `.env` is absent) to populate process environment variables before CLI parsing.
2. **CLI Parsing:** Parses command-line arguments and bound environment variables into `CliArgs` via `clap::Parser`.
3. **Locale Initialization:**
   - Instantiates `ConfigManager::new()` (if possible) and reads `language` from `mmex-sync.config.json` via `get_saved_language()`.
   - Calls `detect_best_locale(initial_lang.as_deref())`, which resolves the language in priority order:
     1. Saved user preference in `mmex-sync.config.json` (`en` or `it`).
     2. Operating system locale returned by `sys_locale::get_locale()`.
     3. Fallback to `Language::En`.
   - Stores the resolved `Language` in the global atomic `CURRENT_LOCALE` via `set_current_locale()`.
4. **Tracing Subscriber Initialization:**
   - Sets log level to `Level::DEBUG` if `--verbose` (`MMEX_VERBOSE`) is true, otherwise `Level::INFO`.
   - Initializes a global `tracing_subscriber::FmtSubscriber` with `with_target(false)`.
   - Logs the startup banner (`cli.banner`) with `env!("CARGO_PKG_VERSION")`.
5. **Deterministic Execution Mode Dispatch (GUI vs. Headless CLI):**
   - Computes `is_profile_cmd`:
     ```rust
     let is_profile_cmd = args.list_profile
         || args.show_profile.is_some()
         || args.delete_profile.is_some()
         || args.set_default_profile.is_some()
         || args.rename_profile_to.is_some()
         || args.set_default_mode.is_some();
     ```
   - **If `args.cli == true` or `is_profile_cmd == true`:** Executes headless in the terminal via `run_cli(args)` without opening any GUI window.
   - **If `!args.cli && !is_profile_cmd`:**
     - **When compiled with `#[cfg(feature = "gui")]`:**
       - If `args.gui == true`: Calls `mmex_sync::gui::run_gui(args, false)` (pure configuration mode, auto-start countdown disabled).
       - If `args.gui == false` (no mode flag passed): Calls `mmex_sync::gui::run_gui(args, true)`. If the active profile is complete (`is_profile_ready_for_autostart()`) and `autoStart == true`, starts a 3-second interruptible countdown (`Esc` or Cancel button) before automatically executing the profile's `default_mode` (`run`, `sync`, or `watch`).
     - **When compiled with `#[cfg(not(feature = "gui"))]`:**
       - If `--gui` is passed, aborts with error `cli.no_gui_compiled`.
       - Otherwise prints CLI edition help messages (`cli.cli_edition_help_1`, `cli.cli_edition_help_2`) and `CliArgs::command().print_help()`, then returns `Ok(())`.
6. **Headless CLI Execution (`run_cli`):**
   - Builds a multi-threaded Tokio runtime (`Builder::new_multi_thread().enable_all().build()`) and blocks on `run_cli(args)`.
   - Handles profile maintenance commands first:
     - `--listProfile`
     - `--showProfile[=<name>]`
     - `--deleteProfile[=<name>]`
     - `--setDefaultProfile=<name>`
     - `--renameProfileTo=<new_name>`
     - `--setDefaultMode=<mode>` (persists `defaultMode` to `<profile>.mmex-sync.json`, and exits immediately unless combined with `--cli` or an execution flag).
   - Resolves `EffectiveConfig` via `config_mgr.get_effective_config(&args)`.
   - Connects to the local database via `DatabaseService::connect(&config.db_path, config.verbose, config.file_password.as_deref(), args.create)`.
   - If `--clearDb` is set, runs `db.clear_technical()`, flushes via `db.flush()` (ensuring `.emb` changes are persisted), and exits.
   - Instantiates the remote server via `create_remote_server(&config.server_type, &config.url)`.
   - **Remote Authentication Flow in CLI:**
     - If both `config.user` and `config.pass` are provided, calls `remote.authenticate(user, pass).await`. On success, encrypts the returned JWT token with `protect(&auth.token, None)` and saves both `encrypted_token` and the resolved `pb_auth_collection` (`"users"` or `"_superusers"`) to `<profile>.mmex-sync.json`.
     - Otherwise, if `current_profile.encrypted_token` exists, decrypts it with `unprotect(enc_token, None)`, calls `remote.set_token(tok, config.auth_collection.clone())`, and attempts `remote.refresh_token().await` (updating `encrypted_token` and `pb_auth_collection` in the profile on success, or logging an error without aborting if refresh fails).
   - If `--clearServer` is set (evaluated *after* the remote authentication block so the client carries an active authorization token), runs `remote.clear_remote_server(SYNC_ORDER).await` and exits.
   - Constructs `SyncOptions` and `SyncRunner` and executes `runner.run(requested_mode).await`.

---

## 3. CLI Parameters and Environment Variables (`src/cli.rs`)

All CLI flags use `clap` long options (case-sensitive as defined in `#[arg(long = "...")]`).

| CLI Flag | Rust Field | Type | Bound Env Var | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--profile <NAME>` | `profile` | `Option<String>` | `MMEX_PROFILE` | Selects the configuration profile |
| `--ignoreProfile` | `ignore_profile` | `bool` | — | Ignores saved profile JSON and uses defaults |
| `--listProfile` | `list_profile` | `bool` | — | Lists all profiles in the config directory |
| `--showProfile [<NAME>]` | `show_profile` | `Option<Option<String>>` | — | Prints profile JSON (`num_args = 0..=1`) |
| `--deleteProfile [<NAME>]` | `delete_profile` | `Option<Option<String>>` | — | Deletes specified or default profile (`num_args = 0..=1`) |
| `--setDefaultProfile <NAME>` | `set_default_profile` | `Option<String>` | — | Updates `defaultProfile` in `mmex-sync.config.json` |
| `--renameProfileTo <NAME>` | `rename_profile_to` | `Option<String>` | — | Renames active/default profile |
| `--setDefaultMode <MODE>` | `set_default_mode` | `Option<String>` | — | Overrides `default_mode` in `EffectiveConfig` (note: in AS-IS CLI it does not persist to disk unless saved) |
| `--db <PATH>` | `db` | `Option<PathBuf>` | `MMEX_DB_PATH` | Path to local `.mmb` or `.emb` file |
| `--filePassword <PWD>` | `file_password` | `Option<String>` | `MMEX_FILE_PASSWORD` | Password for encrypted `.emb` database |
| `--saveFilePassword <VAL>` | `save_file_password` | `Option<String>` | — | Whether to save `.emb` password (`yes`/`no`) |
| `--exe <PATH>` | `exe` | `Option<PathBuf>` | `MMEX_EXE_PATH` | Path to the MMEX desktop executable |
| `--create` | `create` | `bool` | — | Creates and initializes an empty MMEX database |
| `--serverType <TYPE>` | `server_type` | `Option<String>` | `MMEX_REMOTE_PROVIDER` | Remote backend type (default: `pocketbase`) |
| `--url <URL>` | `url` | `Option<String>` | `MMEX_REMOTE_URL` | Remote server URL (default: `http://127.0.0.1:8090`) |
| `--user <USER>` | `user` | `Option<String>` | `MMEX_REMOTE_USER` | Remote authentication identity/email |
| `--pass <PASS>` | `pass` | `Option<String>` | `MMEX_REMOTE_PASS` | Remote authentication password |
| `--sync [<OPS>]` | `sync` | `Option<Option<String>>` | — | Runs sync (`init,push,pull` if no value, or comma-separated subset) |
| `--force` | `force` | `bool` | — | Ignores `pb_is_dirty` and `lastSync` timestamps |
| `--run` | `run` | `bool` | — | Sandwich sync mode (Pre-sync -> MMEX -> Post-sync) |
| `--watch` | `watch` | `bool` | — | Watch mode (Pre-sync -> detached MMEX -> 3s file mtime polling) |
| `--clearDb` | `clear_db` | `bool` | — | Strips `pb_*` columns, triggers, and metadata tables from local DB |
| `--clearServer` | `clear_server` | `bool` | — | Deletes all records from remote collections in reverse `SYNC_ORDER` |
| `--verbose` | `verbose` | `bool` | `MMEX_VERBOSE` | Enables `DEBUG` level logging |
| `--nowait` | `nowait` | `bool` | — | Parsed in `CliArgs` (currently unused in Rust execution flow) |
| `--cli` | `cli` | `bool` | — | Forces headless CLI execution in the terminal |
| `--gui` | `gui` | `bool` | — | Opens the native desktop GUI in configuration mode (blocks auto-start) |
| `--checkForUpdate` | `check_for_update` | `bool` | — | Parsed in `CliArgs` (placeholder, not wired in `main.rs`) |
| `--autoDownloadUpdate` | `auto_download_update` | `bool` | — | Parsed in `CliArgs` (placeholder, not wired in `main.rs`) |

---

## 4. Configuration & Profile Persistence (`src/config.rs`)

### Storage Directory (`get_config_dir`)
- **Windows (`cfg!(target_os = "windows")`)**: `<dirs::data_dir() or ~/AppData/Roaming>/mmex-sync`
- **Linux / macOS / Unix**: `~/.mmex-sync`
- Automatically created via `fs::create_dir_all` if missing.

### Files in Configuration Directory
1. **`mmex-sync.config.json` (`GlobalConfig`)**:
   ```json
   {
     "defaultProfile": "default",
     "language": "it"
   }
   ```
   - `defaultProfile` defaults to `"default"` if missing or empty.
   - `language` is optional (`Option<String>`).
2. **`<profile>.mmex-sync.json` (`ProfileConfig`)**:
   ```json
   {
     "dbPath": "/path/to/file.mmb",
     "serverType": "pocketbase",
     "pbUrl": "http://127.0.0.1:8090",
     "pbAuthCollection": "users",
     "pbUser": "user@example.com",
     "encryptedToken": "v1:...",
     "encryptedFilePassword": "v1:...",
     "mmexExe": "/usr/bin/mmex",
     "defaultMode": "run",
     "autoStart": true,
     "lastSync": "2026-10-28T07:00:00Z",
     "isRunning": false,
     "savePassword": "yes"
   }
   ```
3. **`.key`**: 32-byte raw binary master key used by `crypto::credentials` (mode `0o600` on Unix).

### Priority Resolution (`ConfigManager::get_effective_config`)
`get_effective_config` resolves parameters in order **`CLI Args (and bound ENV vars) > Profile JSON (unless --ignoreProfile) > Hardcoded Defaults`**:
- `profile`: `args.profile` (if non-empty) -> `get_default_profile()` (`"default"`).
- `db_path`: `args.db` -> `profile.db_path` -> returns `SyncError::Config(errors.db_path_not_specified)`. Expands leading `~` or `~/` (`~\` on Windows) via `expand_tilde()`.
- `server_type`: `args.server_type` -> `profile.server_type` -> `"pocketbase"`.
- `url`: `args.url` -> `profile.pb_url` -> `"http://127.0.0.1:8090"`.
- `user`: `args.user` -> `profile.pb_user`.
- `pass`: `args.pass` (never stored in plaintext).
- `mmex_exe`: `args.exe` -> `profile.mmex_exe` (with `expand_tilde()`).
- `default_mode`: `args.set_default_mode` -> `profile.default_mode` -> `"run"`.
- `save_file_password`: `true` unless the string value is `"no"`, `"false"`, or `"n"` (case-insensitive).
- `file_password`: `args.file_password` (note: in CLI mode, `get_effective_config` reads `args.file_password`, whereas in GUI mode `load_profile_data` also decrypts `profile.encrypted_file_password` via `unprotect`).

---

## 5. Native Desktop GUI (`src/gui/`)

### Viewport & Theme
- Launched via `eframe::run_native("MMEX-Sync", ...)` with window title `"MMEX-Sync - Configuration & Synchronization Gateway"`.
- Initial window size: `800.0 x 640.0` (minimum `640.0 x 480.0`).
- Uses `egui::Visuals::dark()` with `window_rounding = 8.0` and `menu_rounding = 6.0`.

### Threading & Event Architecture
- The UI runs on the main thread and communicates with background worker threads via a `std::sync::mpsc::channel::<GuiEvent>()`.
- On every frame (`eframe::App::update`), `drain_events()` polls `self.rx.try_recv()` non-blockingly. While `self.is_working == true`, the UI calls `ctx.request_repaint()` to animate the status spinner and stream log lines.
- Each background operation (`trigger_sync_async`, `trigger_test_connection_async`, `trigger_clear_db_async`, `trigger_clear_server_async`) spawns a `std::thread` which creates a single-threaded Tokio runtime (`Builder::new_current_thread().enable_all().build()`) to execute async work and send `GuiEvent` messages back:
  - `GuiEvent::Log(String)`: Prepends `[HH:MM:SS]` local time and appends to `self.logs` (ring buffer capped at **300 lines**). Lines containing `"❌"` or `"Errore"` render in red; lines containing `"✅"` render in green.
  - `GuiEvent::Status { message, is_error }`: Updates the bottom status bar.
  - `GuiEvent::SyncFinished { last_sync }`: Clears `self.is_working`; if `last_sync` is `Some(ts)`, updates `self.last_sync` and persists it into `<active_profile>.mmex-sync.json`.
  - `GuiEvent::TestFinished { success, message }` & `GuiEvent::ClearFinished { success, message }`: Clear `self.is_working` and update the bottom status bar.

### GUI Sections & Menus
1. **Top Menu Bar:**
   - **Profiles:** New Profile, Open Profile (auto-saves current profile before switching), Save Profile, Save As (`<active>_copy`), Rename Profile, Set as Default (disabled if already default), Delete Profile (with confirmation modal), Exit.
   - **Edit:** Select Database (`rfd::FileDialog::pick_file` filter: `mmb`, `emb`), Create New MMEX Database (`rfd::FileDialog::save_file` filter: `mmb`, `emb`), Select MMEX Executable (`rfd`).
   - **Synchronization:** Full Sync (`push=true, pull=true`), Push Only (`push=true, pull=false`), Pull Only (`push=false, pull=true`), Test Connection, Force Mode checkbox.
   - **Preferences:** Language switcher (`🇮🇹 Italiano` / `🇬🇧 English`), which immediately updates `self.lang`, `CURRENT_LOCALE`, and saves `"language"` to `mmex-sync.config.json`.
   - **Tools:** Clear Local DB (confirmation modal), Clear Remote Server (confirmation modal).
   - **Help:** About modal.
2. **Central Panel:**
   - Active profile heading + `[DEFAULT]` badge.
   - Collapsible **Local MMEX Database** section: DB path input + Browse button + **➕ New DB...** button (`prompt_create_new_db`: opens `rfd::FileDialog::save_file()`, defaults extension to `.mmb` if omitted; for `.mmb` immediately saves the profile and initializes the schema on a background thread via `trigger_create_db_async()`; for `.emb` clears `file_password` and opens a dedicated password modal before initializing and encrypting the new `.emb` file); if path ends with `.emb` (case-insensitive), displays password input and "Save encrypted password in profile" checkbox.
   - Collapsible **Remote Server** section: Server Type combo (`PocketBase`), Server URL, User/Email, Password (masked). *(Note: `pbAuthCollection` is managed automatically in the profile and is not exposed in the UI).*
   - Collapsible **Runner & Execution** section: MMEX Executable path + Browse, Default Mode combo (`run`, `sync`, `watch`), Auto-Start on Launch (`autoStart`) checkbox, Force Mode checkbox, Verbose checkbox.
   - **Auto-Start Countdown Banner:** When launched without `--gui` (`allow_auto_start == true`), if `autoStart == true` and the profile is ready (`dbPath` exists, `.emb` password present if `.emb`, `pbUrl` non-empty, and credentials or `encryptedToken` present), displays a 3-second animated countdown bar that can be cancelled via `Esc`, clicking `Cancel Auto-Start (Esc)`, or modifying any profile field; upon completion it launches `trigger_default_mode_async()` (`run`, `sync`, or `watch`).
   - Primary action buttons bar: `Run (<DEFAULT_MODE>)` (or `Stop Watch` while `watch` mode is active), `Full Sync`, `Push Only`, `Pull Only`, `Test Connection`, `Save Profile`.
   - Real-time Log Console with `Clear Logs` button.
3. **Bottom Status Bar:**
   - Left: Spinner when `is_working`, colored status message (`✓` green or `⚠` red), or `Ready`.
   - Right: `Last Sync: <timestamp or Never>`.

---

## 6. Internationalization (`src/i18n.rs`)

- **Compile-time Embedding:** `locales/en.json` and `locales/it.json` are embedded into the binary via `include_str!("../locales/en.json")` and `include_str!("../locales/it.json")` and lazily parsed into `OnceLock<HashMap<String, String>>` (`EN_MAP`, `IT_MAP`).
- **Global Active Locale:** Stored in `static CURRENT_LOCALE: AtomicU8` (`0` = `Language::En`, `1` = `Language::It`).
- **Normalization (`normalize_locale_code`):**
  1. Trims whitespace.
  2. Strips encoding suffix starting at `.` (e.g., `.UTF-8`) and modifier suffix starting at `@` (e.g., `@euro`).
  3. Splits on `-` or `_` and converts the primary language subtag to lowercase (`"it_IT.UTF-8"` -> `"it"`, `"en-US"` -> `"en"`).
- **Translation & Fallback (`translate`, `t`, `t_fmt`):**
  - Looks up `key` in the active language map.
  - If missing and active language is not `En`, falls back to `EN_MAP`.
  - If still missing, `translate()` returns `""`, while `t_fmt()` uses the raw `key` string as the template and replaces `{param}` placeholders.

---

## Invarianti di Sistema

1. **Zero External Runtime Asset Dependencies:** Localization catalogs (`en.json`, `it.json`) and SQL schema definitions (`tables_v1_for_sync.sql`) MUST remain embedded at compile time (`include_str!`) so the compiled binary is 100% portable as a single file.
2. **Strict Translation Key Parity:** `locales/en.json` and `locales/it.json` MUST contain the exact same set of keys (enforced by unit test `test_json_key_parity`).
3. **Configuration Precedence:** Effective configuration MUST always follow `CLI Arguments / Environment Variables > Saved Profile JSON > Default Values`, unless `--ignoreProfile` is passed (which bypasses the saved Profile JSON).
4. **Cross-Platform Configuration Path Compatibility:** Config files MUST be stored in `%APPDATA%\mmex-sync` on Windows and `~/.mmex-sync` on Linux/macOS to preserve compatibility with existing user profiles and `.key` files.
5. **GUI Non-Blocking Responsiveness:** All database, network, and encryption operations triggered from the GUI MUST execute on background threads communicating via `mpsc::channel<GuiEvent>`, with `self.is_working` preventing concurrent overlapping operations.
6. **Automatic Profile Rename Propagation:** Renaming a profile that is currently set as `defaultProfile` in `mmex-sync.config.json` MUST automatically update `defaultProfile` to the new profile name.

