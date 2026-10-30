# MMEX-Sync (Rust Edition) — User & Reference Guide

Welcome to the comprehensive help guide for **MMEX-Sync v0.3.0 (Rust Native Gateway)**, the non-intrusive, **Offline-First** synchronization engine for **Money Manager Ex (MMEX)**.

---

## 📑 Table of Contents

1. [Overview & Key Features](#-1-overview--key-features)
2. [Quick Start & Execution Modes](#-2-quick-start--execution-modes)
   - [Desktop GUI Mode (Default)](#21-desktop-gui-mode-default)
   - [Auto-Start Countdown Mechanism](#22-auto-start-countdown-mechanism)
   - [Headless CLI Mode (`--cli`)](#23-headless-cli-mode---cli)
3. [Using the Native Desktop GUI](#️-3-using-the-native-desktop-gui)
   - [Top Menu Bar](#31-top-menu-bar)
   - [Dashboard Configuration Sections](#32-dashboard-configuration-sections)
   - [Action Toolbar & Event Log Console](#33-action-toolbar--event-log-console)
4. [Operating Workflows (`run`, `watch`, `sync`)](#-4-operating-workflows-run-watch-sync)
   - [`run` Mode — The "Sandwich" Sync](#41-run-mode--the-sandwich-sync)
   - [`watch` Mode — Real-Time Monitoring](#42-watch-mode--real-time-monitoring)
   - [`sync` Mode — Granular Sync Cycles](#43-sync-mode--granular-sync-cycles)
   - [Force Mode (`--force`)](#44-force-mode---force)
5. [Command-Line Interface (CLI) Reference](#-5-command-line-interface-cli-reference)
   - [All CLI Options](#51-all-cli-options)
   - [Environment Variables & `.env` Support](#52-environment-variables--env-support)
   - [Common CLI Examples](#53-common-cli-examples)
6. [Profiles, Configuration Files & Precedence](#-6-profiles-configuration-files--precedence)
   - [Configuration Directory Locations](#61-configuration-directory-locations)
   - [Global & Profile JSON Structure](#62-global--profile-json-structure)
7. [Security & Encrypted Databases (`.emb`)](#-7-security--encrypted-databases-emb)
   - [Credential & Token Protection (AES-256-GCM)](#71-credential--token-protection-aes-256-gcm)
   - [Transparent `.emb` Database Support (AES-256-CBC)](#72-transparent-emb-database-support-aes-256-cbc)
8. [Maintenance, Database Creation & Rollback](#-8-maintenance-database-creation--rollback)
   - [Creating a New Empty Database](#81-creating-a-new-empty-database)
   - [Cleaning Local Technical Schema (`--clearDb`)](#82-cleaning-local-technical-schema---cleardb)
   - [Wiping Remote Server Data (`--clearServer`)](#83-wiping-remote-server-data---clearserver)
9. [Synchronization Architecture & Troubleshooting](#️-9-synchronization-architecture--troubleshooting)

---

## 🎯 1. Overview & Key Features

`mmex-sync` is a standalone native synchronization sidecar written in **Rust**. It synchronizes your local Money Manager Ex SQLite database (`.mmb` or encrypted `.emb`) with a remote cloud backend (**PocketBase**, with hexagonal architecture ready for future providers) at the **record level**, without requiring any changes to the MMEX C++ desktop application.

### Highlights of the Rust Implementation
* **Single Standalone Native Binary:** Uses bundled SQLite (`rusqlite`), pure-Rust TLS (`rustls`), and pure-Rust cryptography (`RustCrypto`) with zero external OpenSSL or runtime dependencies.
* **Dual Interface (Native GUI + Headless CLI):** Includes an immediate-mode native desktop dashboard (`eframe`/`egui`) alongside a full-featured headless CLI for scripting and automation.
* **Smart Auto-Start Workflow:** Launching `mmex-sync` with a configured profile automatically triggers a cancellable 3-second countdown to start your preferred workflow (`run`, `watch`, or `sync`).
* **Transparent `.emb` Encryption:** Natively decrypts and re-encrypts password-protected `.emb` databases using safe atomic temporary files.
* **Zero Plaintext Secrets:** Remote passwords are never written to disk. Session JWT tokens and optional `.emb` passwords are encrypted locally using **AES-256-GCM**.
* **Multi-Language Support (i18n):** Built-in **English** and **Italian** localization with automatic OS locale detection and instant switching in the GUI.

---

## 🚀 2. Quick Start & Execution Modes

`mmex-sync` determines whether to launch the **Native Desktop GUI** or run in **Headless CLI** mode based on the flags passed at startup.

### 2.1 Desktop GUI Mode (Default)

Running `mmex-sync` without `--cli` (for example, by double-clicking the executable or running `mmex-sync` in a terminal) launches the **Native Desktop GUI**:

```bash
# Opens the GUI (and starts the 3-second Auto-Start countdown if the profile is ready)
mmex-sync

# Opens the GUI and explicitly blocks Auto-Start so you can edit settings immediately
mmex-sync --gui
```

You can also pre-populate or override profile fields in the GUI from the command line:

```bash
mmex-sync --gui --profile=work --db=~/Finances/work.mmb --url=http://127.0.0.1:8090
```

### 2.2 Auto-Start Countdown Mechanism

When you launch `mmex-sync` (without `--gui` and without `--cli`), the application checks whether the active profile is ready for automatic execution:
1. `autoStart` is enabled in the profile (`true` by default).
2. The configured database file (`dbPath`) exists on disk.
3. If the database is an encrypted `.emb` file, its password is available.
4. A remote server URL (`pbUrl`) is configured.
5. Either a saved encrypted auth token (`encryptedToken`) or remote credentials (`user` + `pass`) are present.

If all conditions are met, a **3-second countdown banner** appears at the top of the GUI:
* **If you do nothing:** When the 3 seconds elapse, `mmex-sync` automatically starts the profile's **Default Mode** (`run`, `watch`, or `sync`).
* **To cancel the countdown:** Press **`Esc`**, click **`✖ Cancel Auto-Start (Esc)`**, or click/edit any field or menu item in the window.

### 2.3 Headless CLI Mode (`--cli`)

To execute synchronization, `run`, `watch`, or maintenance tasks directly in the terminal **without opening the GUI**, pass the `--cli` flag:

```bash
# Run a full headless sync cycle in the terminal
mmex-sync --cli --sync

# Run the "Sandwich" workflow in the terminal
mmex-sync --cli --run
```

> [!NOTE]
> **Profile inspection & management commands** (`--listProfile`, `--showProfile`, `--deleteProfile`, `--setDefaultProfile`, `--renameProfileTo`, and standalone `--setDefaultMode`) automatically execute in the terminal and exit without requiring `--cli`.
>
> *(Note for legacy users: the old `--nogui` flag has been replaced by `--cli`.)*

---

## 🖥️ 3. Using the Native Desktop GUI

### 3.1 Top Menu Bar

* **Profiles**
  * **New Profile...**: Creates a new empty configuration profile and switches to it.
  * **Open Profile**: Quickly switch between saved profiles (the active profile is marked with `✓`).
  * **Save Profile**: Saves the current settings to `<profile>.mmex-sync.json`.
  * **Save As...**: Duplicates the active profile under a new name.
  * **Rename Profile...**: Renames the current profile file (and updates the global default if applicable).
  * **Set as Default**: Marks the active profile as the default profile loaded on startup.
  * **Delete Profile**: Permanently deletes the current profile after confirmation.
  * **Exit**: Closes the application.
* **Edit**
  * **MMEX Database...**: Opens the native OS file picker to select an existing `.mmb` or `.emb` database.
  * **Create New MMEX Database...**: Opens a save dialog to create and initialize a brand-new `.mmb` or encrypted `.emb` database.
  * **Money Manager Ex Executable...**: Opens a file dialog to select the MMEX desktop binary (`mmex` or `mmex.exe`).
* **Synchronization**
  * **Start Full Sync (Push + Pull)**: Runs schema initialization, uploads local changes, and downloads remote changes.
  * **Run Push Only (Local -> Remote)**: Uploads local changes and deletions to the cloud without pulling.
  * **Run Pull Only (Remote -> Local)**: Downloads remote records into the local database without pushing.
  * **Test Connection & Verify Token**: Authenticates against the remote server and saves the refreshed encrypted JWT token.
  * **Use Force Mode**: Toggles `--force` mode for subsequent sync operations.
* **Preferences**
  * **Interface Language**: Switch immediately between **🇬🇧 English** and **🇮🇹 Italiano**. The choice is saved in `mmex-sync.config.json`.
* **Tools**
  * **Clean Local Technical Schema**: Removes all `TRG_*` triggers, `pb_*` columns, and sync metadata tables from the local database.
  * **Clean Remote Server**: Deletes all synchronized records across all collections on the remote PocketBase server.
* **Help**
  * **About MMEX-Sync**: Displays version and architecture details.

### 3.2 Dashboard Configuration Sections

1. **📁 Local MMEX Database**
   * **Database Path (`.mmb`/`.emb`)**: Path to your local database file (supports `~` home expansion). Use **Browse...** to select an existing file or **➕ New DB...** to create a new one.
   * **Encrypted Database Password (`.emb`)**: Shown automatically when the path ends with `.emb`. Check **Save protected password** to store it encrypted (AES-256-GCM) in your profile.
2. **🌐 Remote Cloud Server**
   * **Remote Provider**: Select the cloud backend (`PocketBase`).
   * **Server URL**: Endpoint of your PocketBase server (e.g., `https://mmex-sync.prudenzano.org` or `http://127.0.0.1:8090`).
   * **Email / Username**: Your PocketBase account email/identity.
   * **Remote Password**: Your account password. Used to obtain or refresh the encrypted JWT token; never stored in plaintext.
3. **⚙️ MMEX Execution & Mode**
   * **MMEX Executable**: Path to your Money Manager Ex desktop executable (required for `Run` and `Watch` modes).
   * **Default Mode**: Choose between:
     * `Run (MMEX Launcher)` (`run`)
     * `Sync Only` (`sync`)
     * `Watch File` (`watch`)
   * **Checkboxes**:
     * **🚀 Auto-Start on Launch**: Enables/disables the 3-second auto-start countdown when opening `mmex-sync`.
     * **⚡ Force Mode**: Forces full record comparison ignoring `lastSync` and `pb_is_dirty`.
     * **📝 Verbose Logging**: Enables detailed diagnostic output.

### 3.3 Action Toolbar & Event Log Console

* **▶ Run (`<MODE>`)**: Executes the currently selected Default Mode (`RUN`, `SYNC`, or `WATCH`). When `WATCH` mode is active, this button turns into **⏹ Stop Watch** (you can also press `Esc` to stop watching).
* **🔄 Sync (Push + Pull)**: Performs a complete one-shot synchronization cycle.
* **⬆ Push Only** / **⬇ Pull Only**: Performs a unidirectional synchronization cycle.
* **🔌 Test Connection**: Tests remote server reachability and credentials.
* **💾 Save Profile**: Persists all current UI fields to the active profile.
* **📋 Event Log & Operations Console**: Displays timestamped real-time logs with color-coded success (`✅`) and error (`❌`) indicators, plus a bottom status bar showing the active operation spinner and the **Last Synchronization** timestamp.

---

## 🔄 4. Operating Workflows (`run`, `watch`, `sync`)

### 4.1 `run` Mode — The "Sandwich" Sync
Designed for daily desktop use so you never forget to sync before or after editing your finances:
1. **Pre-Sync:** Runs a full sync cycle (`init` + `push` + `pull`) to bring your local database up to date with any changes made on Android or other PCs.
2. **Launch MMEX:** Starts the Money Manager Ex desktop application with your database path and waits until you close MMEX. *(If the MMEX executable is not configured or missing, it logs a warning and falls back to a standard `sync` cycle.)*
3. **Post-Sync:** Automatically runs a final sync cycle (`init` + `push` + `pull`) to upload all changes made during your MMEX session.

### 4.2 `watch` Mode — Real-Time Monitoring
1. **Pre-Sync:** Runs an initial full synchronization cycle.
2. **Background Launch:** Launches Money Manager Ex in the background (if configured).
3. **Continuous File Watching:** Polls the local database file modification timestamp every 3 seconds. Whenever MMEX writes changes to disk, `mmex-sync` automatically runs a sync cycle and updates `lastSync`.
4. **Stop:** Press **`Ctrl+C`** in the terminal or click **⏹ Stop Watch** (or press **`Esc`**) in the GUI.

### 4.3 `sync` Mode — Granular Sync Cycles
Performs an immediate synchronization cycle without launching Money Manager Ex. In CLI mode, `--sync` accepts optional comma-separated phases:
* `init`: Creates/upgrades the `pb_sync_info` and `pb_DELETED_RECORDS_LOG` tables, adds `pb_id`, `pb_is_dirty`, and `pb_updated_at` columns to all 22 MMEX tables, and installs `INSERT`/`UPDATE`/`DELETE` SQLite triggers.
* `push`: Sends local deletions (`_is_deleted = true`) and local dirty records (`pb_is_dirty = 1` or `pb_id IS NULL`) to the remote server in topological dependency order.
* `pull`: Downloads remote records updated since `lastSync` (with a 5-second safety buffer for clock skew) and applies them atomically with `pb_is_dirty = 2` (Cloud Ingress) so local triggers do not fire recursively.

### 4.4 Force Mode (`--force`)
When `--force` is enabled:
* **Push phase:** Uploads all local records across all tables regardless of whether `pb_is_dirty = 1`.
* **Pull phase:** Fetches the entire remote collection ignoring the `lastSync` timestamp filter.

---

## 💻 5. Command-Line Interface (CLI) Reference

> [!IMPORTANT]
> In the Rust version, CLI flag names are **case-sensitive** (using camelCase for multi-word flags such as `--listProfile`, `--clearDb`, `--filePassword`). Always pass `--cli` when running sync, run, watch, or cleanup operations headlessly in the terminal.

### 5.1 All CLI Options

| Option | Env Variable | Description |
| :--- | :--- | :--- |
| `--gui` | — | Launch the Native Desktop GUI and disable the auto-start countdown. |
| `--cli` | — | Force headless execution in the terminal without launching the GUI. |
| `--profile <NAME>` | `MMEX_PROFILE` | Select the configuration profile to use (e.g., `home`, `work`). |
| `--ignoreProfile` | — | Ignore saved profile settings and use only CLI/env/default values. |
| `--listProfile` | — | List all available profiles in the configuration directory and exit. |
| `--showProfile [<NAME>]` | — | Print the JSON configuration of the specified (or default) profile and exit. |
| `--deleteProfile [<NAME>]` | — | Delete the specified (or default) profile and exit. |
| `--setDefaultProfile <NAME>` | — | Set the default profile in `mmex-sync.config.json` and exit. |
| `--renameProfileTo <NEW>` | — | Rename the active (or `--profile`) profile to `<NEW>` and exit. |
| `--setDefaultMode <MODE>` | — | Set the default operating mode (`run`, `watch`, `sync`) for the profile. |
| `--db <PATH>` | `MMEX_DB_PATH` | Path to the local MMEX database (`.mmb` or encrypted `.emb`). |
| `--filePassword <PASS>` | `MMEX_FILE_PASSWORD` | Password used to decrypt/encrypt a `.emb` database file. |
| `--saveFilePassword <yes\|no>` | — | Whether to save the encrypted `.emb` password in the profile (`yes`/`no`). |
| `--exe <PATH>` | `MMEX_EXE_PATH` | Path to the Money Manager Ex executable (`mmex` or `mmex.exe`). |
| `--create` | — | Create and initialize a new empty local MMEX database from the built-in SQL schema before running. |
| `--serverType <TYPE>` | `MMEX_REMOTE_PROVIDER` | Remote backend provider (`pocketbase` by default). |
| `--url <URL>` | `MMEX_REMOTE_URL` | Remote server URL (default: `http://127.0.0.1:8090`). |
| `--user <USER>` | `MMEX_REMOTE_USER` | Email or username for remote server authentication. |
| `--pass <PASS>` | `MMEX_REMOTE_PASS` | Password for remote authentication (generates an encrypted token; never stored in plaintext). |
| `--sync [<OPS>]` | — | Run sync cycle. Default without `<OPS>`: `init,push,pull`. Or specify comma-separated phases (e.g., `--sync=pull`, `--sync=push`, `--sync=init,push`). |
| `--force` | — | Ignore `lastSync` timestamps and `pb_is_dirty` flags during sync. |
| `--run` | — | Execute **Run Mode** (Initial Sync -> Launch MMEX -> Wait -> Final Sync). |
| `--watch` | — | Execute **Watch Mode** (Initial Sync -> Launch MMEX -> Continuous monitoring). |
| `--clearDb` | — | Remove all technical sync columns, triggers, and metadata tables from the local DB. |
| `--clearServer` | — | Delete all records from all remote server collections (in reverse dependency order). |
| `--verbose` | `MMEX_VERBOSE` | Enable detailed `DEBUG`-level logging in the terminal. |
| `--nowait` | — | Disable waiting for user input before closing. |
| `--checkForUpdate` | — | Check for newer releases. |
| `--autoDownloadUpdate` | — | Automatically download and install updates. |
| `-h`, `--help` | — | Print CLI help summary. |
| `-V`, `--version` | — | Print `mmex-sync` version. |

### 5.2 Environment Variables & `.env` Support

`mmex-sync` automatically loads a `.env` file from the current working directory if present. You can configure credentials and paths via environment variables:

```ini
MMEX_PROFILE=personal
MMEX_DB_PATH=~/Documents/finances.emb
MMEX_FILE_PASSWORD=MyDatabasePassword
MMEX_EXE_PATH=/usr/bin/mmex
MMEX_REMOTE_PROVIDER=pocketbase
MMEX_REMOTE_URL=https://mmex-sync.prudenzano.org
MMEX_REMOTE_USER=user@example.com
MMEX_REMOTE_PASS=MyCloudPassword
MMEX_VERBOSE=true
```

### 5.3 Common CLI Examples

```bash
# 1. Manage profiles from the terminal
mmex-sync --listProfile
mmex-sync --showProfile=work
mmex-sync --setDefaultProfile=work
mmex-sync --profile=work --renameProfileTo=office
mmex-sync --setDefaultMode=run

# 2. First-time headless authentication & full synchronization
mmex-sync --cli --profile=personal \
  --db="~/Finances/my_data.mmb" \
  --url="https://mmex-sync.prudenzano.org" \
  --user="me@example.com" \
  --pass="MySecretPass" \
  --sync

# 3. Subsequent headless syncs (using the saved profile & encrypted token)
mmex-sync --cli --sync

# 4. Pull-only or Push-only in headless mode
mmex-sync --cli --sync=pull
mmex-sync --cli --sync=push

# 5. Force a full resynchronization with debug logs
mmex-sync --cli --sync --force --verbose

# 6. Create and initialize a brand-new encrypted .emb database and sync it
mmex-sync --cli --db="~/Finances/new_wallet.emb" --filePassword="StrongPassword123" --create --sync

# 7. Launch MMEX in "Sandwich" Run Mode from a script or shortcut
mmex-sync --cli --run
```

---

## 📂 6. Profiles, Configuration Files & Precedence

When resolving settings, `mmex-sync` applies the following strict priority order (from highest to lowest):

1. **Command-Line Arguments** (`--db`, `--url`, `--user`, etc.)
2. **Environment Variables / `.env` file** (`MMEX_DB_PATH`, `MMEX_REMOTE_URL`, etc.)
3. **Saved Profile JSON** (`<profile>.mmex-sync.json`, unless `--ignoreProfile` is set)
4. **Built-in Defaults** (`profile = "default"`, `serverType = "pocketbase"`, `url = "http://127.0.0.1:8090"`, `defaultMode = "run"`, `autoStart = true`)

### 6.1 Configuration Directory Locations

All configuration files and the local encryption master key are stored in your user configuration directory:
* **Linux & macOS:** `~/.mmex-sync/`
* **Windows:** `%APPDATA%\mmex-sync\` (typically `C:\Users\<Username>\AppData\Roaming\mmex-sync\`)

Directory contents:
* `mmex-sync.config.json`: Global configuration (stores `defaultProfile` and `language`).
* `<profile>.mmex-sync.json`: Individual profile configuration files (e.g., `default.mmex-sync.json`).
* `.key`: 256-bit (32-byte) binary master key generated via OS CSPRNG (`0600` permissions on Unix).

### 6.2 Global & Profile JSON Structure

**`mmex-sync.config.json`**:
```json
{
  "defaultProfile": "default",
  "language": "en"
}
```

**`default.mmex-sync.json`**:
```json
{
  "dbPath": "~/Finances/sample.mmb",
  "serverType": "pocketbase",
  "pbUrl": "https://mmex-sync.prudenzano.org",
  "pbAuthCollection": "users",
  "pbUser": "user@example.com",
  "encryptedToken": "v1:...",
  "encryptedFilePassword": "v1:...",
  "mmexExe": "/usr/bin/mmex",
  "defaultMode": "run",
  "autoStart": true,
  "lastSync": "2026-10-29T18:30:00Z",
  "isRunning": false,
  "savePassword": "yes"
}
```

---

## 🔐 7. Security & Encrypted Databases (`.emb`)

### 7.1 Credential & Token Protection (AES-256-GCM)
* **No Plaintext Passwords:** Your remote server password (`--pass`) is used solely to authenticate with the server and obtain a JWT token. It is never written to disk.
* **Authenticated Encryption:** Both the session JWT token (`encryptedToken`) and the optional `.emb` file password (`encryptedFilePassword`) are encrypted using **AES-256-GCM** with a random 96-bit nonce (`IV`) per encryption call and a 128-bit authentication tag (`v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`).

### 7.2 Transparent `.emb` Database Support (AES-256-CBC)
When `dbPath` points to a `.emb` file:
1. **Opening & Decryption:** `mmex-sync` reads the `.emb` container (`[16-byte Salt] + [16-byte IV] + [Ciphertext]`), derives the 256-bit key using PBKDF2 (automatically supporting standard 64,000-iteration `HMAC-SHA256`, SQLCipher 256,000-iteration `HMAC-SHA512`, and legacy 4,001-iteration `HMAC-SHA256`), verifies the SQLite header (`SQLite format 3\0`), and extracts the SQLite database into a secure temporary file.
2. **Synchronization:** All SQLite queries, triggers, and transactions execute at full speed against the temporary SQLite file.
3. **Atomic Re-Encryption (Flush):** At the end of the operation, if any changes were made, `mmex-sync` re-encrypts the SQLite data with a fresh random salt and IV (`AES-256-CBC` with PKCS#7 padding) and atomically replaces the target `.emb` file.

---

## 🧹 8. Maintenance, Database Creation & Rollback

### 8.1 Creating a New Empty Database
If you are starting fresh or setting up a secondary PC to pull an existing cloud database into a new local file:
* **From the GUI:** Click **➕ New DB...** (or `Edit -> Create New MMEX Database...`), choose a filename ending in `.mmb` or `.emb`, and click **Save**.
* **From the CLI:**
  ```bash
  mmex-sync --cli --db=~/Finances/fresh.mmb --create --sync=init,pull
  ```

### 8.2 Cleaning Local Technical Schema (`--clearDb`)
Restores your local `.mmb` or `.emb` file to a 100% standard Money Manager Ex database by dropping all `TRG_*` triggers, removing the `pb_id`, `pb_is_dirty`, and `pb_updated_at` columns from all 22 tables, and dropping `pb_DELETED_RECORDS_LOG` and `pb_sync_info`:

```bash
mmex-sync --cli --clearDb
```

### 8.3 Wiping Remote Server Data (`--clearServer`)
Deletes all synchronized records across all 22 collections on the remote PocketBase server (iterating in reverse topological order to respect foreign key constraints), while keeping your user account intact:

```bash
mmex-sync --cli --clearServer
```

---

## 🛠️ 9. Synchronization Architecture & Troubleshooting

### The 3-State Loop Protection Protocol (`pb_is_dirty`)
Every synchronized table in the local SQLite database is augmented with `pb_id` (`TEXT`), `pb_is_dirty` (`INTEGER DEFAULT 0`), and `pb_updated_at` (`TEXT`):
* **`0` (Synced):** Record is aligned with the remote server.
* **`1` (Local Change):** Set automatically by SQLite `AFTER INSERT` / `AFTER UPDATE` triggers when you create or edit records in Money Manager Ex. Queued for the next `PUSH`.
* **`2` (Cloud Ingress):** Set temporarily by `mmex-sync` when applying incoming `PULL` records from the server. SQLite triggers explicitly ignore updates where `NEW.pb_is_dirty = 2`, preventing infinite synchronization loops, before `mmex-sync` resets the flag back to `0`.

### Topological Sync Order (Foreign Key Integrity)
Tables are always pushed and pulled in a strict 4-level topological order (and cleared in reverse order):
1. **Level 1 (Independent):** `INFOTABLE_V1`, `CURRENCYFORMATS_V1`, `TAG_V1`, `BUDGETYEAR_V1`, `CUSTOMFIELD_V1`
2. **Level 2 (Core Entities):** `CATEGORY_V1`, `PAYEE_V1`, `ACCOUNTLIST_V1`
3. **Level 3 (Transactions & Assets):** `ASSETS_V1`, `STOCK_V1`, `CHECKINGACCOUNT_V1`, `BILLSDEPOSITS_V1`, `BUDGETTABLE_V1`
4. **Level 4 (Details & History):** `SPLITTRANSACTIONS_V1`, `BUDGETSPLITTRANSACTIONS_V1`, `CURRENCYHISTORY_V1`, `STOCKHISTORY_V1`, `ATTACHMENT_V1`, `TAGLINK_V1`, `TRANSLINK_V1`, `SHAREINFO_V1`, `CUSTOMFIELDDATA_V1`

### Conflict & Uniqueness Resolution
* **Version Conflicts (Last-Write-Wins):** If the remote server reports a `409 Conflict` during `PUSH`, `mmex-sync` fetches the latest remote record and applies it locally.
* **Unique Constraint Deduplication:** If a newly created local record collides with an existing remote record on a unique key (such as `ACCOUNTNAME`, `PAYEENAME`, `CURRENCY_SYMBOL`, or `(CATEGNAME, PARENTID)`), `mmex-sync` automatically links the record to the existing remote `pb_id` and remaps any dependent local foreign keys (e.g., `ACCOUNTID`, `CATEGID`, `PAYEEID`).

### Troubleshooting Tips
* **Scheduled Transactions Duplication:** Once synchronization is active, **always launch MMEX via `mmex-sync`** (using GUI Auto-Start, `--cli --run`, or `--cli --watch`). Opening MMEX directly without syncing first can cause MMEX's auto-post feature to post a scheduled transaction locally that was already posted on another device (such as Android).
* **Token Expired / Auth Failed:** Open the GUI (or pass `--user` and `--pass` via CLI) and click **🔌 Test Connection** to re-authenticate and store a fresh encrypted token.
* **Inspecting Detailed Logs:** Enable **📝 Verbose Logging** in the GUI or pass `--verbose` (`MMEX_VERBOSE=true`) on the CLI to inspect every SQL operation and HTTP payload.

