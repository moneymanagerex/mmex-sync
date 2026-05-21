---
layout: default
title: MMEX Sync Engine
description: Sidecar modernization for Money Manager Ex. Multi-device cloud synchronization without modifying the original desktop source code.
---

# MMEX Sync Engine (Sidecar Architecture)

<div style="display: flex; gap: 10px; margin-bottom: 20px;">
  <img src="https://img.shields.io/badge/Stage-POC-yellow?style=for-the-badge" alt="POC Stage">
  <img src="https://img.shields.io/badge/PocketBase-Active-brightgreen?style=for-the-badge" alt="PocketBase Status">
</div>

Welcome to the non-intrusive, **"Offline-First"** synchronization system for Money Manager Ex (MMEX). It enables seamless multi-device sync (Windows ↔ Cloud ↔ Android) without requiring any modifications to the core MMEX desktop C++ source code.

![banner](images/mmex-sync-banner.png) {.center}

---

## 📺 Demo Video (Windows & Android)

See the synchronization engine in action below:

<div style="display: flex; justify-content: center; align-items: center; margin: 20px 0;">
    <iframe 
        src="https://drive.google.com/file/d/1pKFcdcNuf47BQDFQAtPBOCC_B_BfgwxF/preview" 
        width="640" 
        height="480" 
        allow="autoplay">
    </iframe>
</div>

---

## ⚠️ IMPORTANT: Disclaimer & Warnings

> [!WARNING]
> **This is a Proof of Concept (POC).** This software is provided for **testing and educational purposes only**. It is **NOT** intended for use with real or production financial databases.

* **No Warranty:** This code is provided "as is" without any warranty of any kind.
* **Liability:** The authors decline any responsibility for data loss, database corruption, or financial discrepancies resulting from the use of this software.
* **Safety First:** Always use a **copy** of your database (e.g., `sample_db.mmb`) for testing purposes.

---

## 💡 Project Pillars

| Concept | Description |
| :--- | :--- |
| **Sidecar Approach** | The engine operates as an external process. It monitors your local SQLite database and syncs data with the PocketBase backend transparently. |
| **Zero Impact** | Utilizes **SQLite Triggers** (via `pb_is_dirty` flags) without needing to recompile or alter the MMEX desktop application. |
| **3-State Protocol** | Protection against infinite synchronization loops through a three-state logic: *Synced*, *Local Change*, or *Cloud Ingress*. |

---

## 🌐 Server Hosting Options

The Sync Engine requires a PocketBase backend to coordinate data across devices. You have two options:

1. **Community Shared Server (Easiest):** Request access to the unofficial test shared instance hosted at [mmex-sync.prudenzano.org](https://mmex-sync.prudenzano.org).
2. **Self-Hosted Server (Privacy & Control):** Deploy your own PocketBase instance on a VPS, Docker, or Raspberry Pi using the schemas available in the `schema/` folder of this repository.

---

## 🕹️ Quick Start Guide

### First Setup
On the first launch, the program will interactively guide you to configure your credentials and database path:

```bash
mmex-sync

```

### Daily Workflow Modes

The following commands automatically manage the lifecycle of the Money Manager Ex application for you:

* **`mmex-sync --run` (The "Sandwich" Sync):** Performs an initial Sync (Pull/Push) ➡️ Launches MMEX and waits for closure ➡️ Performs a final Sync after you close it.
* **`mmex-sync --watch` (Real-Time Sync):** Performs an initial Sync ➡️ Launches MMEX in the background ➡️ Continuously monitors and instantly syncs any local or remote changes.

To set a default mode so you can run the tool by simply typing `mmex-sync`:

```bash
mmex-sync --setDefaultMode=run  # Or watch

```

### Manual Synchronization (Without interface)

* **Full Cycle:** `mmex-sync --sync`
* **Download Only (Pull):** `mmex-sync --sync=pull`
* **Upload Only (Push):** `mmex-sync --sync=push`
* **Force Sync:** `mmex-sync --sync --force` (Processes all records regardless of timestamps).

---

## 🧹 Maintenance Commands

* `mmex-sync --clearDb`: Removes all technical columns and triggers from the local DB, restoring it to a standard MMEX database.
* `mmex-sync --clearServer`: Wipes all data from the PocketBase collections (while keeping your admin user accounts intact).

---

## 📋 POC Access Request & Feedback

* **Want to test the synchronization?** Fill out the [Access Request Form](https://docs.google.com/forms/d/e/1FAIpQLSfGGjVGEvB14j_h_dSCHGTs3W5N9RqmwBNYAgLtr6382zrtqQ/viewform) to obtain a dedicated test account on the shared server.
* **Help us improve:** Take 2 minutes to complete our survey and help us refine the sync protocol.

Before requesting access, please make sure you have read and agreed to our [Privacy Agreement](privacy_agreement.md).
