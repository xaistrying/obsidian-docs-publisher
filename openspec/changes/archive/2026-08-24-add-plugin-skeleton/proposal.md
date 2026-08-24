## Why

Every future capability of this plugin — connecting to GitLab, authoring a
new SOP, submitting for review — needs a place to live inside Obsidian and
a way for an author to open it. None of that exists yet. Before building
anything that talks to GitLab or touches vault files, the plugin needs a
working shell: it loads, it registers a visible entry point, and an author
can open and close it. This is the foundation every later milestone is
built on top of, so it goes first and on its own.

## What Changes

- Add a new Obsidian plugin (TypeScript, esbuild, no UI framework) with a
  `manifest.json` and the standard plugin lifecycle (`onload`/`onunload`).
- Register a custom sidebar view that opens in the RIGHT sidebar (the
  Obsidian convention for contextual tools, as opposed to the left
  sidebar's vault navigation).
- Add a ribbon icon that reveals/opens the view.
- Add a command palette entry that does the same, through the same
  activation path as the ribbon icon.
- The view itself renders an empty container with a placeholder heading —
  no GitLab connection, no note authoring, no persisted state. Those are
  separate, later proposals.

## Capabilities

### New Capabilities
- `plugin-shell`: plugin lifecycle (load/unload), sidebar view
  registration, the ribbon icon, and the command palette entry that both
  open the same view.

### Modified Capabilities
(none — this is the first capability of the project; nothing existing to
change)

## Impact

- New plugin project at the repo root (this repository is dedicated to the
  plugin): `manifest.json`, `package.json`, an esbuild build config, a
  TypeScript entry point, and a `.gitignore`. Repository, package, and
  manifest `id` are all `obsidian-docs-publisher`; display name is
  "Git Publisher". The `.gitignore` covers `data.json` from this first
  commit even though nothing writes it yet — see `design.md`.
- Depends only on the Obsidian Plugin API and the build tooling
  (`esbuild`, `typescript`, `@types/node`, `obsidian` type defs) — no
  network calls, no GitLab client, no vault file reads/writes beyond what
  Obsidian's plugin lifecycle itself requires.
- Nothing here is wired to any other capability yet; `platform-config`,
  `doc-authoring`, `submission-tracking`, and `git-publishing` all remain
  unbuilt and are explicitly out of scope for this change.
