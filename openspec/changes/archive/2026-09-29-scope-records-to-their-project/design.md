## Context

`data.json` holds records keyed by `doc_id`, and nothing in one says where it
came from. That was invisible while a vault pointed at one project for its
whole life, and the plugin's own history shows it was not invisible for long:
the 2026-09-20 fix added a clear-on-`unverified` because editing the project id
left the old project's documents listed with live Recover buttons beside them.

That fix addressed the symptom it could see. §D0h is the same hazard reached by
a different route — the clear happens, and the next successful refresh undoes it
through a fallback added for an unrelated and legitimate reason.

The fallback:

```ts
const state = status.submission?.state ?? stored?.state;
```

exists so an IMPORTED document reads as published rather than "not submitted
yet": an import has no merge request, so the store is the only thing that knows.
Both cases present identically — no merge request found for this `doc_id` — and
no amount of care on the surface can separate them, because the information
needed is not in the record.

## Goals / Non-Goals

**Goals:**

- A record says which project it belongs to, so "imported here" and "belongs
  elsewhere" stop being the same observation.
- No surface offers an action built from a record that does not match the
  configured project.
- Existing vaults heal themselves without asserting anything unverified.

**Non-Goals:**

- Making `doc_id` unique across projects. It is repo-scoped by design
  (`docs/document-naming.md`), and that is what makes the collision case
  possible; this change stops the plugin acting across the boundary rather than
  removing the boundary.
- Diagnosing or fixing §D0e, §D0c or §D0d.
- `correct-stale-records`'s territory. That change widens reconciliation to
  cover records the CURRENT project knows about; this one is about records it
  has never heard of. Same family, different fix — see Risks.

## Decisions

### 1. Stamp on a confirmed match, never on assumption

A record gains its project when reconciliation matches it to a merge request on
the configured project. That is evidence: the remote just confirmed this
`doc_id` lives here.

Until stamped, a record's project is UNKNOWN, and unknown offers no actions.

REJECTED: stamping every existing record with whatever is configured when this
ships. It is the cheapest option and it asserts the one thing that cannot be
known — if the author has already switched projects, it stamps the wrong
project and makes the bug permanent under the appearance of a fix.

REJECTED: unknown forever until the document is resubmitted. Safe, and it
punishes the common case: a vault that never switched projects would show every
tracked document with no actions and no explanation, to fix a problem that vault
does not have.

**Stamp-on-match is self-healing in the common case and correctly inert in the
broken one**, which is the property worth having. A vault that never switched
gets everything stamped on its first refresh and nobody notices this change
happened.

### 2. Identity is host plus the canonical numeric project id

The settings tab accepts either a numeric id or a namespace path — its own
description says so — which means the same project can be configured two ways
and a literal string comparison would call one a stranger to the other.

`GET /projects/:id` returns the canonical numeric `id` whichever form was
configured. The connection check already makes that call, so the canonical id
is already on the wire and merely dropped by `ProjectAccess`, which keeps only
the access level and label. Widen that type and the resolution is free.

The HOST is part of the identity because the same namespace path on two
instances is two different projects — `styl-group1/kb-docs` on gitlab.com and on
a self-managed instance are unrelated, and this run switched between exactly
that shape of pair.

REJECTED: storing whatever string was configured and comparing literally. It
would make a project inert after a harmless id-to-path edit, and self-correct
only on the next refresh. Cheap, and wrong in a way that looks like the bug it
is meant to fix.

### 3. An unknown or foreign project means no state and no action, not a guess

The fallback to `stored?.state` stays for a record stamped with the configured
project — that is the imported-document case it was written for and it remains
correct there.

For a record stamped with a DIFFERENT project, or not stamped at all, the
fallback does not apply: the document resolves to no state, exactly as a
document nothing has resolved does today, and the existing "no state label"
handling covers it. `renderSubmitSection` must consult the same rule rather than
reading the record directly, which is the specific reason the button said "Send
update" while the row said nothing.

This keeps the change honest about what it knows. A document whose project is
unknown is not published, not pending, and not "not submitted" — it is
unresolved, which the panel already has a way to say.

## Risks / Trade-offs

**A vault mid-switch shows documents with no actions** → Correct, and the only
alternative is offering actions against a project the record does not belong to.
The author's route back is to point at the original project, where the records
stamp and everything returns, or to resubmit into the new one.

**Interaction with `correct-stale-records`** → That change reconciles stored
records that have no note in the vault. This one adds a project to records and
gates actions on it. They touch `reconcile.ts` and `document-status.ts` in
common and do not contradict: widening WHICH records are reconciled is
orthogonal to stamping the ones that match. Whichever lands second should re-run
the other's tests rather than assume.

**`ProjectAccess` grows a field** → Session-only, not persisted, and the value is
already in the response being parsed. Low.

**A project genuinely renamed or moved** → GitLab keeps the numeric id across a
rename, so records survive it. A project deleted and recreated at the same path
gets a new id and its records go inert, which is right: they describe merge
requests that no longer exist.

## Migration Plan

No data migration and no version field. Records without a project are treated as
unknown and are stamped by the first refresh that matches them, so an ordinary
vault repairs itself the first time the panel is opened after this ships.

What an author sees in the window before that first refresh: documents listed
with no state labels and no actions, for as long as it takes one refresh to
complete. Worth confirming that window is as short as it sounds, because it is
the whole visible cost of this change in the common case.

Records that never match — because they belong to another project, or because
their merge request is gone — stay unstamped and inert indefinitely. That is the
intended end state, not an incomplete migration.

## Open Questions

- Whether the panel should SAY why a document has no actions, rather than
  silently offering none. "This document belongs to a different project" is
  true and useful; it is also a new message on a surface this change is
  otherwise only removing things from. Worth deciding during implementation
  once the inert state can be seen.
