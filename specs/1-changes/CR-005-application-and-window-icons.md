# Change Request (CR) Specification: Custom Executable & Window Icon Integration

> **CR ID:** `CR-005`  
> **Title:** `Build-Time Windows Executable Icon (.ico) and Runtime Desktop GUI Window Icon (.png) Integration`  
> **Status:** `Proposed`  
> **Created Date:** `2026-10-29`  
> **Target Version:** `v0.3.1`  
> **Affected Baseline Specs:** `[00-architecture-and-ui.md]`

---

## 1. Context & Motivation (Why)

### Current Behavior (AS-IS)
In the current baseline implementation (`specs/0-as-is/00-architecture-and-ui.md`, Section 1 & Section 5):
1. **No Build-Time Windows Resource Compilation (`build.rs` absent):** When compiling `mmex-sync.exe` for Windows (`x86_64-pc-windows-msvc` or cross-compiling via `x86_64-pc-windows-gnu` in `build-all.sh`), no `.rc` / `.ico` resource is embedded into the PE header. As a result, Windows Explorer, desktop shortcuts, and the taskbar display the generic default executable icon.
2. **No Runtime Window Icon in Desktop GUI (`src/gui/mod.rs`):** `run_gui()` initializes `eframe::egui::ViewportBuilder::default()` with only `.with_title(...)`, `.with_inner_size(...)`, and `.with_min_inner_size(...)`. No application icon is attached to the native window viewport, causing the window title bar, Alt+Tab switcher, and OS dock/taskbar to show a generic fallback icon at runtime.

### Motivation (TO-BE)
To provide a cohesive, recognizable brand identity across all supported platforms while preserving the **Zero External Runtime Asset Dependencies** system invariant, `mmex-sync` must:
- Embed the custom `.ico` asset into the Windows PE executable at compile time (`build.rs` + `winres`).
- Embed the custom `.png` asset directly into the binary at compile time (`include_bytes!`), decode it into raw RGBA8 pixels at runtime using `image`, and attach it to the `eframe`/`egui` (winit-backed) main window viewport builder.

> [!NOTE]
> **Asset Naming Verification on Disk:** The CR requirements reference `assets/icons/icons.ico` and `assets/icons/icons.png`. In the repository tree (`assets/icons/`), the existing files are currently named `assets/icons/icon.ico` and `assets/icons/icon.png`. Before or during implementation, either rename/copy the files to `assets/icons/icons.ico` and `assets/icons/icons.png` or align the path constant in `build.rs` and `src/gui/mod.rs`.

---

## 2. Proposed Functional Changes (What)

- **CLI / Configuration Changes:** None. Headless CLI execution (`--cli`) and profile JSON schemas remain untouched.
- **Build-Time Changes (Windows PE Icon):**
  - Introduce a root `build.rs` build script using `winres::WindowsResource`.
  - When targeting Windows (`CARGO_CFG_TARGET_OS == "windows"`), compile and link `assets/icons/icons.ico` into the output binary `mmex-sync.exe`.
- **GUI / Runtime Window Changes (`src/gui/mod.rs`):**
  - Embed `assets/icons/icons.png` into the binary at compile time via `include_bytes!`.
  - Decode the embedded PNG bytes into an 8-bit RGBA buffer (`width`, `height`, `Vec<u8>`) via the `image` crate.
  - Construct the window icon structure (`eframe::egui::IconData` / `winit::window::Icon`) and inject it into `ViewportBuilder` via `.with_icon(...)`.
  - Gracefully fallback to the default viewport without panicking if icon decoding ever fails.
- **Database / Crypto / Remote / Sync Logic Changes:** None.

---

## 3. Technical Design & Affected Modules (How)

