# Contribution and Local Development Guide (`CONTRIBUTING.md`)

Welcome! Thank you for your interest in contributing to **mmex-sync**. This guide will help you set up your local development environment, run the test suite, and build the application on both Windows and Linux.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed on your system:
- **Node.js** (Version 20 or higher recommended)
- **npm** (Bundled with Node.js)
- **Git**

### OS-Specific Dependencies (Required for compiling the executable):
- **Windows:** PowerShell (to run `build.ps1`)
- **Linux:** Bash (to run `build_linux.sh`)

---

## 🚀 Local Environment Setup

Follow these steps to clone the repository and install all required dependencies:

### 1. Clone the Repository
Open your terminal and clone the project using Git:

```bash
git clone https://github.com/wolfsolver/mmex-sync.git
cd mmex-sync

```

### 2. Install Dependencies

Install all required packages, including native modules like `better-sqlite3` and development tools such as `jest` and `esbuild`:

```bash
npm install

```

> ⚠️ **Note for Windows Users:** While installing `better-sqlite3`, Node.js might need to compile native C++ components. If you encounter compilation errors, ensure you have the Windows Build Tools installed (`npm install --global windows-build-tools` from an administrative terminal, or via Visual Studio Build Tools).

---

## 🧪 Running the Tests

This project uses **Jest** for automated testing. The test suite integrates Node's experimental ESM modules configuration (`--experimental-vm-modules`).

All tests **must pass** before compiling the executable or opening a Pull Request.

### Run All Tests (Single Run)

```bash
npm test

```

### Run Tests in Watch Mode (Recommended during development)

Listens for file changes and re-runs the related tests automatically:

```bash
npm run test:watch

```

### Check Test Coverage

Generates a detailed report regarding your code coverage:

```bash
npm run test:coverage

```

---

## 📦 Compilation (Building the Executable)

The build process bundles the JavaScript files (using `esbuild`), generates the native Node.js SEA (Single Executable Application) blob, injects the custom icon, and exports the necessary SQL files.

The build commands **automatically** run the test suite beforehand. If any test fails, the build process will abort immediately to prevent generating a broken executable.

### Build on Windows

Generates the final executable file at `dist\\mmex-sync.exe`:

```bash
npm run build:windows

```

### Build on Linux

Generates the native executable for Linux environments:

```bash
npm run build:linux

```

Once completed, you will find the compiled application along with all asset requirements ready to use inside the `dist/` directory.

---

## 📐 Recommended Contribution Workflow

1. **Fork the Repository** to your own GitHub account.
2. **Create a Feature Branch** for your changes or bug fixes:
```bash
git checkout -b feature/your-feature-name

```


3. **Write Your Code** and remember to add corresponding **test cases** inside the appropriate directory.
4. **Verify the Tests** locally by running `npm test`.
5. **Verify the Build** locally to ensure the executable compiles properly without errors.
6. **Push Your Changes** to your fork:
```bash
git push origin feature/your-feature-name

```

7. **Open a Pull Request** with a clear description of the implemented changes.
