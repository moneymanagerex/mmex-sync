# Change Request (CR) Specification Template

> **CR ID:** `CR-XXXX`  
> **Title:** `<Short Descriptive Title>`  
> **Status:** `Draft | Proposed | Approved | Implemented | Rejected`  
> **Created Date:** `YYYY-MM-DD`  
> **Target Version:** `vX.Y.Z`  
> **Affected Baseline Specs:** `[00-architecture-and-ui.md | 01-db-and-crypto.md | 02-remote-providers.md | 03-sync-engine.md]`

---

## 1. Context & Motivation (Why)

Describe the problem, limitation, or new requirement driving this change. Reference the exact behavior in `specs/0-as-is/` that is being modified or extended.

---

## 2. Proposed Functional Changes (What)

Detail the functional behavior expected after implementing this CR:
- **CLI / Configuration Changes:** (New flags, `.env` variables, or JSON profile fields, if any)
- **GUI / i18n Changes:** (New views, controls, dialogs, and required translation keys in `locales/en.json` and `locales/it.json`)
- **Database / Crypto / Remote / Sync Logic Changes:** (Exact behavioral changes)

---

## 3. Technical Design & Affected Modules (How)

List the Rust modules and files in `src/` that will be modified or created:

| File / Module | Planned Modification |
| :--- | :--- |
| `src/...` | ... |

### Data Model / Trait / Schema Diff
Provide any struct, trait, SQL trigger, or JSON payload changes:

```rust
// Example signature or struct diff
```

---

## 4. Impact on System Invariants (`Invarianti di Sistema`)

Verify compliance with the baseline `## Invarianti di Sistema` documented in `specs/0-as-is/`:
- [ ] **3-State Loop-Prevention Protocol (`pb_is_dirty` `0`/`1`/`2`)** preserved?
- [ ] **Topological `SYNC_ORDER` & Foreign Key Cascade (`FK_MAP`)** preserved?
- [ ] **`.emb` Atomic Flush & WAL Checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`)** preserved?
- [ ] **Compile-Time Embedded Assets & `en.json` / `it.json` Key Parity** preserved?
- [ ] **Backward Compatibility with Existing User Profiles (`~/.mmex-sync` / `%APPDATA%\mmex-sync`)** preserved?

*(If any existing invariant is intentionally modified or superseded by this CR, explicitly document the old invariant, the new invariant, and the migration path here.)*

---

## 5. Verification & Test Plan

List the automated unit/integration tests (`cargo test`) and manual verification scenarios required to accept this CR:

1. **Unit / Integration Tests:**
   - `test_...`: ...
2. **Edge Cases & Regression Checks:**
   - ...

