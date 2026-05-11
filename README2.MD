# MMEX Sync Engine POC (Sidecar Architecture)

> [!WARNING]
> This is a **Proof of Concept (POC)**, not production-ready software. It is still under active development and may not work perfectly in all edge cases.

## 🎯 Overview

This project demonstrates a non-intrusive, **"Offline-First"** synchronization system for Money Manager Ex (MMEX). It enables seamless multi-device sync (Windows ↔ Cloud ↔ Android) without requiring any modifications to the core MMEX desktop source code.

### The "Sidecar" Philosophy

The Sync Engine operates as an external "Sidecar" process. It watches your SQLite database and communicates with a **PocketBase** backend. If the engine is off, MMEX remains a standard local app; if it's on, your data goes global.

---

## ⚠️ Safety First: Disclaimer

**Do NOT use this with your primary financial database.** * **Educational Use Only:** This software is for testing purposes.

* **No Warranty:** Provided "as is". The authors are not responsible for data loss or corrupted databases.
* **Testing Tip:** Always use a copy of your database (e.g., `sample_db.mmb`).

> **Funny Warning:** > Using this on your main database is a great way to discover your inner "minimalist" by accidentally deleting your net worth. If your bank account ends up as empty as a fridge on a Monday morning, don't say we didn't warn you! 💸🔥

---

## 🕹️ How to Use

The engine can be launched in different modes depending on your workflow.

### 1. Daily Workflow Modes

These modes manage the lifecycle of the MMEX application for you:

#### **`--run` (The "Sandwich" Sync):**
1. Performs an initial Sync (Pull/Push).
2. Launches MMEX and waits for you to finish.
3. Performs a final Sync after you close MMEX to save changes to the cloud.


```bash
mmex-sync --run

```


#### **`--watch` (Real-Time Sync):**
1. Performs an initial Sync.
2. Launches MMEX in the background.
3. Continuously monitors for local or remote changes and syncs them instantly.


```bash
mmex-sync --watch

```



### 2. Manual Synchronization

Use these if you want to sync data without opening the MMEX interface:

* **Full Cycle:** `node index.js --sync` (Init + Push + Pull).
* **Pull Only:** `node index.js --sync=pull` (Download remote data).
* **Push Only:** `node index.js --sync=push` (Upload local changes).
* **Force Sync:** `node index.js --sync --force` (Processes all records regardless of timestamps).

### 3. Profile Management

You can manage different databases (e.g., "Home" vs "Work") using profiles:

* **Select Profile:** `node index.js --profile=work`.
* **List Profiles:** `node index.js --listProfile`.

---

## ⚙️ Configuration & Setup

### First Run

Simply run `mmex-sync`. On the first start, the program will interactively ask for your PocketBase URL, credentials, and database path, then store them in the `default` profile.

### Command Line Arguments

| Parameter | Description |
| --- | --- |
| `--db=path` | Path to your `.mmb` file. |
| `--url=addr` | URL of your PocketBase instance. |
| `--user=email` | PocketBase login email. |
| `--pass=pwd` | Password (used once to generate a secure token). |
| `--exe=path` | Path to `mmex.exe` (Default: `C:\Program Files\MoneyManagerEx\bin\mmex.exe`). |

---

## 🛠️ Technical Concepts

* **Zero-Impact Integration:** Uses **SQLite Triggers** to track changes (`pb_is_dirty` flags) without touching the C++ code.
* **Loop Protection:** Implements a **3-State Protocol** (Synced, Local Change, Cloud Ingress) to prevent infinite sync loops.
* **Maintenance:**
* `--clearDb`: Removes all technical columns and triggers from your local DB.
* `--clearServer`: Wipes all data from the PocketBase collections.



---

## 📂 Additional Resources

* [PocketBase Setup Guide](https://www.google.com/search?q=README_POCKETBASE.md)
* [Demo Video: Windows & Android](https://drive.google.com/file/d/1pKFcdcNuf47BQDFQAtPBOCC_B_BfgwxF/view)