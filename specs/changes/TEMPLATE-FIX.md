# FIX-XXX: [Short, descriptive title of the bug]

**Status:** `Draft | Proposed | Approved | Implemented | Rejected`  
**Date:** YYYY-MM-DD
**Impacted Modules:** [e.g., `src/crypto/`, `src/db/`]

## 1. Reference Specification
- **Target Spec:** [Name of the file in `specs/as-is/` that defines how this should work]
- **Spec Update Required?:** [Yes / No - Indicate if the bug occurred because the original spec was unclear or incomplete and needs an update]

## 2. Observed Behavior (The Bug)
- [Describe what is actually happening right now. E.g., "The AES decryption fails with a padding error when reading legacy .emb files."]
- **Steps to reproduce (if applicable):**
  1. ...
  2. ...

## 3. Expected Behavior
- [Describe what the system *should* do to align with the `as-is` invariants. E.g., "The crypto module should fallback to the older key derivation method if the standard one fails."]

## 4. Acceptance Criteria
- [ ] The issue is fixed in the codebase without breaking existing tests.
- [ ] A new unit test (or integration test) has been added to prevent regressions.
- [ ] `cargo check`, `cargo clippy`, and `cargo test` pass with no warnings.
- [ ] The `specs/as-is/` documentation has been updated (if the fix required a design clarification).