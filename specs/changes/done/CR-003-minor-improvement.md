# Change Request (CR) Specification: Automatic Auth Collection Management & UI Cleanup

> **CR ID:** `CR-003`  
> **Title:** `Transparent Auth Collection Handling and Removal from GUI`  
> **Status:** `DONE`  
> **Created Date:** `2026-10-28`  
> **Affected Baseline Specs:** `[00-architecture-and-ui.md, 02-remote-providers.md]`

---

## 1. Context & Motivation (Why)

The PocketBase authentication collection (`users` vs. `_superusers`) is an internal protocol detail that should be handled transparently by `mmex-sync` rather than exposed to the user in the desktop GUI:
- When connecting to a multi-user / public PocketBase service, authentication occurs against the `"users"` collection.
- When connecting to a private / self-hosted PocketBase instance using admin credentials, authentication falls back to the `"_superusers"` collection.
- Exposing an editable "Auth Collection" text field in the GUI was error-prone and could overwrite the automatically detected collection (`_superusers`) with `"users"` when saving the profile.

---

## 2. Proposed Functional Changes (What)

1. **Automatic Dual-Collection Resolution & Persistence:**
   - First attempt authentication against the `"users"` collection; if it succeeds, persist `pbAuthCollection = "users"` in `<profile>.mmex-sync.json`.
   - If `"users"` fails, attempt authentication against `"_superusers"`; if it succeeds, persist `pbAuthCollection = "_superusers"` in `<profile>.mmex-sync.json`.
   - If both attempts fail, return the authentication error and keep `"users"` as the internal default collection (`self.auth_collection = Some("users")`, `pb_auth_collection = "users"`).
2. **GUI Cleanup (`src/gui/app.rs`):**
   - Remove the Auth Collection input row from the **Remote Server** section in the GUI.
   - Update `GuiEvent::TokenUpdated` to carry both `encrypted_token` and `auth_collection` so that successful authentication or token refresh in any background worker (`Test Connection`, `Sync`, `Run`, `Watch`, `Clear Server`) automatically updates `self.pb_auth_collection` and saves `pbAuthCollection` in the active profile JSON.

---

## 3. Technical Design & Affected Source Files (How)

| File / Module | Type of Change | Detailed Description |
| :--- | :--- | :--- |
| `src/remoteserver/pocketbase.rs` | `MODIFY` | Initialize `auth_collection` to `Some("users")` in `PocketBaseClient::new`; reset `self.auth_collection = Some("users")` if both `"users"` and `"_superusers"` authentication attempts fail. |
| `src/config.rs` | `MODIFY` | Default `EffectiveConfig.auth_collection` to `Some("users")` when `profile.pb_auth_collection` is `None` or empty. |
| `src/main.rs` | `MODIFY` | Persist `current_profile.pb_auth_collection = Some(auth.collection)` on successful CLI authentication and token refresh. |
| `src/gui/app.rs` | `MODIFY` | Remove the `field_auth_collection` row from `remote_grid`; include `auth_collection` in `GuiEvent::TokenUpdated` and reset to `"users"` on `GuiEvent::AuthCollectionReset`. |
| `tests/remoteserver_test.rs` | `MODIFY` | Add unit test `test_failed_auth_keeps_users_collection_internally` and verify default `get_auth_collection() == Some("users")`. |

---

## 4. Impact on System Invariants (`Invarianti di Sistema`)

Verify compliance with the baseline `## Invarianti di Sistema` documented in `specs/as-is/`:
- [x] **Zero External Runtime Asset Dependencies** preserved?
- [x] **Strict Translation Key Parity (`en.json` / `it.json`)** preserved?
- [x] **Backward Compatibility with Existing User Profiles (`~/.mmex-sync` / `%APPDATA%\mmex-sync`)** preserved?
- [x] **Dual-Collection Authentication Fallback (`users` -> `_superusers`)** preserved?

---

## 5. Verification & Test Plan

- [x] Automated test `test_factory_creation` verifies `client.get_auth_collection() == Some("users")` upon creation.
- [x] Automated test `test_failed_auth_keeps_users_collection_internally` verifies that when authentication fails on both `"users"` and `"_superusers"`, the internal collection is kept/reset to `"users"`.
- [x] `cargo clippy --all-targets` and `cargo test --all-targets` pass with zero warnings and zero errors.
- [x] Baseline specifications `specs/as-is/00-architecture-and-ui.md` and `specs/as-is/02-remote-providers.md` updated in English.
