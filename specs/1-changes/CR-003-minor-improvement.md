# Change Request (CR) Specification Template

> **CR ID:** `CR-003`  
> **Title:** `Minor fix to UI`  
> **Status:** `Draft`  
> **Created Date:** `2026-10-28`  
> **Affected Baseline Specs:** `[00-architecture-and-ui.md]`

---

## 1. Context & Motivation (Why)
Auth Collection need to be manually handled by program and not visibile to user. 
ih this way auth is transpaent to user (connect to pubblic service use users collection, connect to private server use superusers)

---

## 2. Proposed Functional Changes (What)
Basically first test need to be done using "users" collection, if failed test using "superusers", if ok save superusers collection info, if failed give error and keep users collection interllay.

- **GUI / i18n Changes:** remove field auth collection field fro UI and manage automatically in profile.

---


## 4. Impact on System Invariants (`Invarianti di Sistema`)

Verify compliance with the baseline `## Invarianti di Sistema` documented in `specs/0-as-is/`:
- [ ] **Backward Compatibility with Existing User Profiles (`~/.mmex-sync` / `%APPDATA%\mmex-sync`)** preserved?

*(If any existing invariant is intentionally modified or superseded by this CR, explicitly document the old invariant, the new invariant, and the migration path here.)*

---

## 5. Verification & Test Plan

List the automated unit/integration tests (`cargo test`) and manual verification scenarios required to accept this CR:



