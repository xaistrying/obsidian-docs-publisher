## 1. Test harness

- [x] 1.1 Add Vitest as a dev dependency and a `test` script alongside
      `typecheck` and `build`.
- [x] 1.2 Add an `obsidian` stub module and alias it in the test config —
      every source module imports `obsidian` at runtime, so nothing is
      importable in a test process without this.
- [x] 1.3 Keep the stub to what tests actually touch (`Notice`,
      `requestUrl`, `normalizePath`, enough of `Modal`/`Setting` to
      import). It is not a reimplementation of Obsidian and must not grow
      into one.
- [x] 1.4 Confirm `npm run typecheck` and `npm run build` are unaffected
      by the harness — tests must not become a build dependency.

## 2. git-publishing: several files in one commit

- [x] 2.1 Widen `createBranchWithCommit` and `commitToBranch` to take an
      array of file actions, each with its own path, content, verb, and
      optional `last_commit_id`.
- [x] 2.2 Add per-action `encoding: "base64"` for binary content; the note
      stays plain text.
- [x] 2.3 Confirm both still funnel through the one shared payload
      builder, rather than each growing its own array handling.
- [x] 2.4 Update the single-file callers so this is a widening, not a
      second code path.

## 3. git-publishing: the changed-path repair

- [x] 3.1 Narrow `getMergeRequestChangedPath` to "exactly one MARKDOWN
      file changed" — filter to `.md`, then apply the existing rule.
- [x] 3.2 Record in that function's own comment that transclusion, if ever
      supported, is what breaks this rule (design.md decision 1).
- [x] 3.3 Confirm its three callers (`submit-document.ts`'s path-mismatch
      check, `reset.ts`, `recover.ts`) are unchanged — the repair is
      inside the shared function, not in them.

## 4. doc-authoring: resolving what a note embeds

- [x] 4.1 Add embed resolution as pure logic over a cache-shaped
      interface: takes the note and the metadata cache, returns the vault
      paths it embeds. No `App`, no file reads, no network.
- [x] 4.2 Resolve wikilink embeds through the vault's own resolver
      (`getFirstLinkpathDest`), never by matching filenames from text.
- [x] 4.3 Resolve markdown-style embeds as paths relative to the note, and
      confirm each exists in the vault.
- [x] 4.4 Skip — never fail on — an embed that resolves to nothing, to a
      location outside the vault, or to the note itself.

## 5. doc-authoring: building the submission's file set

- [x] 5.1 Assemble the note plus its resolved embeds into the file set a
      submission carries.
- [x] 5.2 Read each file's bytes; base64 the attachments, leave the note
      as text.
- [x] 5.3 Decide each file's verb by reading whether that path exists on
      the ref being committed to, via the existing `getFileCommitId` —
      the same rule the note already follows, applied per file.
- [x] 5.4 Wire it into all four write paths (first submit, update under
      review, published new cycle, not-accepted new cycle) so none of
      them can commit the note alone.
- [x] 5.5 Confirm no delete action is ever emitted, for any file.

## 6. Tests

- [x] 6.1 Embed resolution: wikilink resolved via the resolver; two
      same-named images in different folders resolve to the right one;
      markdown-style embed resolved relative to the note.
- [x] 6.2 Embed resolution: an unresolvable embed, an embed outside the
      vault, and a self-embed are each skipped without failing.
- [x] 6.3 Action list: paths, verbs, `encoding` on attachments only, and
      `last_commit_id` present on updates and absent on creates.
- [x] 6.4 Action list: mixed verbs in one commit (a new image and a shared
      one already on the remote).
- [x] 6.5 Action list: a note embedding nothing produces exactly the
      single action it produces today — the no-attachment case is
      unchanged.
- [x] 6.6 Changed-path rule: one markdown file resolves; one markdown plus
      three images resolves to the markdown; zero markdown and two
      markdown each report "could not be determined".
- [x] 6.7 Confirm the tests pin payload SHAPE only, and assert nothing
      about whether the platform accepts it — that distinction is
      decision 5 and is what keeps these tests honest.

## 7. Observed against the real instance — the irreducible three

These cannot be tests. A stub verifies what this project believes the API
wants, and `docs/ce-verification.md` exists because that belief has been
wrong before.

- [x] 7.1 A commit payload with several actions and mixed create/update
      verbs is accepted. CONFIRMED 2026-09-13 on gitlab.com: one commit
      `cb4133e9`, three files, `create` and `update` mixed. Detail in
      `docs/ce-verification.md` §B9, including that the commit message
      confirms the note is `actions[0]`.
- [x] 7.2 A per-action `last_commit_id` is honoured for actions other than
      the first — confirm a stale one on a SECOND action is refused, not
      ignored. CONFIRMED 2026-09-13 on gitlab.com via `b10.sh`: HTTP 400
      naming `test/img-shared.png` (which is `actions[1]`, so the second
      guard really was evaluated), and the valid first action was NOT
      applied — atomic. Detail in `docs/ce-verification.md` §B10.
- [x] 7.3 Binary content survives as base64 through Obsidian's request
      helper: the committed image is byte-identical to the local file, and
      renders in GitLab. CONFIRMED 2026-09-13 on gitlab.com via `b11.sh`:
      280747 bytes and matching sha256 both sides. Detail in
      `docs/ce-verification.md` §B11, including why a bare checksum first
      reported a false mismatch.
- [x] 7.4 Record all three in `docs/ce-verification.md`, per that doc's
      own convention, including any permission name newly observed.

## 8. Documentation upkeep

- [x] 8.1 Mark milestone 4a done in `openspec/config.yaml`, terse — that
      file sits near a 50KB limit past which the whole context field is
      silently dropped.
- [x] 8.2 Give the deferred read side (pulling attachments down for
      Recover and Import) a milestone number, so it is a decision rather
      than an omission by that file's own rule.
- [x] 8.3 Note in `docs/resubmission-lifecycle.md` and
      `docs/panel-tracking-scope.md` that the one-file assumption their
      features relied on is now a one-markdown-file assumption.
