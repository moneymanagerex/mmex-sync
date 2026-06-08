# Contribution and Local Development Guide (`CONTRIBUTING.md`)

Welcome! Thank you for your interest in contributing to **mmex-sync**. This guide will help you set up your local development environment, run the test suite, and build the application using our unified, cross-platform workflow.

---

## 🛠️ Prerequisites

Before you begin, ensure you have the following installed on your system:
- **Node.js** (Version 24 LTS recommended, minimum Version 22)
- **npm** (Bundled with Node.js)
- **Git**

No platform-specific tools or compiled binaries are required anymore, as the entire automation suite runs natively on Node.js using standard JavaScript.

---

## 🚀 Local Environment Setup

Follow these steps to clone the repository, install all required dependencies, and initialize the environment:

### 1. Clone the Repository
Open your terminal and clone the project using Git:

```bash
git clone [https://github.com/moneymanagerex/mmex-sync.git](https://github.com/moneymanagerex/mmex-sync.git)
cd mmex-sync

```

### 2. Install Dependencies

Install the required production packages and development frameworks (like `esbuild` and `jest`):

```bash
npm install

```

---

## 🧪 Running the Tests

This project uses **Jest** for automated testing. The test suite integrates Node's experimental ESM modules configuration (`--experimental-vm-modules`).

All tests **must pass** before compiling the package locally or opening a Pull Request.

### Run All Tests (Single Run)

```bash
npm test

```

---

## 📦 Compilation & Packaging (Universal Build)

The build process bundles the JavaScript source files into a single CommonJS file (`dist/app/bundle.cjs`) using `esbuild`, copies the required SQL assets, and generates a unified, hybrid launcher (`dist/mmex-sync.cmd`) that works out-of-the-box on Windows, Linux, and macOS.

⚠️ **Note:** The build commands **automatically** run the test suite beforehand via a `prebuild` hook. If any test fails, the process will abort immediately.

### 1. Build Local Assets (Development/Testing)

Generates the complete and runnable application structure inside the `dist/` folder:

```bash
npm run build

```

Once built, you can immediately test the application locally by running `.\mmex-sync.cmd` (Windows) or `./mmex-sync.cmd` (Linux/macOS) directly inside the `dist/` directory.

### 2. Generate Release Package (Distribution)

Bundles the `dist/` directory assets into a single, universal, cross-platform `.zip` file inside `dist/release/`:

```bash
npm run release

```

---

## 📐 Recommended Contribution Workflow

1. **Fork the Repository** to your own GitHub account.
2. **Create a Feature Branch** for your changes or bug fixes:

```bash
git checkout -b feature/your-feature-name

```

3. **Write Your Code** and remember to add corresponding **test cases** inside the `tests/` directory.
4. **Verify Environment and Tests** locally by running `npm test`.
5. **Verify the Build** locally by running `npm run build` to ensure the bundle compiles without errors.
6. **Push Your Changes** to your fork:

```bash
git push origin feature/your-feature-name

```

7. **Open a Pull Request** against the main development branch with a clear description of the changes. The continuous integration (CI) pipeline on GitHub Actions will automatically validate your code and compile the universal release artifact upon target branch merges.

