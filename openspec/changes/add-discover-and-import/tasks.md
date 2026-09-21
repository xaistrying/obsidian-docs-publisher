## 1. git-publishing: the repository tree read

- [x] 1.1 Add a recursive, paginated repository-tree read against a given
      ref, capped like `listMergeRequests` is.
- [x] 1.2 Report `truncated` as part of a successful answer; never let a
      partial listing read as complete.
- [x] 1.3 Classify through `classifyScopedStatus` like the other scoped
      reads, so a missing permission is named rather than reported as
      unreachable.

## 2. submission-tracking: resolving what is discoverable

- [x] 2.1 Add discovery resolution in its own module alongside
      `recover.ts`/`reset.ts`, following the one-file-per-direction
      convention those established.
- [x] 2.2 Compare remote markdown paths against vault note paths,
      case-sensitively, built from the vault rather than from stored
      records.
- [x] 2.3 Exclude any remote markdown file carrying no front matter block.
      Not by filename, and not by requiring the full contract — §E2 is the
      argument for both.
- [x] 2.4 Propagate truncation: a resolution built on a truncated listing
      reports itself incomplete.
- [x] 2.5 Confirm a document the vault holds under a DIFFERENT path still
      appears as discoverable, and is caught at import by the
      duplicate-`doc_id` check rather than hidden here.

## 3. doc-authoring: the import write

- [x] 3.1 Write the note at its exact remote path, creating missing
      folders, mirroring `recoverDocument`'s existing behaviour.
- [x] 3.2 Freeze `doc_id` into the note's front matter at import, derived
      from the remote filename by the same rule first submit uses.
- [x] 3.3 Preserve every other front-matter field the document already
      carries, byte for byte. The plugin adds `doc_id` and nothing else.
- [x] 3.4 Refuse on a duplicate `doc_id` anywhere in the vault, naming the
      note that holds it, before writing anything.
- [x] 3.5 Refuse on an occupied target path, as `recoverDocument` does.
- [x] 3.6 Confirm NO `SubmissionRecord` is written — reconciliation
      resolves an imported document from its front matter on the next
      refresh (design.md decision 2).
- [x] 3.7 Confirm the milestone 3a default-directory setting is not
      consulted anywhere on this path.

## 4. doc-authoring: attachments for import and recovery (9a)

- [x] 4.1 Add the attachment fetch: given a note now in the vault and the
      ref it came from, resolve its embeds through the EXISTING
      `resolveEmbeddedAttachments` and fetch each one.
- [x] 4.2 Write each attachment at its own remote path; leave a file the
      vault already holds at that path alone rather than overwriting.
- [x] 4.3 Run it after the note is written, since resolution reads the
      vault's index and the note must be in it first (design.md decision
      3).
- [x] 4.4 Wire it into BOTH import and `recoverDocument`, so the two share
      one mechanism rather than diverging.
- [x] 4.5 Report a failed attachment fetch per attachment; the note stays,
      the failure is never silent.

## 5. plugin-shell: the Discover section

- [x] 5.1 Add the third panel section, absent entirely when empty like the
      other conditional sections.
- [x] 5.2 Render each discoverable document by its remote path.
- [x] 5.3 Add per-document import and import-all actions, reporting
      outcomes per document.
- [x] 5.4 Continue an import-all past a refusal rather than stopping at the
      first one, reporting each.
- [x] 5.5 Surface truncation plainly when the listing was incomplete.
- [x] 5.6 Populate only on the panel's existing explicit triggers; never
      reach the remote during a render.
- [x] 5.7 Styling in `plugin/styles.css`, consistent with the existing
      sections.

## 6. Tests

- [x] 6.1 Discovery: remote-minus-vault path comparison, including the
      case-sensitive case and the same-`doc_id`-different-path case.
- [x] 6.2 Exclusion: a file with no front matter is excluded; one with
      partial front matter is included; a file named `_placeholder.md`
      carrying front matter is included.
- [x] 6.3 Truncation: a truncated listing produces an incomplete
      resolution, and is never presented as the full set.
- [x] 6.4 Import refusals: duplicate `doc_id` and occupied path each refuse
      and write nothing.
- [x] 6.5 `doc_id` derivation at import matches what first submit would
      derive for the same filename, including the ASCII-folding case.
- [x] 6.6 Front matter preservation: an imported note keeps every field it
      arrived with and gains only `doc_id`.
- [x] 6.7 Attachment resolution runs against the note's vault index after
      the write, and an already-present attachment is not overwritten.

## 7. Observed against the real instance — the irreducible residue

Partially run. What was not run is named at the end of this section.

- [x] 7.1 The repository-tree endpoint's response shape, which the client
      parses and which no spike has ever covered.
- [x] 7.2 Its permission name when refused for a fine-grained credential —
      never observed; `docs/ce-verification.md` notes the gap.

DROPPED 2026-09-20, deliberately and with the debt moved rather than
cancelled. The end-to-end import against the real instance — a document
that embeds an image, its attachment landing, the embed rendering, and the
same for Recover — was not run, and this change closes without it.

It is NOT lost: it lives in `docs/ce-verification.md` §E6 and §E7 as a
runnable checklist, which is where this project keeps what has not been
confirmed on the target instance. `.claude/CLAUDE.md` names that file as
the authority on exactly this, and its own convention is to record results
there rather than in a change's tasks — so a standing checklist is the
right home for an outstanding check, and a per-change task list is not.

What that means for anyone reading this later: the import and attachment
paths are covered by tests over fakes, which pin what this plugin BUILDS
and never that the platform accepts it. §E6 says what would break and how
to tell. Run it before trusting the attachment half in anger.

## 8. Documentation upkeep

- [x] 8.1 Amend `docs/document-identity.md` §3 to state that `doc_id` is
      frozen at first submit for an authored document and at import for an
      imported one — design.md decision 1. Leaving §3 as-is would leave two
      rules standing with no way to choose between them.
- [x] 8.2 Mark milestones 9 and 9a done in `openspec/config.yaml`, terse:
      that file sits near a 50KB limit past which the whole context field
      is silently dropped, and it has crossed it twice already.
- [x] 8.3 Update `docs/panel-tracking-scope.md`'s milestone 9 half to
      describe shipped behaviour, and close its "where does Discover live"
      open question with what was decided.
