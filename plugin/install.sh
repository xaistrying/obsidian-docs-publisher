#!/bin/bash

# Docs Publisher Plugin - Install Script
# This script copies the plugin to an Obsidian vault

set -e

# Logging functions
log_info() {
    echo "[INFO] $1"
}

log_error() {
    echo "[ERROR] $1" >&2
}

log_warn() {
    echo "[WARN] $1"
}

log_success() {
    echo "[SUCCESS] $1"
}

# Check if vault path is provided
if [ -z "$1" ]; then
    log_info "Usage: ./install.sh <path-to-obsidian-vault>"
    log_info ""
    log_info "Example:"
    log_info "  ./install.sh ~/Documents/MyVault"
    log_info ""
    log_info "This will copy the plugin to:"
    log_info "  <vault>/.obsidian/plugins/obsidian-docs-publisher/"
    exit 1
fi

VAULT_PATH="$1"
PLUGIN_PATH="$VAULT_PATH/.obsidian/plugins/obsidian-docs-publisher"

# Verify vault exists
if [ ! -d "$VAULT_PATH" ]; then
    log_error "Vault path does not exist: $VAULT_PATH"
    exit 1
fi

# Verify .obsidian directory exists
if [ ! -d "$VAULT_PATH/.obsidian" ]; then
    log_error "Not an Obsidian vault (missing .obsidian directory): $VAULT_PATH"
    exit 1
fi

# Create plugins directory if it doesn't exist
mkdir -p "$VAULT_PATH/.obsidian/plugins"

# Remove old installation if it exists
if [ -d "$PLUGIN_PATH" ]; then
    log_info "Removing old plugin installation..."
    rm -rf "$PLUGIN_PATH"
fi

# Copy plugin to vault
log_info "Installing Docs Publisher plugin..."
mkdir -p "$PLUGIN_PATH"

# Copy essential files
cp manifest.json "$PLUGIN_PATH/"
cp main.js "$PLUGIN_PATH/"
cp package.json "$PLUGIN_PATH/" 2>/dev/null || true
cp package-lock.json "$PLUGIN_PATH/" 2>/dev/null || true
cp tsconfig.json "$PLUGIN_PATH/" 2>/dev/null || true
cp esbuild.config.mjs "$PLUGIN_PATH/" 2>/dev/null || true
cp .gitignore "$PLUGIN_PATH/" 2>/dev/null || true

# Copy src directory
if [ -d "src" ]; then
    cp -r src "$PLUGIN_PATH/"
fi

log_success "Plugin installed successfully"
log_info ""
log_info "Plugin location: $PLUGIN_PATH"
log_info ""
log_info "Next steps:"
log_info "  1. Open Obsidian vault: $VAULT_PATH"
log_info "  2. Go to Settings → Community Plugins"
log_info "  3. Enable 'Docs Publisher' (if not already enabled)"
log_info "  4. Click the git-branch icon in the left ribbon to open the plugin"
