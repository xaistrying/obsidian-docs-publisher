## Context

Milestone 3 (`add-document-creation`, archived) built the gate pattern
(connection details → verified check → Developer access), the panel/command
dual entry point, and front-matter composition — all reused here rather than
duplicated. `git-publishing` currently exposes only two read calls
(`getCurrentUser`, `getProjectAccess`); this is the capability's first write.
`submission-tracking` does not exist in `plugin/src/` yet.

Two reference docs are load-bearing for this design and are cited, not
restated: `docs/document-identity.md` (branch naming, `doc_id` semantics, the
refuse-to-move rule) and `docs/access-tokens.md` §1 (the
`insufficient_granular_scope` spike finding).

## Goals / Non-Goals

**Goals:**
- Complete the front matter contract (`title`, `category`, `doc_id`) at first
  submit, per the shift-right split already decided in `openspec/config.yaml`.
- Perform the plugin's first write to GitLab: create branch + commit, then
  create the merge request.
- Give the author one visibility moment — the target remote path — before
  `doc_id` freezes.
- Classify a write-specific failure (insufficient token permission) distinctly
  enough to name the missing permission, not just "not reachable."
- Persist enough submission state that the note can show "Waiting for review."

**Non-Goals:**
- Resuming or repairing a partial failure (branch created, merge request
  creation failed). Explicitly punted — see Decisions.
- Disambiguating "my own dead retry" from "a different author's collision" on
  a branch-already-exists response. Both produce the same author-facing
  outcome.
- Any read/reconciliation call (`GET /merge_requests`) — milestone 5.
- Attachment sync — milestone 4a.
- The duplicate-`doc_id` and path-mismatch pre-submit checks — they do not
  bind on a first submit; milestones 6 and 7.

## Decisions

### One modal: title, category, target path — no wizard

A single modal collects `title` (free text, required) and `category`
(dropdown, one of the nine fixed values in `openspec/config.yaml`, required),
and shows a read-only line with the document's resolved target path — the
note's current vault path, per the 1:1 vault-mirroring rule in
`docs/document-identity.md` §4. This is the confirmation moment the
`milestone4-submit-path-confirmation` memory asked for, folded into the same
surface rather than a separate step, per "prefer the boring option."
"Submit" stays disabled until both fields are non-empty. No alternative
considered survives that principle: a multi-step wizard adds clicks for three
fields that fit comfortably in one screen.

### `doc_id` is snapshotted at confirm, but not written until both remote calls succeed