| File / Module | Type of Change | Planned Modification |
| :--- | :--- | :--- |
| `Cargo.toml` | `MODIFY` | Add `image` (with `png` feature, optional under `gui` feature) in `[dependencies]` and `winres` in `[build-dependencies]`. |
| `build.rs` | `CREATE` | Compile-time resource script that embeds `assets/icons/icons.ico` when the target OS is Windows. |
| `src/gui/mod.rs` | `MODIFY` | Add `load_window_icon()` using `include_bytes!` + `image` RGBA decoding, and attach the icon to `ViewportBuilder` in `run_gui()`. |
| `specs/0-as-is/00-architecture-and-ui.md` | `MODIFY` | Document `build.rs`, new dependencies, and viewport icon initialization in Section 1 and Section 5. |

---

### 3.1 Dependency Management (`Cargo.toml`)

Update `Cargo.toml` to include:
1. **`image`** under `[dependencies]` (with `default-features = false` and `features = ["png"]` to minimize compile time and binary size, gated under the `gui` feature so headless `--no-default-features` builds remain minimal).
2. **`winres`** under `[build-dependencies]` to compile Windows `.rc` resources into the executable.

```toml
[dependencies]
# ... existing dependencies ...

# Native GUI (Milestone 5)
eframe = { version = "0.30", default-features = false, features = ["default_fonts", "glow", "x11", "wayland"], optional = true }
rfd = { version = "0.15", default-features = false, features = ["gtk3"], optional = true }
image = { version = "0.25", default-features = false, features = ["png"], optional = true }

[build-dependencies]
winres = "0.1"

[features]
default = ["gui"]
gui = ["dep:eframe", "dep:rfd", "dep:image"]
```

---

### 3.2 Build-Time Injection (`build.rs`)

Create `build.rs` in the project root (`/home/wolf/projects/mmex-sync/build.rs`).  
Note: Using `std::env::var("CARGO_CFG_TARGET_OS")` instead of `#[cfg(target_os = "windows")]` ensures the build script also executes properly when cross-compiling from Linux to Windows (`--target x86_64-pc-windows-gnu` via `mingw-w64` `windres`).

```rust
use std::env;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=assets/icons/icons.ico");

    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        let icon_path = "assets/icons/icons.ico";
        if Path::new(icon_path).exists() {
            let mut res = winres::WindowsResource::new();
            res.set_icon(icon_path);

            // Support cross-compilation from Linux to Windows (x86_64-pc-windows-gnu)
            if env::var("HOST").unwrap_or_default().contains("linux")
                && env::var("TARGET").unwrap_or_default().contains("windows-gnu")
            {
                res.set_windres_path("x86_64-w64-mingw32-windres");
                res.set_ar_path("x86_64-w64-mingw32-ar");
            }

            if let Err(err) = res.compile() {
                println!(
                    "cargo:warning=Failed to compile Windows icon resource '{}': {}",
                    icon_path, err
                );
            }
        } else {
            println!(
                "cargo:warning=Windows icon file '{}' not found; skipping PE icon embedding.",
                icon_path
            );
        }
    }
}
```

---

### 3.3 Runtime Loading & RGBA Decoding (`src/gui/mod.rs`)

Embed `assets/icons/icons.png` at compile time via `include_bytes!` (using `concat!(env!("CARGO_MANIFEST_DIR"), "/assets/icons/icons.png")` or relative path `"../../assets/icons/icons.png"`), decode it into raw RGBA8 bytes via `image::load_from_memory`, and construct the window icon structure.

> **Framework Compatibility Note (`eframe` / `winit`):**  
> `mmex-sync` uses `eframe` `0.30` (which wraps `winit` internally and exposes `eframe::egui::ViewportBuilder`). `ViewportBuilder::with_icon` accepts `Arc<eframe::egui::IconData>`, which `eframe` converts internally into `winit::window::Icon::from_rgba(rgba, width, height)`. Both the `eframe::egui::IconData` builder function and the direct `winit::window::Icon` construction are shown below.

```rust
use std::sync::Arc;
use eframe::egui;

/// Raw PNG bytes embedded at compile time from the repository assets
const WINDOW_ICON_PNG: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/icons/icons.png"));

/// Decodes the embedded PNG into an `egui::IconData` (RGBA8) structure for `ViewportBuilder`.
pub fn load_window_icon() -> Option<Arc<egui::IconData>> {
    let image = image::load_from_memory(WINDOW_ICON_PNG).ok()?.into_rgba8();
    let (width, height) = image.dimensions();
    let rgba = image.into_raw();

    Some(Arc::new(egui::IconData {
        rgba,
        width,
        height,
    }))
}
```

