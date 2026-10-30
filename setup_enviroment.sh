#!/usr/bin/env bash

# Automatic setup script for the mmex-sync development environment
# Supports: Debian/Ubuntu also via WSL

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}🚀 Development Environment Setup: mmex-sync${NC}"
echo -e "${BLUE}=================================================${NC}"

# 1. Install system dependencies (Debian/Ubuntu)
if command -v apt-get &> /dev/null; then
    echo -e "\n${YELLOW}[1/3] Installing system dependencies (sudo required)...${NC}"
    sudo apt-get update
    
    # Core dependencies for C/C++ compilation, networking, and UI/GTK/Wayland/X11
    sudo apt-get install -y \
        build-essential \
        pkg-config \
        libssl-dev \
        libxcb-render0-dev \
        libxcb-shape0-dev \
        libxcb-xfixes0-dev \
        libxkbcommon-dev \
        libglib2.0-dev \
        libgtk-3-dev \
        libappindicator3-dev

    echo -e "${GREEN}✔ System dependencies installed.${NC}"
else
    echo -e "\n${RED}⚠️ apt package manager not found. If you are not on Debian/Ubuntu, please install GTK/X11/Wayland dependencies manually.${NC}"
fi

# 2. Check and install Rust
echo -e "\n${YELLOW}[2/3] Checking Rust installation...${NC}"
if ! command -v cargo &> /dev/null; then
    echo -e "Cargo not found. Installing Rust via rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    
    # Load the Rust environment in the current shell process
    source "$HOME/.cargo/env"
    echo -e "${GREEN}✔ Rust successfully installed.${NC}"
else
    echo -e "${GREEN}✔ Rust is already installed ($(cargo --version)).${NC}"
fi

# 3. Environment Validation (Build & Test)
echo -e "\n${YELLOW}[3/3] Environment Validation: Building and Running Tests...${NC}"
echo "Running cargo build..."
cargo build

echo "Running cargo test..."
cargo test

echo -e "\n${BLUE}=================================================${NC}"
echo -e "${GREEN}🎉 Setup complete! The environment for mmex-sync is ready.${NC}"
echo -e "You can start the app locally with: ${YELLOW}cargo run${NC}"