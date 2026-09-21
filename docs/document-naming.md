# Document naming: what the repository must guarantee, and why

Written for whoever decides the documentation repository's layout and naming
— and for anyone extending this plugin's import or submit paths.

This exists because a filename in this repository is not a label. It is the
document's permanent identity, and two documents that share one cannot both
be published. That is a constraint on the repository, not a preference of the
tool, and it is not obvious from looking at a folder tree.

## 1. The incident this was written from — 2026-09-15

The first "Import all" against `ivan/service.doc.kb` from an empty vault
imported most of the corpus and refused eight files. All eight refusals were
correct. Every one of them is permanent: pressing Import again does nothing,
because nothing about the refusal changes on a retry.

| Refused | Derived ID | Why |
|---|---|---|
| `Products/Barcode-Scanner/README.md` | `README` | taken |
| `Products/Terminal-BFVM/README.md` | `README` | taken |
| `Products/Terminal-BFVM/Known-errors/_placeholder.md` | `_placeholder` | taken |
| `Products/Terminal-BFVM/Reference/_placeholder.md` | `_placeholder` | taken |
| `Products/Terminal-BFVM/Runbooks/_placeholder.md` | `_placeholder` | taken |
| `Products/Terminal-BFVM/SOPs/_placeholder.md` | `_placeholder` | taken |
| `Products/Smart Buddy POS/SOPs/SB-SOP-001_Terminal-Offline (SAMPLE).md` | — | name has a space |
| `Templates/ProjectCode-SOP-NNN_SOP Name.md` | — | name has a space |

Six collisions and two illegal names. Of three `README.md` files one was
imported; of five `_placeholder.md` files one was imported.

**Which one survived was decided by nothing.** The listing is returned in
path order, and the first file to claim an ID keeps it — so
`Products/Back-Office-Administration/README.md` and
`Products/Terminal-BFVM/FAQs/_placeholder.md` won by sorting earlier, not by
being more correct. A different folder name would have produced a different
winner. Nobody chose.

**Parentheses were not the problem.** `SB-SOP-001_Terminal-Offline(SAMPLE).md`
would have been accepted. The space is what refused both files; see §3 for
the exact rule.

## 2. Why a shared filename cannot work

The chain is short and every link is fixed:

```
filename  →  doc_id  →  branch `doc/<doc_id>`  →  one open merge request
```

- A document's `doc_id` is its filename with the extension dropped and
  Vietnamese diacritics ASCII-folded. The folder it sits in is not part of
  it. See `document-identity.md` §3.
- `doc_id` names the branch every revision of that document is pushed to.
- GitLab will not hold two open merge requests from one source branch.

So two documents sharing a filename share a branch, and the second one to be
submitted is rejected by the platform. The plugin refuses at import instead,
which is the same refusal moved earlier — to the point where nothing has been
written and the author can still act.

**The folder does not disambiguate, and deliberately so.** Making `doc_id`
path-derived would fix collisions and break something worse: identity would
become location, so reorganising folders would sever every document from its
own history. `document-identity.md` §4 keeps path and identity separate on
purpose.

## 3. The rules a conforming repository follows

**Every document filename is unique across the entire repository**, not
merely within its folder. This is the rule the incident above broke, and it
is a correctness requirement rather than a style guide: uniqueness is what
makes a document publishable at all.

The corpus already has a convention that satisfies this — control IDs like
`BOA-SOP-001_Update-Device-Details.md` and
`SBT-KE-001_EG95-mTLS-Socket-Reopen-Error200.md`. Every file that follows it
imported without incident. Every file that broke it is a file that does not
follow it.

**A filename must also be usable as a git ref.** The plugin rejects a name
that, after diacritic folding:

- contains whitespace, or any of `~` `^` `:` `?` `*` `[` `\`
- is empty, starts with `.`, or ends with `.lock`

Everything else is accepted, parentheses, `&`, `#` and `_` included. The
practical rule for authors is **no spaces**; the rest almost never comes up.

Vietnamese diacritics are fine and need no thought: `HD-001_Cài-đặt.md`
becomes `HD-001_Cai-dat`. The folding is deterministic, so two names that
differ only in diacritics WILL collide — `Cài-đặt` and `Cai-dat` are one ID.

## 4. Files that are not documents

The plugin offers a file for import when it carries a YAML front matter block,
and excludes it when it does not. That rule is deliberately about content and
never about the filename: a denylist of names would need extending forever and
would hide a real document someone named badly.

The consequence is that a non-document carrying front matter looks exactly
like a document. Three kinds showed up here:

- **`README.md`** — a folder explainer. It does not need front matter. Remove
  the block and it stops being offered.
- **`_placeholder.md`** — scaffolding to keep an empty folder in git. Same
  answer; `.gitkeep` does the job without looking like a document.
- **Templates** — the genuinely hard case, because a template's whole purpose
  is to carry the front matter a document should have. No content rule can
  tell one from a document. Either keep templates out of the repository the
  plugin points at, or accept one row in the list per vault.

## 5. What the plugin enforces, and what it cannot

| | |
|---|---|
| Refuses an import whose ID a vault note already holds | yes, naming the note |
| Refuses an import whose filename cannot be a git ref | yes |
| Refuses a submit whose `doc_id` a second vault note holds | yes |
| Refuses a name that collides with a document NOT in this vault | **no** |
| Renames anything on the platform | **no, ever** |

The gap in the middle row matters for a new repository: two authors working
in separate vaults can each create a document with the same filename, and
neither is told until one of them submits and the platform refuses the second
branch. Nothing the plugin can read locally would catch that. **Uniqueness is
maintained by the naming convention, not by the tool** — which is the reason
this document exists rather than a validation rule somewhere.

The plugin never renames a remote file. Every fix in §1 is a change to the
repository, made by someone with write access, and the plugin's job stops at
refusing clearly and saying what it collided with.
