# MMEX-Sync Backlog & Wishlist

This document collects ideas, future improvements, and embryonic Change Requests (CR). It serves to provide long-term vision and architectural context to the AI. The items listed here are NOT active tasks. When a CR is ready for development, its specifications will be formalized and moved to a dedicated file under `specs/changes/`.

**[Nome Idea / Futura CR]**
- **Descrizione:** [...]
- **Impatto:** [...]

**GitHub Releases Auto-Update Mechanism**
- **Description:** Implement an auto-update feature that fetches new versions from GitHub Releases. The mechanism must support extracting both `.zip` archives (for future multi-file distributions) and replacing standalone executables. Consider also to add this under "tools" menu with item "check and update" that check (--checkforupdate) and if there is any update proposte the update (--downloadUpdate), remove old "--autoDownloadUpdate" from command line.
- **Impact:** Network layer (`reqwest`), file system operations (`std::fs`), potential new `src/update/` module, and GUI/CLI triggers.

**Post-Sync Auto-Close Timer**
- **Description:** Introduce an auto-close countdown (e.g., 3 seconds) that automatically terminates the application upon successful sync completion, mirroring the `autorun` startup behavior.
- **Impact:** GUI state management (`src/gui/`), sync orchestrator (`src/sync/`), and configuration profile/CLI flags.

**Add Application Help**
- **Description:** Use `docs/HELP.md` as Help in gui under HELP menu in gui. 
- **Impact:** GUI  management (`src/gui/`).

**improve linux lanucher**
- **Description:** Now app check for existence of mmex bin. But under linux mmex is launched via flatpack. So we need to allow insert of "flatpak run org.moneymanagerex.MMEX" followed by mmb file
- **impact:** Gui and command line
