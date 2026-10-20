## Context

Token failures reach the author in seven places, and each place builds its own
copy:

| Where | Rejected token today | Missing permission today |
|---|---|---|
| Settings tab, `FAILURE_MESSAGES` + `connectionPermissionMessage` (`settings-tab.ts`) | "…Please ask your admin to set it up again." | "…Ask your admin to add it." |
| Panel connection state, `PANEL_FAILURE_MESSAGES` + `connectionPermissionMessage` (`main.ts`) | "…Ask your admin to set it up again." | "…Ask your admin to add it, then check your details in settings." |
| Status refresh (`main.ts`, `refreshPermissionMessage`) | generic `REFRESH_FAILED_MESSAGE` | "…Ask your admin to add it." |
| Import list (`main.ts`, `discoveryPermissionMessage`) | generic `DISCOVERY_REFRESH_FAILED_MESSAGE` | "…Ask your admin to add it." |
| Reset / Restore read (`main.ts`, `resetPermissionMessage`, two sites) | generic `RESET_READ_FAILED_MESSAGE` | "…Ask your admin to add it." |
| Submit, `reportFailure` + `insufficientPermissionMessage` (`submit-document.ts`) | generic step message ("Submit didn't go through…") | "…Ask your admin to add it." |
| `recoveryPermissionMessage` (`main.ts`) | — | no caller; dead |

`platform-config/access-messages.ts` already exists for exactly this. Its
header says copy is "shared rather than written at each surface" so an author
is never "told two different things about the same" situation. It holds the
role messages today.

## Goals / Non-Goals

**Goals:**
- One rejected-token string, used on every surface, including the four that
  currently fall through to a generic message.
- One permission-message builder with the two self-service endings, replacing
  six builders and one dead one.
- Role messages untouched.

**Non-Goals:**
- Warning before expiry, token storage, or any other drift in the blocks this
  change touches. See the proposal's Deferred list.

## Decisions

### 1. Two exports in `access-messages.ts`

```ts
export const EXPIRED_TOKEN_MESSAGE =
	'Your access token has expired or is incorrect. ' +
	'Check you pasted all of it, or create a new one in GitLab.';

export function tokenPermissionMessage(action: string, detail: string | undefined): string
// "Your access token doesn't have permission to ${action} (missing: ${detail}). Create a new access token that includes it."
// "Your access token doesn't have permission to ${action}. Create a new access token with the permissions listed in the plugin's settings."
```

Each site keeps its own `action` phrase:

| Site | `action` |
|---|---|
| Settings tab | "check your connection" |
| Panel connection state | "check your connection" |
| Status refresh | "check your documents' status" |
| Import list | "list the project's documents" |
| Reset / Restore read | "read the version under review" |
| Submit | "submit documents" |

The settings tab's own identity-read fallback currently says "check your
account". It becomes `tokenPermissionMessage('check your account', undefined)`.

**Rejected alternative: a generic `failureMessage(failure, detail, action,
fallback)` that also picks the fallback for every other failure kind.** It
would absorb the non-token branches too, such as content-changed and
empty-repository in `reportFailure`. That widens a copy change into a
control-flow change. Each site adds one `'rejected-credential'` branch in
front of its existing `'insufficient-permission'` branch instead, which is a
smaller diff and easier to read.

**Why the "incorrect" case says "Check you pasted all of it" first:** the
same 401 means expired, revoked, or pasted wrongly. A truncated paste is the
common first-day case, and it is fixed without creating anything. A token
that really has expired is the second clause.

### 2. The rejected-token branch goes before the permission branch at every site

At each of the six sites, `failure === 'rejected-credential'` maps to
`EXPIRED_TOKEN_MESSAGE` ahead of the permission check. In `reportFailure` it
also takes precedence over the step's own `message`, because no step's
message is true for a dead token. "Check your connection and submit again"
is the specific misdirection this fixes.

The panel's connection-state and settings-tab tables keep their
`Record<FailureKind, string>` shape. Only the one entry's value changes, to
the shared constant.

### 3. Vocabulary

Both new endings are author-facing and contain none of branch, commit, merge
request, MR, conflict or main. Permission NAMES inside "(missing: …)" come
from the platform and can include "Merge Request". That is unchanged by this
change and is the same exemption question already raised against the settings
tab's permission list. It stays open for the spec-drift change and is not
decided here.

## Risks / Trade-offs

- **A 401 caused by something other than the token.** For example, a server
  misconfiguration answering 401 for everyone. → The author is told to check
  or recreate their token, which will not help. The same was true of the old
  message, and nothing in the response can tell the two apart.
- **Longer permission messages in a `Notice`.** → Around twenty characters
  longer than today, still one sentence per clause. It is acceptable for a
  message the author must act on.

## Migration Plan

Copy-only. No data or behaviour migrates. Rolling back restores the old
strings.

## Open Questions

None.
