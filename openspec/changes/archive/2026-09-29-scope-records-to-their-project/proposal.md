## Why

A tracking record does not say which project it was written against. Point the
plugin at a different project and every document keeps wearing the state it held
on the old one, with a resubmit button offering to act on it.

Observed 2026-09-29 and written up as §D0h of `docs/ce-verification.md` (now
archived under `openspec/changes/archive/2026-09-29-verify-against-target-instance/`).
The panel connected correctly to the new project — right role, right import
count — while `test-002`, `test-003`, `test-004`, `test-008`, `test-006` and
`test-009` all still showed the old project's states, and `test-002`'s button
read "Send update".

## What Changes

**A record carries the project it belongs to, and surfaces refuse to act on one
that does not match.**

The 2026-09-20 guard already clears held states when the project id is edited,
and it works. What undoes it is the next successful refresh: it resolves each
`doc_id` against the NEW project, finds no merge request, returns
`submission: null`, and the row falls back to `stored?.state`. The clear is
real; the fallback resurrects what it cleared. `writeBack` then skips every
entry whose submission is null, so the stale records are never corrected or
removed either, and `renderSubmitSection` reads its label straight from the
stored record without consulting the resolved status at all.

**The fallback is not wrong — it is ambiguous, and that is the actual defect.**
It exists so an imported document reads as published: such a document has no
merge request, so the store is the only thing that knows. "No merge request
found for this `doc_id`" is the identical observation whether the document was
imported into this project or belongs to one the plugin is no longer pointed at.
Nothing in the record can tell those apart, so the ambiguity has to be removed
at the source rather than guessed at on each surface.

**Records are stamped on evidence, never on assumption.** A record gains its
project when reconciliation MATCHES it to a merge request there — which proves
it belongs. Until stamped, a record's project is unknown and no surface offers
an action from it. In the common case, where nobody has switched projects, the
first refresh stamps everything and no author notices. Where someone HAS
switched, the stale records stay inert, which is the correct answer rather than
a cost.

**The project is identified by host plus its canonical numeric id.** The
settings tab accepts either a numeric id or a namespace path, so the same
project can be configured under two different strings and a literal comparison
would read one as the other's stranger. `GET /projects/:id` returns the
canonical `id` whichever form was configured, and the connection check already
makes that call — so resolving it costs nothing and removes the ambiguity
outright. The host is part of the identity because the same path on two
instances is two projects.

**Not in scope:** the doc_id collision that makes this dangerous rather than
merely untidy. `doc_id` is unique within a REPOSITORY — `docs/document-naming.md`
is explicit that the rule is repo-scoped, and records the 2026-09-15 incident —
so two doc repos in one org can both hold a `README`. This change stops the
plugin acting across that boundary; it does not make `doc_id` globally unique,
which is a different and much larger question.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `submission-tracking`: a record gains the project it was written against, and
  the rules for when it is stamped and what an unstamped record means. This is
  where the ambiguity lives and therefore where it is removed.
- `plugin-shell`: no surface offers an action derived from a record whose
  project does not match the configured one, and a document in that position is
  not shown a state it cannot support.
- `doc-authoring`: submitting records the project alongside the branch and
  merge request, since a submission is the other thing that establishes where a
  document lives.

## Impact

- `plugin/src/submission-tracking/submission-record.ts` — the new field and its
  meaning when absent.
- `plugin/src/submission-tracking/reconcile.ts` — stamping on a confirmed match,
  and leaving unmatched records alone as it already does.
- `plugin/src/submission-tracking/document-status.ts` — what a record with a
  foreign or unknown project resolves to.
- `plugin/src/main.ts` — `renderDocumentRow`'s fallback to `stored?.state`, and
  `renderSubmitSection`'s label, which reads the record directly.
- `plugin/src/doc-authoring/submit-document.ts` — recording the project on
  submit.
- `plugin/src/git-publishing/gitlab-client.ts` — `ProjectAccess` gains the
  canonical numeric id, which the response already carries and the type drops.
- `docs/ce-verification.md` §D0h — struck when this ships.