At confirm time, the plugin reads the note's current filename, validates it
as git-ref-legal (ASCII-fold Vietnamese diacritics; reject spaces,
`~^:?*[\`, a leading dot, a trailing `.lock`), and holds the result as the
pending `doc_id` — an in-memory value passed to the write calls, not yet
persisted to the note.

Front matter (`title`, `category`, `doc_id`) is written to the note **only
after** both `POST /repository/commits` and `POST /merge_requests` succeed.

This ordering is load-bearing, not incidental: it is what makes the
punt-on-ambiguity retry story (below) actually work. If `doc_id` were frozen
before the remote calls, a failure followed by a rename would leave the
already-written front matter untouched — the note would carry a `doc_id` that
was never truly snapshotted from a successful submit, and a subsequent retry
would still be aimed at the name that failed. Freezing only on success means
every retry starts from a clean slate: the filename (and therefore the
candidate `doc_id`) is whatever the author currently sees.

Alternative considered and rejected: write `doc_id` speculatively before the
remote calls, roll it back on failure. Rejected because it requires a second
file write on the failure path (write, then undo) for no benefit over simply
not writing until success — more moving parts for the same outcome.

### Write-path failure classification: a distinct, detail-carrying kind

The existing `FailureKind` (`rejected-credential | not-reachable |
server-unreachable | unexpected`) was shaped for two read calls and has
nowhere to carry a response body — `logFailure` logs the detail and discards
it. Per `docs/access-tokens.md` §1, GitLab responds to a write blocked by a
fine-grained token's insufficient permissions with a named
`insufficient_granular_scope` error body, not a bare 403 — materially more
useful than "not reachable" if it reaches the author.

Add a new kind, e.g. `'insufficient-permission'`, produced only by the write
methods, and extend the failure variant of `ClientResult` with an optional
`detail?: string` carrying GitLab's reported permission name. Existing read
methods and their existing three failure kinds are unchanged; this is
additive to the type, not a reshape of it.

The settings-tab-style `FailureKind → message` table (currently in
`settings-tab.ts`) gets one new entry for the submit surface: something like
"Your access token doesn't have permission to submit documents (missing:
{detail}). Ask your admin to add it." — author-facing, so it names the
GitLab-reported permission but not the request mechanics.

Alternative considered: keep using `not-reachable` for a 403 on a write and
rely on the generic message. Rejected — `docs/access-tokens.md` explicitly
flags this as "unusually good material for a clear message," and discarding
it after the spike went to the trouble of finding it would waste the finding.

### Punt on ambiguity: one failure path, not a resumability system

Per the explore-mode decision: a failed first-submit sequence — whether the
commit call explicitly reports the branch already existing, or a network
interruption leaves the outcome unknown — is treated as one undifferentiated
failure. No inspection of *why* it failed beyond the permission-scoped case
above, no reconciliation call, no attempt to resume from wherever the
sequence stopped.

This is safe specifically because of the write-ordering decision above:
`doc_id` never froze, so the fix — rename the file, submit again — produces a
genuinely new candidate `doc_id` and a new branch name, sidestepping whatever
state (if any) is sitting on the remote under the old name. The cost is a
possible orphaned branch on the remote with no merge request pointing at it;
see Risks.

Author-facing message (vocabulary-checked against the ban on branch, commit,
merge request, MR, conflict, main — none appear):

> "Submit didn't go through. This can happen from a dropped connection, or
> because another document is already using this file name. Rename the file
> to get a new ID, then submit again."

"ID" here matches the team's own vocabulary for the filename — 
`docs/document-identity.md` already calls the filename "the control ID" —
so this is consistent with language authors already use, not a new term.

Alternative considered: distinguish the two cases and give a more specific
message for each. Rejected together with the resumability system it would
imply — the fix is identical either way, and a more specific message buys
nothing the author can act on differently.

### `submission-tracking`: one record per document, keyed by `doc_id`

New capability, new `plugin/src/submission-tracking/` module. One record per
submitted document, persisted in plugin data (`data.json`, plaintext by
default per the architecture decision):

```ts
interface SubmissionRecord {
  docId: string;
  branch: string;       // doc/<docId> — derivable, stored for convenience
  mrIid: number;
  state: 'pending';      // this milestone's only reachable state; see below
}
```

Keyed by `docId`, not file path. `docs/document-identity.md` establishes
`doc_id` — not the path — as the identity that survives a rename; a record
keyed by path would silently orphan itself the first time the author renames
the file post-submit, which the design explicitly allows. Resolving "which
record belongs to this open note" reads `doc_id` from the note's own front
matter and looks up by that value — the same approach
`docs/document-identity.md` §2 already uses for remote reconciliation,
applied one layer earlier.

The `state` field's type should accommodate the full submission-state enum
from `openspec/config.yaml` (`unsubmitted, pending, changes-requested,
published, closed`) for milestones 5+ to extend without a data migration, but
this milestone only ever writes `pending` — "unsubmitted" is the absence of a
record, not a stored state, since nothing is tracked before a first
successful submit.

## Risks / Trade-offs

- **[Risk] A failed first submit can leave an orphaned branch on the remote**
  (commit succeeded, MR creation failed) with nothing in the vault pointing at
  it, and no plugin mechanism ever cleans it up.
  → **Mitigation**: accepted per the punt decision above. The branch carries
  no unique content the author can't reproduce — the note itself is
  unaffected and the author's next attempt uses a different name. Cleanup is
  a manual GitLab operation, consistent with the escape hatch this project
  already uses for reorganizing published documents.
- **[Risk] The `insufficient-permission` detail string is GitLab's own error
  text, not plugin-composed copy** — its exact wording isn't controlled here.
  → **Mitigation**: treat it as an interpolated fragment inside a
  plugin-authored sentence (see message above), never displayed alone, so a
  surprising GitLab phrasing degrades gracefully rather than reading as a
  raw error dump.
- **[Risk] Two authors on different machines can independently name a new
  document identically**, producing the same candidate `doc_id` and the same
  branch name. Neither the local duplicate-`doc_id` check (same-vault only)
  nor any check this milestone builds catches this in advance — it only
  surfaces as the undifferentiated failure above, for whichever author
  submits second.
  → **Mitigation**: accepted, consistent with the punt decision. The team is
  four people using team-governed control-ID naming conventions
  (`SBT-KE-001_…`), which makes an accidental identical filename unlikely in
  practice; this is exactly the class of "speculative generality" the design
  rules ask not to build for.
- **[Trade-off] No resumability means a partial failure always costs the
  author a rename**, even in the case where simply retrying the merge-request
  call would have finished the job cheaply. Traded deliberately for not
  borrowing milestone 5's read capability early and not building reconciliation
  logic this milestone doesn't otherwise need.

## Open Questions

- Exact GitLab error body shape for `insufficient_granular_scope` on this
  specific instance (CE 19.3.0) — the spike in `docs/access-tokens.md` was
  run against gitlab.com and confirmed the mechanism, not the exact JSON
  field name to parse. Confirm against the target instance during
  implementation; fall back to the generic `unexpected` kind if the body
  doesn't parse as expected rather than failing the whole classification.
- Whether the modal's target-path preview needs a live refresh if the author
  renames the file while the modal is open (e.g. via a background sync
  client), or whether reading the path once at modal-open is acceptable.
  Leaning toward "read once" as the boring option — the window is seconds.
