#!/usr/bin/env bash
set -e

APP_NAME="mmex-sync"
DIST_DIR="./dist"

# Colori per l'output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}🚀 Avvio Cross-Compilation per ${APP_NAME}${NC}"
echo -e "${BLUE}=================================================${NC}"

mkdir -p "$DIST_DIR"

# 1. LINUX (x86_64)
echo -e "\n${YELLOW}🐧 [1/4] Compilazione per Linux (x86_64)...${NC}"
cargo build --release --target x86_64-unknown-linux-gnu
cp "target/x86_64-unknown-linux-gnu/release/${APP_NAME}" "${DIST_DIR}/${APP_NAME}-linux-x86_64"
echo -e "${GREEN}✔ Linux completato!${NC}"

# 2. WINDOWS (x86_64 .exe)
echo -e "\n${YELLOW}🪟 [2/4] Compilazione per Windows (x86_64 .exe)...${NC}"
cargo build --release --target x86_64-pc-windows-gnu
cp "target/x86_64-pc-windows-gnu/release/${APP_NAME}.exe" "${DIST_DIR}/${APP_NAME}-windows-x86_64.exe"
echo -e "${GREEN}✔ Windows (.exe) completato!${NC}"

# 3. MACOS (Apple Silicon M1/M2/M3/M4 - aarch64)
# Nota: usa --no-default-features se la GUI (egui/rfd) è sotto feature "gui", 
# poiché i framework grafici Cocoa non esistono su Linux senza SDK Xcode.
echo -e "\n${YELLOW}🍎 [3/4] Compilazione per macOS (Apple Silicon ARM64)...${NC}"
if command -v cargo-zigbuild &> /dev/null && command -v zig &> /dev/null; then
    cargo zigbuild --release --target aarch64-apple-darwin --no-default-features
    cp "target/aarch64-apple-darwin/release/${APP_NAME}" "${DIST_DIR}/${APP_NAME}-macos-arm64"
    echo -e "${GREEN}✔ macOS ARM64 completato!${NC}"
else
    echo -e "⚠️ cargo-zigbuild o zig non trovati nel PATH, salto build macOS ARM64 locale."
fi

# 4. MACOS (Intel - x86_64)
echo -e "\n${YELLOW}🍎 [4/4] Compilazione per macOS (Intel x86_64)...${NC}"
if command -v cargo-zigbuild &> /dev/null && command -v zig &> /dev/null; then
    cargo zigbuild --release --target x86_64-apple-darwin --no-default-features
    cp "target/x86_64-apple-darwin/release/${APP_NAME}" "${DIST_DIR}/${APP_NAME}-macos-x86_64"
    echo -e "${GREEN}✔ macOS Intel completato!${NC}"
else
    echo -e "⚠️ cargo-zigbuild o zig non trovati nel PATH, salto build macOS Intel locale."
fi

echo -e "\n${BLUE}=================================================${NC}"
echo -e "${GREEN}🎉 Build terminata! Ecco i binari pronti in ${DIST_DIR}/:${NC}"
ls -lh "$DIST_DIR"