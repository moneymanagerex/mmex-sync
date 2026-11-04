# FIX-0003: Prefer X11 backend on WSLg / Linux without DRI render nodes so the GUI launches reliably

**Status:** `DONE`  
**Date:** 2026-11-04  
**Impacted Modules:** `src/gui/mod.rs`

## 1. Reference Specification
- **Target Spec:** `specs/as-is/00-architecture-and-ui.md` (Section 5: *Native Desktop GUI (`src/gui/`) -> Viewport, Window Icon & Theme*)
- **Spec Update Required?:** Yes — document automatic X11 backend selection on WSLg / Linux systems lacking `/dev/dri` when `DISPLAY` is available.

## 2. Observed Behavior (The Bug)
- Launching `./mmex-sync-linux-x86_64` on Linux under WSL2 (WSLg) or in Linux environments without `/dev/dri` fails to open the graphical interface and prints:
  ```text
  libEGL warning: failed to get driver name for fd -1
  libEGL warning: MESA-LOADER: failed to retrieve device information
  libEGL warning: failed to get driver name for fd -1
  MESA: error: ZINK: failed to choose pdev
  libEGL warning: egl: failed to create dri2 screen
  ```
- **Root Cause Analysis:**
  1. `eframe 0.30` enables both `wayland` and `x11` features. When `WAYLAND_DISPLAY=wayland-0` is present in WSLg, `winit 0.30` defaults to the Wayland backend.
  2. Under Wayland without a `/dev/dri` device (`renderD128` / `card0`), Mesa's Wayland EGL platform attempts to initialize `dri2` and `ZINK` on `fd -1`, failing with `egl: failed to create dri2 screen`, while `sctk` client-side decoration subsurfaces fail to associate with a top-level RDP RAIL `appId` in `weston-rdprail-shell`.
  3. Conversely, when `winit` connects via X11 (`DISPLAY=:0` on Xwayland), GLX software rendering and `weston-rdprail-shell` top-level window creation succeed immediately without errors.

## 3. Expected Behavior
- Before invoking `eframe::run_native()` on Linux (`#[cfg(target_os = "linux")]`), `mmex-sync` checks `should_prefer_x11_on_linux()`:
  - If `DISPLAY` is set and non-empty, `MMEX_FORCE_WAYLAND` is not set, and either:
    1. The process is running inside WSL (`WSL_DISTRO_NAME`, `WSL_INTEROP`, or `/mnt/wslg` exists), **OR**
    2. No local DRI device (`/dev/dri/renderD128` or `/dev/dri/card0`) exists,
  - Then `run_gui` unsets `WAYLAND_DISPLAY` for the current process so `winit`/`eframe` uses the X11 backend (`DISPLAY`).

## 4. Acceptance Criteria
- [x] The GUI starts cleanly on Linux / WSL2 without `MESA: error: ZINK: failed to choose pdev` or `libEGL warning: egl: failed to create dri2 screen`.
- [x] Unit tests verify `should_prefer_x11_on_linux` decision logic across WSL, missing-DRI, native Wayland+DRI, and `MMEX_FORCE_WAYLAND` scenarios.
- [x] `cargo check`, `cargo clippy`, `cargo fmt --all -- --check`, and `cargo test` pass with no warnings.
- [x] `specs/as-is/00-architecture-and-ui.md` is updated to document the Linux/WSLg X11 backend selection.
