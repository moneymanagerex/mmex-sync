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

The project includes unit and integration tests covering database schema initialization, trigger management, 3-state synchronization logic, `.emb` encryption/decryption, configuration profiles, and localization (`i18n`) key parity.

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

## 🌍 Internationalization (i18n)

Translation catalogs are stored in `locales/en.json` (source language) and `locales/it.json`, and are embedded directly into the binary at compile time.
- If you add or modify any UI or CLI translation key, update both `locales/en.json` and `locales/it.json`.
- Run `cargo test test_json_key_parity` to verify that all keys match across languages.

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
