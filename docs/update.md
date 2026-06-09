---
layout: default
title: Auto-Update Guide
nav_order: 3
---

# Auto-Update Guide for MMEX Sync

This guide details how to keep your `mmex-sync` installation up-to-date using the built-in update mechanism.

---

## 🔍 Checking for Updates

You can check if a newer version of the synchronization tool is available on GitHub without modifying any database or server state. To do so, run:

```bash
mmex-sync --checkForUpdate
```

### Output Example (Up to date):
```text
Checking for updates... (Current version: v0.1.8)
✅ You are running the latest version (v0.1.8).
```

### Output Example (New update available):
```text
Checking for updates... (Current version: v0.1.7)

🎉 A new version is available: v0.1.8
Release Notes & Details: https://github.com/moneymanagerex/mmex-sync/releases/tag/v0.1.8
Run with --autoDownloadUpdate to automatically download and install it.
```

---

## 🆙 Automatic Download & Installation

To automatically download the latest version compatible with your operating system, extract it, and install it, run:

```bash
mmex-sync --autoDownloadUpdate
```

### What this command does:
1. **Version Verification:** It checks if a newer version exists. If your version is already the latest, it does nothing and exits.
2. **Platform Selection:** It automatically determines your operating system (`win32`, `linux`, or `darwin`) and locates the corresponding ZIP archive asset in the latest GitHub release.
3. **Download Progress:** It downloads the update ZIP archive package, showing a progress bar inside the CLI.
4. **Extraction:** It extracts the binary archive into a temporary folder using your system's native command-line tool (Powershell `Expand-Archive`, `unzip`, or `tar`).
5. **Safe Replacement:** It replaces your active executable.

---

## 🛠️ Windows Executable Lock Handling

On Windows, the operating system locks any running `.exe` file, preventing it from being directly overwritten or deleted. 

To solve this, `mmex-sync` uses a safe renaming strategy:
1. It renames the active executable to `mmex-sync.exe.old`.
2. It writes the new executable to `mmex-sync.exe`.
3. When you run `mmex-sync` again, you will be using the updated version.
4. **Cleanup:** You can manually delete the `mmex-sync.exe.old` file from your directory after restarting the program.

On Linux and macOS, the running file handle is unlinked immediately, and the new executable is put in place with execution permissions (`chmod +x`) restored automatically.
