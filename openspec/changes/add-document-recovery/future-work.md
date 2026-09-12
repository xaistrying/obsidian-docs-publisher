# Beyond recovery: discovering content this vault has never had

Not a proposal. This is the parking lot for Option 2 from the exploration
that produced `add-document-recovery`, and the open threads under it —
written down so the thinking survives past this session rather than getting
re-derived or lost. Nothing here is scoped, decided, or committed to.

## The distinction that matters

`add-document-recovery` solves: "the plugin already knows (or can discover
through one open merge request) that this document exists — get its content
back." Every case it handles starts from a `doc_id` the plugin has some
trace of, in `data.json` or in a still-open merge request.

This document is about the case with NO trace at all: a teammate authored a
document from their own vault, it merged months ago, and yours has never
heard of it. No note, no stored record, no `doc_id` to even start from.
That can only be solved by asking the remote "what exists that I don't
have" — browsing, not recovering.

```
RECOVERY (built)                    DISCOVERY (this document)
starts from a doc_id the            starts from nothing — no doc_id,
plugin already has a trace of        no record, no note to key off
        │                                    │
        ▼                                    ▼
  "I know this exists,                "I don't know this exists,
   just need its content"              I don't know its doc_id,
                                        I don't even know to look"
```

## What discovery would actually need

- **A repository browse.** `GET /projects/:id/repository/tree`, recursive,
  probably paginated the same way `listMergeRequests` is (design.md decision
  2 there — bounded, and honest about the bound rather than silently
  truncating).
- **A way to decide what's already local vs. not**, per file in that tree —
  presumably by path, since that's the one thing guaranteed comparable
  between vault and repo (`docs/document-identity.md` §4).
- **A picker UI** — browsing a tree, not a flat list, if the corpus is
  organized in nested folders the way the existing example
  (`Smart Buddy POS/Known-errors/...`) suggests it is.
- **The legacy-content question, unresolved:** does everything in the
  target GitLab project actually carry this plugin's front-matter contract
  (`doc_id`, `title`, `category`, `owner`, `created`, `last_reviewed`,
  `lifecycle`)? If the corpus predates the plugin, or if anyone ever edits
  directly in GitLab's web UI, discovery has to handle a file with none of
  that — no `doc_id` to freeze, no category to assign, maybe not even valid
  YAML front matter. That's a materially different import story: adopting
  foreign content and backfilling required fields, not pulling down
  something this same tool already wrote in its own shape. **Worth
  answering with the actual GitLab project before scoping this further** —
  it changes the size of the feature by a lot depending on the answer.

## The other axis: import vs. sync

Raised during exploration and worth keeping separate, because "many people
contribute to it" points at both and they are not the same feature:

- **Import** (what discovery above would be): an author-triggered,
  one-shot pull of a specific document they picked. Same trust model as
  recovery — nothing happens until asked for.
- **Sync**: the vault stays continuously current with what the team
  publishes, without anyone asking. `openspec/config.yaml`'s no-CI decision
  already reasoned through why an always-on pull is dangerous — a pull that
  refuses when local differs from remote deadlocks the moment the thing
  that changed remote IS the pull's own prior write, and the commit API
  sending whole-file content rather than a diff means any automatic pull
  risks silently reverting local edits it doesn't know about. That
  reasoning was written about CI-driven writes, but the same shape of
  problem (whole-file overwrite, no diffing, no merge) applies to any
  automatic pull, human-triggered scheduling included. Nothing here should
  casually reach for "just sync it automatically" without re-deriving
  whether that reasoning still holds for this specific mechanism, and it
  probably means sync is a materially riskier proposal than import even
  once the browse/picker plumbing exists.

## Loose ends from the exploration, not otherwise captured

- If discovery ever gets built, does it belong in `plugin-shell` as a new
  view, or as a mode of the existing sidebar panel? The existing panel is
  already dense (connection state, actions, your documents, and now
  recovery); a full repository browser might want its own surface.
- Whether "browse and import" and "recover" should visually live in the
  same list once both exist, or stay distinct — recovery is "yours, just
  misplaced"; discovery is "not yours, but available." Conflating them
  might read as confusing ownership signals to an author who has never
  thought about who wrote what in a shared knowledge base.
- No permission spike has been run for the repository-tree endpoint. Same
  treatment as everything else once this becomes real: add it to
  `docs/ce-verification.md` rather than assuming.

## Revisiting this

Come back here once `add-document-recovery` has shipped and been used for a
while — the actual pain of "I want a teammate's document and it's not
here" needs to be felt a few times before it's worth committing to browse
UI, tree pagination, and the legacy-content answer above. If and when that
happens, this document is the starting point for a real `/opsx:propose`,
not the proposal itself.
