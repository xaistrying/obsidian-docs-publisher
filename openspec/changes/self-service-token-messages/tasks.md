## 1. Shared copy

- [x] 1.1 In `plugin/src/platform-config/access-messages.ts`, add
      `EXPIRED_TOKEN_MESSAGE` and `tokenPermissionMessage(action, detail)`
      with the exact text in design.md decision 1. Extend the file's header
      comment to say it now also holds the token messages, and why: authors
      fix their own tokens.

## 2. Use it at every site

- [x] 2.1 `settings-tab.ts`:
      - point `FAILURE_MESSAGES['rejected-credential']` at the constant;
      - replace `connectionPermissionMessage` and the
        `'insufficient-permission'` fallback entry with the builder
        (`'check your connection'`, and `'check your account'` for the
        fallback).
- [x] 2.2 `main.ts`, panel connection state:
      - point `PANEL_FAILURE_MESSAGES['rejected-credential']` at the
        constant;
      - replace the panel's `connectionPermissionMessage` and the table's
        `'insufficient-permission'` entry with the builder.
- [x] 2.3 `main.ts`, the status refresh, import list, and Reset and Restore
      reads (four sites):
      - add a `'rejected-credential'` branch mapping to the constant, ahead
        of the existing permission branch;
      - replace `refreshPermissionMessage`, `discoveryPermissionMessage` and
        `resetPermissionMessage` with the builder.
- [x] 2.4 Delete `recoveryPermissionMessage`, which has no caller. Then grep
      for any other `FailureKind` consumer that classifies
      `'insufficient-permission'` but not `'rejected-credential'`. If you
      find one, add the branch and list it here.
      None found. `RECOVERY_REFRESH_FAILED_MESSAGE` was dead alongside it
      and is deleted too.
- [x] 2.5 `submit-document.ts` `reportFailure`:
      - add `'rejected-credential'` → the constant, ahead of the permission
        branch and taking precedence over the step's own `message`;
      - replace `insufficientPermissionMessage` with the builder
        (`'submit documents'`), keeping the step's `message` as the
        unnamed-permission fallback only where it is today.
      DONE DIFFERENTLY: an unnamed permission now uses the builder's
      "listed in the plugin's settings" ending, not the step's message, as
      the ADDED platform-config requirement demands for every action. The
      choice was split out as the exported `failureMessage` so 4.1 can test it.
- [x] 2.6 Check that no author-facing string still contains "set it up again"
      or "Ask your admin to add it". The role messages ("Ask your admin for
      …") must remain.

## 3. Records

- [x] 3.1 `openspec/config.yaml` milestone 2: add a dated AMENDED 2026-09-30
      note quoting the new message. Its instruction is otherwise unchanged:
      a 401 anywhere surfaces as this message and points at settings. Keep
      the note to a few lines, because the context field has about 2.9 KB of
      headroom left.
- [x] 3.2 `plugin/README.md`:
      - §7: replace the two table rows' quoted messages with the new ones;
      - §3 / §2: the text quoting "Your access has expired or is incorrect."
        becomes the new message;
      - §8: update the quoted 401 message too.

## 4. Check

- [x] 4.1 Add `tests/access-messages.test.ts` with three tests:
      - the builder's two endings;
      - that `EXPIRED_TOKEN_MESSAGE` names no admin;
      - that `reportFailure`, or the smallest exported seam around it,
        reports `'rejected-credential'` as the constant rather than the
        step's message. If `reportFailure` has no seam, test through the
        existing `submit-ordering` pattern with a stubbed 401.
- [x] 4.2 `cd plugin && npm run build && npm test` pass.
- [ ] 4.3 In the running plugin:
      - Paste a token with its last character removed and select Test
        connection. The settings tab and the panel both show the new
        expired message.
      - Connect with a valid token, revoke it in GitLab, then select Submit
        for review. The new expired message is shown, not "Submit didn't go
        through".
      - Select Refresh. The panel shows the same message.