*(Reference equivalent if using `winit::window::Icon` directly)*:
```rust
pub fn load_winit_window_icon() -> Option<winit::window::Icon> {
    let image = image::load_from_memory(WINDOW_ICON_PNG).ok()?.into_rgba8();
    let (width, height) = image.dimensions();
    let rgba = image.into_raw();

    winit::window::Icon::from_rgba(rgba, width, height).ok()
}
```

---

### 3.4 UI Integration in Main Window Builder (`src/gui/mod.rs`)

Inject the decoded icon into `eframe::egui::ViewportBuilder` inside `run_gui()`:

```rust
/// Avvia l'interfaccia grafica desktop nativa di MMEX-Sync
pub fn run_gui(args: CliArgs, allow_auto_start: bool) -> Result<(), SyncError> {
    let mut viewport = eframe::egui::ViewportBuilder::default()
        .with_title("MMEX-Sync - Configuration & Synchronization Gateway")
        .with_inner_size([800.0, 640.0])
        .with_min_inner_size([640.0, 480.0]);

    if let Some(icon) = load_window_icon() {
        viewport = viewport.with_icon(icon);
    }

    let native_options = eframe::NativeOptions {
        viewport,
        ..Default::default()
    };

    eframe::run_native(
        "MMEX-Sync",
        native_options,
        Box::new(move |cc| Ok(Box::new(MmexSyncGuiApp::new(cc, args, allow_auto_start)))),
    )
    .map_err(|e| {
        SyncError::Config(crate::i18n::t_fmt(
            "errors.gui_init_failed",
            &[("error", &e.to_string())],
        ))
    })
}
```

---

## 4. Impact on System Invariants (`Invarianti di Sistema`)

Verify compliance with the baseline `## Invarianti di Sistema` documented in `specs/0-as-is/`:
- [x] **3-State Loop-Prevention Protocol (`pb_is_dirty` `0`/`1`/`2`)** preserved? (Unchanged)
- [x] **Topological `SYNC_ORDER` & Foreign Key Cascade (`FK_MAP`)** preserved? (Unchanged)
- [x] **`.emb` Atomic Flush & WAL Checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`)** preserved? (Unchanged)
- [x] **Compile-Time Embedded Assets & `en.json` / `it.json` Key Parity** preserved? (Yes — `icons.png` is embedded via `include_bytes!` and `icons.ico` is compiled into the Windows PE resource section, keeping the binary 100% standalone with zero external runtime file dependencies.)
- [x] **Backward Compatibility with Existing User Profiles (`~/.mmex-sync` / `%APPDATA%\mmex-sync`)** preserved? (Unchanged)

---

## 5. Verification & Test Plan

1. **Unit / Integration Tests (`cargo test`):**
   - `test_load_window_icon_valid_rgba`: Verify that `load_window_icon()` returns `Some(icon_data)`, that `icon_data.width > 0` and `icon_data.height > 0`, and that `icon_data.rgba.len() == (icon_data.width * icon_data.height * 4) as usize`.
   - `cargo test --all-targets`: Ensure all existing unit and integration tests pass without regression.
2. **Build & Cross-Compilation Checks:**
   - `cargo clippy --all-targets -- -D warnings`: Zero warnings on standard GUI build.
   - `cargo build --release --no-default-features`: Verify that headless CLI builds (without the `gui` feature) compile cleanly without requiring `eframe`, `rfd`, or `image`.
   - `cargo build --release --target x86_64-pc-windows-gnu`: Verify that `build.rs` embeds `assets/icons/icons.ico` into the Windows `.exe` binary without errors.
3. **Manual UI Verification:**
   - Launch `mmex-sync --gui` on Linux and Windows and verify that the custom MMEX-Sync icon appears in the window title bar, taskbar/dock, and Alt+Tab switcher, and that `mmex-sync.exe` displays the custom icon in Windows Explorer.

