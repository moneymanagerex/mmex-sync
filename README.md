# MMEX Sync Engine POC (Sidecar Architecture)

> [!WARNING]
> This is a **Proof of Concept (POC)**, not production-ready software. It is still under active development and may not work perfectly in all edge cases.

![Money Manager Ex Sync - Record-Level Safe Sync Banner](assets/images/mmex-sync-banner.png)


## 🎯 Overview

This project demonstrates a non-intrusive, **"Offline-First"** synchronization system for Money Manager Ex (MMEX). It enables seamless multi-device sync (Windows ↔ Cloud ↔ Android) without requiring any modifications to the core MMEX desktop source code.

### The "Sidecar" Philosophy

The Sync Engine operates as an external "Sidecar" process. It watches your SQLite database and communicates with a **PocketBase** backend. If the engine is off, MMEX remains a standard local app; if it's on, your data goes global.

### Video
**Demo Video between Windows & Android**
[Demo Video between Windows & Android🤩](https://drive.google.com/file/d/1pKFcdcNuf47BQDFQAtPBOCC_B_BfgwxF/view)


**Demo Video between two Windows**
[Demo Video between two Windows🤩](https://1drv.ms/v/c/6958bccc4c47c1d3/IQAfDCUauF7dQo2GL1r47SziAfLlgfXdpo8-8-ustZM9CMA?e=5mPJBo)

---

## ⚠️ IMPORTANT: DISCLAIMER & WARNING
**This is a Proof of Concept (POC).** This software is provided for **testing purposes only**. It is **NOT** intended for use with real, production, or important financial databases.

* **No Warranty:** This code is provided "as is" without any warranty of any kind. 
* **Liability:** The author(s) decline any responsibility for data loss, database corruption, or financial discrepancies resulting from the use of this software.
* **Safety First:** Always use a **copy** of your database (e.g., `sample_db.mmb`) for testing.

> [!WARNING]
> Using this script on your primary financial database is a great way to discover your inner "minimalist" by accidentally deleting your entire net worth. If your bank account suddenly looks as empty as a fridge on a Monday morning, don't say we didn't warn you! 💸🔥

---
## 🌐 Server Hosting Options

The Sync Engine requires a PocketBase backend to coordinate data across devices. You have two main options for setting up the server:

### 1. Community Shared Server (Easiest)
If you don't want to manage your own infrastructure, you can request access to the unofficial test shared instance hosted at:
👉 **[mmex-sync.prudenzano.org](https://mmex-sync.prudenzano.org)**

> [!NOTE]
> Access to the shared server may require registration or approval. Please check the website for instructions on how to request your credentials.

### 2. Self-Hosted Server (Private & Control)
For maximum privacy and control over your financial data, you can easily deploy your own PocketBase instance on any cloud provider, VPS, or home server (e.g., Raspberry Pi, Docker, etc.).
* Download PocketBase from the official website.
* Deploy the required collections schema (see the `schema/` folder in this repository).
* Use your custom URL during the first setup (e.g., `http://your-vps-ip:8090`).


--- 

## 🕹️ How to Use

The engine can be launched in different modes depending on your workflow.

### 0. First setup
On first launch, the program will interactively ask for your PocketBase URL, credentials, and database path, then store them in the `default` profile.

```bash
C:\> mmex-sync
√ Percorso database .mmb: · test.mmb
√ URL PocketBase: · http://127.0.0.1:8090
√ Email PocketBase: · test@yourdomain.com
√ Password PocketBase: · ************
✅ Configurazione salvata nel profilo: default
Path DB: test.mmb
URL: http://127.0.0.1:8090
User: test@yourdomain.com
MMEX Path: C:\Program Files\MoneyManagerEx\bin\mmex.exe
🏗️  [Create] Creazione nuovo database in corso: test.mmb
✅ Database creato e pronto per la sincronizzazione.
```
### 1. Normal run
After first launch, you can run the program with:
```bash
C:\> mmex-sync 
```
to perform a simple pull and push cycle.

### 2. Daily Workflow Modes

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

#### Set your default mode
You can set the default mode by running:

```bash
mmex-sync --setDefaultMode=run
```
or
```bash
mmex-sync --setDefaultMode=watch
```
after this you can run without arguments
```bash
mmex-sync
```

### 3. Manual Synchronization

Use these if you want to sync data without opening the MMEX interface:

* **Full Cycle:** `mmex-sync --sync` (Init + Push + Pull).
* **Pull Only:** `mmex-sync --sync=pull` (Download remote data).
* **Push Only:** `mmex-sync --sync=push` (Upload local changes).
* **Force Sync:** `mmex-sync --sync --force` (Processes all records regardless of timestamps).

### 4. Profile Management

You can manage different databases (e.g., "Home" vs "Work") using profiles:

* **Select Profile:** `mmex-sync --profile=work`.
* **List Profiles:** `mmex-sync --listProfile`.

---

## ⚙️ Configuration & Setup

### First Run

Simply run `mmex-sync`. On the first start, the program will interactively ask for your PocketBase URL, credentials, and database path, then store them in the `default` profile.

### Command Line Arguments
```bash
===========================================================
🚀 MMEX-PocketBase Sync Tool | User Manual
===========================================================

Usage: mmex-sync [PARAMETERS] [MODE]

-----------------------------------------------------------
📂 PROFILE AND CONFIGURATION MANAGEMENT
-----------------------------------------------------------
  --profile=name      Selects the profile (e.g., 'home', 'work'). 
                      Default: 'default'
  --ignoreProfile     Ignore profile configuration and use default values
  --listProfile       Shows the list of available profiles
  --db=path           Path to the MoneyManagerEx .mmb file
  --url=address       URL of the PocketBase instance
  --user=email        PocketBase login email
  --pass=password     Password (not saved, generates a token)
  --setDefaultMode=X  Sets the default mode for the profile
                      Values: sync (default), run, watch
  --exe=path          Path to the MMEX.exe executable
                      Default: C:\\Program Files\\MoneyManagerEx\\bin\\mmex.exe					  
  --create            Delete and Recreates a new empty database
  --verbose           Shows detailed logs of each operation.

-----------------------------------------------------------
🕹️ SYNCHRONIZATION MODES
-----------------------------------------------------------
  --sync              Executes the complete cycle (Init + Push + Pull).
  --sync=op1,op2      Executes only specified operations.
                      Available operations: init, push, pull
  --force             Ignore flag and timestamp and process all records

  Examples:
    node index.js --sync=pull           (Download remote data only)
    node index.js --sync=init           (Initialize without transmitting anything)
    node index.js --sync --force        (Full cycle with total send and receive)

-----------------------------------------------------------
🕹️ OPERATING MODES
-----------------------------------------------------------
  --run               1. Initial Sync 
                      2. Opens MMEX and waits for closure
                      3. Final Sync
  --watch             1. Initial Sync
                      2. Opens MMEX (detached)
                      3. Monitors local/remote changes in real-time

-----------------------------------------------------------
⚡ FORCING AND MAINTENANCE COMMANDS
-----------------------------------------------------------

-----------------------------------------------------------
🧹 CLEANUP (Warning!)
   These commands are executed alone. 
   Other parameters are ignored.
-----------------------------------------------------------
  --clearDb           Removes technical columns and triggers from the local DB.
  --clearServer       Removes all data from the collections on the server.

Example:
  node index.js --profile=casa --watch --verbose
===========================================================
```

---

## 🛠️ Technical Concepts

* **Zero-Impact Integration:** Uses **SQLite Triggers** to track changes (`pb_is_dirty` flags) without touching the C++ code.
* **Loop Protection:** Implements a **3-State Protocol** (Synced, Local Change, Cloud Ingress) to prevent infinite sync loops.
* **Maintenance:**
* `--clearDb`: Removes all technical columns and triggers from your local DB and restore it to a normal Money Manager Ex DB
* `--clearServer`: Wipes all data from the PocketBase collections (without removing your user & password)

## Conclusion
This architecture proves that MMEX can be modernized with cloud capabilities while remaining a stable, offline-first desktop software. It respects the existing codebase and provides a modular path forward for the community.

