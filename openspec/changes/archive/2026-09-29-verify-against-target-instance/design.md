## Context

`docs/ce-verification.md` already **is** the design for what to check — 34
items across five sections, each stating what is assumed, where it bites, and
what breaks if the assumption is wrong. This document does not restate them.

What it decides is how to run them so the answers are worth having, because
the same checklist run carelessly produces evidence that does not transfer:

- run as Owner and it cannot tell you whether an L1 can submit;
- run on gitlab.com and it tells you nothing about CE (§0's own rule);
- run with an all-permissions token and it cannot tell you which permissions
  are needed;
- run without recording the instance and the results cannot be trusted later.

The last one has already happened once: §E was run on 2026-09-14 and §0's
edition and version fields are still blank, so even that run's findings carry
an asterisk.

## Goals / Non-Goals

**Goals:**

- Know whether an L1/L2 author on the real instance can create, submit,
  revise, reset, restore and import a document.
- Know the minimum token permissions to tell them to tick.
- Leave `docs/ce-verification.md` describing reality, so the next person
  inherits answers rather than the same doubts.

**Non-Goals:**

- Building anything. Code changes here are contingent on a failure.
- Milestone 8, milestone 3a, packaging.
- Verifying gitlab.com again. It is already known and is not the target.

## Decisions

### 1. Two accounts, and the Developer one is the subject

The run needs a Maintainer to set up and observe (create the project state,
merge, leave review threads) and a **Developer** to be the author under test.
Every check that represents an author's own action — §D end to end, and every
§A permission probe — runs on the Developer account.

The Maintainer account is scaffolding: it merges what the Developer submits
(§D1's published state, §D8's revision path), leaves the unresolved thread
§C and §D2 need, and reads what the Developer cannot.

REJECTED: running everything as Maintainer and reasoning about what a
Developer would have hit. That is precisely the substitution §0 forbids, and
it is how the two already-recorded mistakes were made.

### 2. The token is narrowed until it breaks, not granted and trusted

Start from the smallest plausible set, run §A2's six operations, and add only
what GitLab's refusals name. `docs/access-tokens.md` §1 is explicit that no
endpoint reports a token's permissions, so a refusal is the only instrument
available.

Two things make this worth the effort rather than a tidy-up:

- It doubles as the §A3–A8 probes. Those items exist to learn which permission
  each call demands, and narrowing a token is how you find out.
- The result is author-facing. Onboarding currently says "use the fine-grained
  flow" and names no checkboxes, because nobody knew which ones. The output
  here is that list.

Order matters: narrow BEFORE §D. An end-to-end run on a too-broad token proves
the flow works for someone, not for the person who will use it.

### 3. Record as you go, into the file, not into a change's tasks

`docs/ce-verification.md` says results go there rather than into a change's
tasks, and this change obeys its own reference doc. `tasks.md` tracks whether
an item has been RUN; the file records what it SAID.

A contradicted assumption gets the observed status, body and field values —
not "it differed". The two mistakes this file opens with were both cheap to
fix once someone wrote down the actual response, and expensive while the note
said only that something was wrong.

### 4. A failure stops the section, not the run

Items are mostly independent. A §B item that fails tells you a parse is wrong;
it does not invalidate §C. Run everything runnable, collect every failure, and
decide what to fix once — rather than fixing the first failure and re-running
into the second.

The exception is §A: if the token cannot perform §A2's six operations at all,
§§B–D cannot run and the permission question is the finding.

### 5. What counts as "fix it here" versus "give it a milestone"

Fix inside this change: a wrong permission classification, a response field
parsed under the wrong name, a message that names the wrong remedy, onboarding
copy. These are small, local, and leaving them would ship a known-wrong
message to a non-technical user.

Give it a milestone: anything that changes a write path, a data shape, or a
panel surface. A verification pass that quietly becomes a feature change stops
being reviewable, and the point of this one is to establish facts.

## Risks / Trade-offs

**A Developer account may not exist yet on the target project** → Then
creating one is the first task, and its absence is itself worth knowing before
release day.

**Narrowing the token is fiddly and may take several passes** → Accepted; it
is the same work §A3–A8 already ask for, and it produces the onboarding list
that does not otherwise exist.

**§D8 and §D9 need documents in specific states** (published, under review,
not accepted, edited-since-submit) → Set up with the Maintainer account first.
§D8 already spells out the matrix.

**The run may surface something large** → Then it gets a milestone and the
release waits. That is the outcome this change exists to make possible, not a
failure of it.

## Open Questions

- Whether a second account is available on the target instance, or whether
  "Maintainer" and "Developer" have to be the same person switching tokens.
  The latter works for everything except §C's unresolved-thread setup, which
  needs a comment from someone other than the author to be realistic.
- Whether token expiry can be exercised at all without waiting for a real
  expiry — a revoked token produces a 401 too, and is the practical substitute
  if a short-expiry token cannot be minted.
