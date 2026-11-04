# FIX-0002: Support clickable links, anchor navigation, and adaptive Light/Dark colors in Application Help (`docs/HELP.md`)

**Status:** `DONE`  
**Date:** 2026-11-04  
**Impacted Modules:** `src/gui/help.rs`, `src/gui/app.rs`

## 1. Reference Specification
- **Target Spec:** `specs/as-is/00-architecture-and-ui.md` (Section 5: *Native Desktop GUI (`src/gui/`) -> GUI Sections & Menus -> Help*)
- **Spec Update Required?:** Yes — document interactive Markdown links (internal `#anchor` scrolling and external URLs) and theme-adaptive (`dark_mode` / light mode) rendering in the Help viewer.

## 2. Observed Behavior (The Bug)
1. **Missing Interactive Links:** When opening **Help -> User Guide** (`F1`), all Markdown links `[label](url_or_anchor)` in `docs/HELP.md`—most notably the **Table of Contents** (`#-1-overview--key-features`, `#21-desktop-gui-mode-default`, etc.)—are stripped into plain non-clickable text by `strip_markdown_links()` in `src/gui/help.rs`.
2. **Unreadable Colors on Windows Light Theme:** On Windows (where `eframe`/`winit` applies the OS Light Theme `Visuals::light()` with a white background), hardcoded light colors in `src/gui/help.rs` make text unreadable:
   - Bold text (`**...**`) is hardcoded to `Color32::from_rgb(245, 248, 255)` (nearly white), becoming completely invisible against the white window background.
   - Level-3 headings (`###`) use `Color32::from_rgb(220, 235, 250)` (very pale blue-white), also nearly invisible on a light background.
   - Code blocks and blockquotes use hardcoded dark backgrounds without adapting to `ui.visuals().dark_mode`.

## 3. Expected Behavior
1. **Interactive Links & Anchor Navigation (Option A):**
   - Compute normalized GitHub-compatible anchor slugs (`normalize_anchor_slug`) for all headings (`#` .. `####`).
   - Render Markdown links `[label](#anchor)` and `[label](https://...)` as clickable `egui::Link` widgets.
   - Clicking an internal `#anchor` link scrolls the Help `egui::ScrollArea` directly to the matching section heading via `Response::scroll_to_me(Some(egui::Align::TOP))`.
   - Clicking an external `http(s)://` link opens it in the system browser via `ui.ctx().open_url(...)`.
2. **Theme-Adaptive Color Palette (`HelpThemePalette`):**
   - Inspect `ui.visuals().dark_mode` and select a dedicated high-contrast color palette for both **Light Mode** and **Dark Mode** covering headings (`H1`–`H4`), regular text, bold text (`**...**`), inline code (`` `...` ``), fenced code blocks (` ``` `), blockquotes/alerts (`>`), list bullets, and hyperlinks.

## 4. Acceptance Criteria
- [x] All Table of Contents links (`[...](#...)`) and inline links in `docs/HELP.md` are rendered as clickable links.
- [x] Clicking an internal `#anchor` link scrolls directly to the corresponding section heading in `docs/HELP.md`.
- [x] Clicking an external `http://` or `https://` link opens the URL in the system default web browser.
- [x] Bold text, headings (`H1`–`H4`), inline code, code blocks, and blockquotes are clearly readable with high contrast in both Light Mode (Windows default) and Dark Mode.
- [x] Unit tests verify heading slug normalization (`test_anchor_slug_matching_all_toc_links`), inline link parsing (`test_parse_inline_spans_with_links`), and Light/Dark palette contrast (`test_theme_palette_light_and_dark_contrast`).
- [x] `cargo check`, `cargo clippy`, `cargo fmt --all -- --check`, and `cargo test` pass with no warnings.
- [x] `specs/as-is/00-architecture-and-ui.md` is updated to reflect the fix.
