## Context

Nothing exists yet — this is the first capability built in this repo. This
design starts from a blank plugin project at the repo root.

## Goals / Non-Goals

**Goals:**
- A plugin that loads in Obsidian without error and registers exactly one
  sidebar view type.
- Two independent ways to open that view — a ribbon icon and a command
  palette entry — that both resolve to the same "activate" logic, so
  there's one code path to reason about, not two.
- Opening the view twice (ribbon then command, or either one twice)
  reveals the same panel rather than creating duplicates.

**Non-Goals:**
- No settings tab, no credential storage, no GitLab connection
  (`platform-config` / `git-publishing`).
- No note creation, front matter, or vault file access
  (`doc-authoring`).
- No persisted plugin data — this milestone reads and writes nothing via
  `loadData`/`saveData`. That starts when there's actual state to persist.
- No content beyond a placeholder heading in the view. The view existing
  and opening is the entire deliverable.

## Decisions

**View base class: `ItemView`, not `Modal`.**
The proposal calls for a sidebar view — something that docks and persists
alongside the note pane — not a transient dialog. `ItemView` is the
Obsidian API's building block for exactly that; `Modal` would fit a
one-off prompt, which this isn't and none of the later milestones need
either (submit/connect flows are all sidebar-driven per the UI placement
decision in `openspec/config.yaml`).

**Placement: right sidebar, singleton.**
Matches the standing decision (`openspec/config.yaml`, UI placement) that
contextual tools live in the right sidebar, not the left (vault
navigation). "Activate" is one function used by both entry points:
- Look for an existing leaf of this view type
  (`workspace.getLeavesOfType(VIEW_TYPE)`).
- If one exists, reveal it (`workspace.revealLeaf`) instead of creating a
  second panel.
- Otherwise, get or create a right-sidebar leaf, set its view state to
  this view type, then reveal it.
This is the "both entry points call the same activation path" requirement
from the proposal, made concrete: there is exactly one function that
opens the view, and both the ribbon icon's click handler and the
command's callback call it.

**Manifest: `isDesktopOnly: false`.**
Nothing in this milestone — or in the architecture decided so far, which
is REST-API-only with no local git, no SSH keys, no shell commands — needs
a desktop-only API. Deciding this now, while the manifest is first
written, avoids a silent default that would later have to be revisited
under the excuse of "it was already like that." If a future capability
turns out to need something desktop-only, that should be a deliberate,
named decision then, not an inherited default from this one.

**Leaves are deliberately NOT detached on unload.**
`onunload` does not call `detachLeavesOfType`. This matches current
Obsidian guidance — detaching destroys the user's layout every time the
plugin updates — but it contradicts older sample-plugin code that many
tutorials still show. Recorded as a deliberate non-action so it is not
"fixed" later by someone matching an outdated example.

**`.gitignore` includes `data.json` from the first commit.**
Per the standing decision in `openspec/config.yaml`. This milestone
persists nothing, so `data.json` never appears — which is exactly why the
entry is easy to omit and `.gitignore` is rarely revisited afterwards.
Obsidian plugins are normally developed inside a vault's
`.obsidian/plugins/<id>/` folder, making the repository root and the
plugin's runtime folder the same directory, so from `platform-config`
onward a live `api`-scoped personal access token would otherwise sit in
the working tree. The entry carries a comment saying why.

**Build tooling: esbuild + TypeScript, single bundle, no framework.**
Matches the `Tech` line already decided in `openspec/config.yaml` and the
"prefer the boring option" design rule — this is a four-person internal
tool, not a product that needs a component framework. `main.ts` at the
repo root bundles to `main.js` at the repo root, because Obsidian loads
`main.js` from the plugin's own folder root regardless of where the
source lives, and there's no reason yet to add a `src/` layer for a
single entry-point file.

**Plugin identity.**
`manifest.json` needs an `id`, `name`, `version` (start at `0.1.0`),
`minAppVersion`, `description`, and `author`. Per the identity decision in
`openspec/config.yaml`, the id is `obsidian-docs-publisher` and the display
name is "Git Publisher" — platform-agnostic on purpose, since GitHub and
Gitea are plausible later and the SOP framing is this team's use case
rather than the plugin's scope.

The id is fixed from this commit onward and is not a label that can be
revised later for convenience. Obsidian keys plugin enablement off the id
and loads plugin data from the plugin's own folder, conventionally named
for it, so changing the id after distribution makes Obsidian treat it as a
different plugin: it needs re-enabling, and data saved under the old
identity is not picked up. From `platform-config` onward that data holds
each author's access token and their submission state, so a later rename
would silently disconnect every author and drop their document status.
This milestone stores nothing, which is exactly why the cost is invisible
here and expensive later.

## Risks / Trade-offs

- [Ribbon icon and command both firing "activate" independently could
  race and create two leaves if triggered in quick succession] → the risk
  is real, not illusory: `setViewState` returns a promise and
  `activateView` is therefore async, so two triggers can both pass the
  `getLeavesOfType` check before either awaits, and both create a leaf.
  It requires a double-trigger within milliseconds and nothing breaks
  badly if it happens, but the honest mitigation is a one-line
  non-reentrancy guard (an in-flight flag checked at the top of
  `activateView`) rather than an argument that the interleaving cannot
  occur. Recorded this way deliberately: a wrong reason written down as
  settled is worse than an open risk, because the next reader trusts it.
- [`minAppVersion` set too low blocks using a newer Obsidian API in a
  later milestone; set too high excludes users on older Obsidian] →
  picked conservatively for now; revisit only when a specific later
  milestone actually needs a newer API, not preemptively.
- [Empty view with no content risks looking like a broken build rather
  than an intentional placeholder during manual testing] → the view
  renders a heading naming the plugin and a one-line "coming soon"-style
  note, so opening it is visibly a working shell, not a blank rectangle
  someone has to guess about.

## Migration Plan

Not applicable — nothing exists yet to migrate; this is the first
install.

## Open Questions

None blocking. Note that the plugin id is explicitly NOT among them — it
is settled at `obsidian-docs-publisher` and treated as fixed from this
commit, for the reasons in the Plugin identity decision above.
