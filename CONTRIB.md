# Contribution and Local Development Guide (`CONTRIBUTING.md`)

Welcome! Thank you for your interest in contributing to **mmex-sync**. This guide will help you set up your local development environment, initialize the application test environment, run the test suite, and build the application.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed on your system:
- **Node.js** (Version 20 or higher recommended)
- **npm** (Bundled with Node.js)
- **Git**

No platform-specific shell scripts (like PowerShell or Bash) are required anymore, as the entire automation suite runs natively on Node.js.

---

## 🚀 Local Environment Setup

Follow these steps to clone the repository, install all required dependencies, and initialize the application test database:

### 1. Clone the Repository
Open your terminal and clone the project using Git:

```bash
git clone [https://github.com/moneymanagerex/mmex-sync.git](https://github.com/moneymanagerex/mmex-sync.git)
cd mmex-sync

```

### 2. Install Dependencies

Install all required packages, including native modules like `better-sqlite3`, compression tools, and development frameworks:

```bash
npm install

```

## 🧪 Running the Tests

This project uses **Jest** for automated testing. The test suite integrates Node's experimental ESM modules configuration (`--experimental-vm-modules`).

All tests **must pass** before compiling the executable locally or opening a Pull Request.

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

The build process bundles the JavaScript files (using `esbuild`), generates the native Node.js SEA (Single Executable Application) blob, injects the custom asset metadata, and exports the necessary runtime native modules.

⚠️ **Note:** The build commands **automatically** run the test suite beforehand via a `prebuild` hook. If any test fails, the process will abort immediately.

### Build and Package for Windows

Generates the compilation assets in `dist/win/` and outputs the final distribution package `mmex-sync.<version>.win.zip` inside `dist/output/`:

```bash
npm run release:win

```

### Build and Package for Linux

Generates the compilation assets in `dist/linux/` and outputs the final distribution package `mmex-sync.<version>.linux.zip` inside `dist/output/`:

```bash
npm run release:linux

```

---

## 📐 Recommended Contribution Workflow

1. **Fork the Repository** to your own GitHub account.
2. **Create a Feature Branch** for your changes or bug fixes:
```bash
git checkout -b feature/your-feature-name

```


3. **Write Your Code** and remember to add corresponding **test cases** inside the `tests/` directory.
4. **Verify Environment and Tests** locally by running `npm run cleanEnv` and `npm test`.
5. **Verify the Build** locally for your current operating system to ensure the executable compiles without errors.
6. **Push Your Changes** to your fork:
```bash
git push origin feature/your-feature-name

```


7. **Open a Pull Request** against the main development branch with a clear description of the changes. The continuous integration (CI) pipeline on GitHub Actions will automatically compile both Windows and Linux artifacts on target branch merges.

