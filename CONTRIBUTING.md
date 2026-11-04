# Contribution and Local Development Guide (`CONTRIBUTING.md`)

Welcome! Thank you for your interest in contributing to **mmex-sync**. This guide will help you set up your local Rust development environment, run the automated test suite, and compile native standalone binaries across Linux, Windows, and macOS.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Rust Toolchain** (`rustup`, `cargo`, `rustc` — latest `stable`, Edition 2021):
  Install via [rustup.rs](https://rustup.rs/):
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **Git**

### Linux System Dependencies (for Native GUI)
On Ubuntu/Debian, install the development headers required by `eframe`/`egui` (X11/Wayland) and `rfd`:
```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libssl-dev \
  libxcb-render0-dev libxcb-shape0-dev libxcb-xfixes0-dev \
  libxkbcommon-dev libgtk-3-dev
```

*(Note: SQLite and TLS do **not** require external system libraries, as `mmex-sync` uses `rusqlite` with `bundled` SQLite and `reqwest` with pure-Rust `rustls-tls`.)*

---

## 🚀 Local Environment Setup

### 1. Clone the Repository
Open your terminal and clone the project using Git:

```bash
git clone https://github.com/moneymanagerex/mmex-sync.git
cd mmex-sync
```

### 2. Verify Compilation
Cargo automatically downloads and compiles all Rust crates defined in `Cargo.toml`:

```bash
cargo check
```

---

## 🧪 Running the Tests

The project includes unit and integration tests covering database schema initialization, trigger management, 3-state synchronization logic, `.emb` encryption/decryption, configuration profiles, and localization (`i18n`) fallback and formatting.

All tests **must pass** before opening a Pull Request:

```bash
cargo test --all-targets
```

---

## 📦 Compilation & Packaging

### 1. Run Locally in Development Mode
- **Launch Native Desktop GUI:**
  ```bash
  cargo run
  ```
- **Run CLI Commands:**
  ```bash
  cargo run -- --help
  cargo run -- --listProfile
  cargo run -- --sync
  ```

### 2. Build Native Release Binary
To build an optimized standalone executable for your current operating system:

```bash
cargo build --release
```
The resulting binary will be located at `target/release/mmex-sync` (or `target\release\mmex-sync.exe` on Windows).

To build a **CLI-only (headless)** binary without the `gui` feature (`eframe`/`rfd`):
```bash
cargo build --release --no-default-features
```

### 3. Local Multi-Platform Cross-Compilation (`build-all.sh`)
If you are on Linux and want to cross-compile standalone binaries for Linux (`x86_64`), Windows (`x86_64 .exe`), and macOS (`arm64` & `x86_64` headless CLI) into `./dist/`:

1. Add the Rust targets:
   ```bash
   rustup target add x86_64-unknown-linux-gnu x86_64-pc-windows-gnu aarch64-apple-darwin x86_64-apple-darwin
   ```
2. Install `mingw-w64` (for Windows), `zig`, and `cargo-zigbuild` (for macOS).
3. Run the build script:
   ```bash
   ./build-all.sh
   ```

---

## 🌍 Internationalization (i18n) & Crowdin Localization

Translation catalogs are stored in `locales/` as JSON files (`en.json`, `it.json`, `fr.json`, `de.json`, `es.json`) and are embedded directly into the standalone binary at compile time via `include_str!`.

### Rules for Developers:
- **`locales/en.json` is the Single Source of Truth:** If you add, modify, or delete any UI or CLI strings in code, **only edit `locales/en.json`**.
- **Do NOT manually edit other translation files:** Translations for all other languages (`it`, `fr`, `de`, `es`, etc.) are managed collaboratively and generated automatically via **Crowdin**.
- **Automatic Fallback:** The runtime localization engine automatically falls back to the English string from `en.json` whenever a key is missing in another language catalog, ensuring no crashes or blank labels occur if a translation is pending.

### Community Translations via Crowdin:
- Community translations are coordinated at **[crowdin.com/project/mmex-sync](https://crowdin.com/project/mmex-sync)**.
- **Automated CI/CD Workflow:** When updates to `locales/en.json` are merged into `main`, GitHub Actions (`.github/workflows/crowdin.yml`) automatically uploads the new source strings to Crowdin. Completed translations are periodically pulled from Crowdin and submitted back as automated pull requests.
- **Non-developer Contributors:** Anyone wishing to help translate or improve language catalogs can contribute directly on Crowdin without needing to write Rust code, install developer tools, or open manual pull requests.

---

## 📐 Recommended Contribution Workflow

1. **Fork the Repository** to your own GitHub account.
2. **Create a Feature Branch** for your changes or bug fixes:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Write Your Code** following standard Rust conventions (`cargo fmt`, `cargo clippy`) and add corresponding **test cases**.
4. **Verify the Test Suite** locally:
   ```bash
   cargo test --all-targets
   ```
5. **Verify the Release Build** locally:
   ```bash
   cargo build --release
   ```
6. **Push Your Changes** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Open a Pull Request** against the main development branch with a clear description of the changes. GitHub Actions CI will automatically run the Rust test suite and verify the build.
