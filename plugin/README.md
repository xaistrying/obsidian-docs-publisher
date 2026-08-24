# Docs Publisher - Obsidian Plugin

This directory contains the complete plugin ready to be installed in Obsidian.

## Quick Install

### Option 1: Manual Installation (Development)

1. Copy this entire `plugin` folder to your Obsidian vault:
   ```bash
   cp -r plugin ~/.obsidian/plugins/obsidian-docs-publisher
   ```

2. In Obsidian:
   - Go to **Settings → Community Plugins**
   - Look for "Docs Publisher" (or enable it if it's already listed)
   - Enable the plugin

### Option 2: For Development

1. Develop files in this directory
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. The `main.js` file will be updated
5. Reload the plugin in Obsidian

## Directory Structure

```
obsidian-docs-publisher/
├── manifest.json           # Plugin metadata (id, name, version, etc.)
├── main.js                 # Built plugin bundle (ready to use)
├── package.json            # Dependencies and build scripts
├── package-lock.json       # Dependency lock file
├── tsconfig.json           # TypeScript configuration
├── esbuild.config.mjs      # Build configuration
├── .gitignore              # Files to ignore
└── src/
    └── main.ts             # Plugin source code
```

## Build Commands

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Watch and rebuild on changes (development)
npm run dev
```

## Plugin Features

- **Sidebar View** - Opens in the right sidebar
- **Ribbon Icon** - Quick access button with git-branch icon
- **Command Palette** - Accessible via "Open Docs Publisher" command
- **No Duplicates** - Prevents multiple panels of the same view
- **Placeholder UI** - Shows "Docs Publisher" heading with description

## What to Copy

When distributing this plugin, copy the entire `plugin` directory (or just the essential files):

**Minimum required for Obsidian to load:**
- `manifest.json`
- `main.js`

**Recommended to include (for development):**
- All files in this directory
- Allows developers to modify and rebuild

## Notes

- `data.json` is in `.gitignore` - it will store the GitLab API token in future milestones
- The plugin currently shows placeholder content; functionality is coming in future milestones
