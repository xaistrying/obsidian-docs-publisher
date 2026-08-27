<!-- CODEGRAPH_START -->
## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->

## Project reference docs

`docs/` holds verified background on the platform this plugin targets. Read the
relevant doc BEFORE designing or implementing against its subject — these exist
so the facts are looked up once, not re-derived or guessed per session.

- `docs/gitlab-roles.md` — GitLab access levels and what each can actually do
  here; the three independent permission gates; why a role is an optimistic
  predictor and never proof a call will succeed. Read before anything that
  shapes UI by role or gates an action on permissions.
- `docs/document-identity.md` — what `doc_id` is and when it is frozen, how
  branches are named, how a note is reconnected to its merge request, and how
  remote paths are decided. Read before naming a branch, resolving a note to a
  merge request, or deciding where a file goes on the remote.
- `docs/access-tokens.md` — which token type this project uses and why, what is
  held in memory versus written to disk, the open `secretStorage` spike, and
  what "Test connection" does and does not prove. Read before touching
  credential handling or authentication.

`openspec/config.yaml` lists these under REFERENCE DOCS and is the authority on
project decisions; `docs/` carries the supporting detail. If a fact appears in
both and they disagree, that is a bug — say so rather than picking one.
