## Why

Authors create their own access tokens, one per person, with a one-year
expiry. A token's permissions cannot be edited once it exists, so there is no
central rotation to hand off to. These were decided 2026-09-30 and recorded in
`docs/access-tokens.md` §1. Every message the plugin shows about the token
still sends the author to an admin, who can do nothing for them:

- A rejected or expired token reads "…Ask your admin to set it up again." The
  author has to create the new token themselves.
- A token missing a permission reads "…Ask your admin to add it." Nobody can
  add a permission to an existing token, so the author has to make a new token
  that includes it.

The expiry message also appears in three different wordings: in
`config.yaml` milestone 2, in the platform-config spec, and in the code of
each of the two surfaces. The settings tab's code already disagrees with its
own spec.

A rejected token during a write is not recognised at all. Submit reports it as
"Submit didn't go through. Check your connection and submit again.", so an
author whose token expired mid-session retries a submit that can never work.
Milestone 2 requires a 401 "anywhere in the plugin" to surface as the expiry
message, and only the connection check does.

## What Changes

- **Expired or rejected token, everywhere the plugin reports a failure:**
  - It reads "Your access token has expired or is incorrect. Check you pasted
    all of it, or create a new one in GitLab."
  - It is the same string on every surface, defined once.
  - It is added to the places that today fall through to a generic message:
    Submit, the status refresh, the import list, and the Reset and Restore
    reads.
- **Missing permission, where the platform names it:**
  - It ends "(missing: *name*). Create a new access token that includes it."
    in place of "Ask your admin to add it."
- **Missing permission, where the platform names none:**
  - It ends "Create a new access token with the permissions listed in the
    plugin's settings."
- **The seven permission-message builders become one:**
  - All seven share the shape "Your access token doesn't have permission to
    *action*…", so they are replaced by one builder in
    `platform-config/access-messages.ts`.
  - That file already exists to keep copy from drifting between surfaces.
  - `recoveryPermissionMessage` is deleted; nothing calls it.
- **Unchanged:** the role messages ("Ask your admin for Developer access",
  "Ask your admin for access"). A role is the one thing only an admin can
  change.
- **Docs:** `openspec/config.yaml` milestone 2 is amended in place so it quotes
  the new message.
- **User guide:** `plugin/README.md` §7 and §8 are updated to quote the new
  messages.

### Deferred, deliberately

- **A reminder before a token expires.**
  - The plugin cannot know a token's expiry date without reading it, and
    fine-grained token self-inspection is its own permission question.
  - The user guide suggests a calendar reminder instead.
  - Revisit on author feedback after release.
- **Saving the token in Obsidian.** This is the open `secretStorage` spike,
  `docs/access-tokens.md` §3.
- **Two drifts in the same requirement blocks, not fixed here.**
  - The platform-config spec says "Check the project path above". The code
    says "project ID".
  - Other copy drift also belongs to the spec-drift catch-up change (release
    step 8).
  - This change edits only the scenarios it exists to change, so its diff
    stays readable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- **`platform-config`:**
  - The connection check's rejected-token scenario changes its message.
  - A new requirement says every message about the access token tells the
    author how to fix it themselves, on every surface, and never sends them to
    an admin for something only they can do.
- **`plugin-shell`:**
  - The panel's rejected-token scenario changes its message.
  - The refresh's missing-permission scenario changes its message.

## Impact

- **Code:**
  - `plugin/src/platform-config/access-messages.ts`: new constant and builder.
  - `plugin/src/platform-config/settings-tab.ts`: failure table and
    permission message.
  - `plugin/src/main.ts`: panel failure table, and the refresh, discovery,
    reset and restore failure sites.
  - `plugin/src/doc-authoring/submit-document.ts`: `reportFailure`.
- **Tests:** one small test for the builder and the rejected-token branch in
  `reportFailure`'s classification.
- **Docs:** `openspec/config.yaml` milestone 2 and `plugin/README.md`.
- **Unaffected:** no remote call, no data shape, nothing in git-publishing.
  `FailureKind` is only imported as a type.
