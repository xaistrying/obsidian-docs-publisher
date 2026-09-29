#!/usr/bin/env python3
"""
Probes every endpoint plugin/src/git-publishing/gitlab-client.ts calls, and
prints what came back, so section A of docs/ce-verification.md can be run in
one pass instead of ~25 hand-written curls.

It answers section A (which permission each call demands) by being run
repeatedly against a token you narrow between runs: the refusal body names
what to tick. It answers the parts of B/C/E that are readable from a response
-- and, for B2 and B10, it reimplements the client's own parse and reports
whether that parse WOULD have worked, which is the actual question those
items ask.

It does not answer section D. Those are end-to-end checks in the running
plugin.

  export GITLAB_TOKEN=...              # or it prompts, hidden
  python3 probe.py --selftest          # check the parse reimplementations
  python3 probe.py                     # reads only
  python3 probe.py --writes            # + commits, an MR, a branch delete

Stdlib only. The token is never placed on a command line, never logged, and
never printed back. TLS verification is never disabled: this sends a real
token on every request, and an unverified connection hands it to whoever is
in the middle. An instance behind an internal CA needs that CA trusted --
`export SSL_CERT_FILE=/path/to/ca.pem` -- not the check turned off.
"""

import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# A 1x1 transparent PNG, for B11: binary content through base64, read back and
# compared byte for byte.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
    "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)

HOST = ""
SECRET = ""


def call(method, path, item, body=None, raw=False):
    """One request. Returns (status, parsed_or_bytes). Prints a result line."""
    url = HOST + "/api/v4" + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("PRIVATE-TOKEN", SECRET)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            status, payload, headers = response.status, response.read(), response.headers
    except urllib.error.HTTPError as err:
        status, payload, headers = err.code, err.read(), err.headers
    except Exception as err:  # DNS, TLS, refused connection
        print("  [%s] %s %s\n      NETWORK FAILURE: %s" % (item, method, path, err))
        return None, None

    print("  [%s] %s %s %s" % (item, status, method, path))
    # B6 asks what `per_page` CE actually HONOURS, which a short listing cannot
    # show -- 3 entries look the same whether the cap is 100 or 20. GitLab
    # answers it directly in the pagination headers, so the item needs no
    # hundred-merge-request fixture: X-Per-Page is the effective page size, and
    # X-Total against X-Total-Pages says whether the loop would have paged.
    if headers.get("X-Per-Page"):
        # Tagged for B6 only where the PLUGIN asks for 100. Elsewhere this is
        # GitLab's own default (20) on an endpoint the plugin never paginates,
        # and reading that as "CE caps at 20" would answer B6 wrongly.
        print("      pagination: per-page=%s page=%s total=%s pages=%s next=%r%s" % (
            headers.get("X-Per-Page"), headers.get("X-Page"), headers.get("X-Total"),
            headers.get("X-Total-Pages"), headers.get("X-Next-Page"),
            "  (B6)" if "per_page=100" in path else "  (not a B6 reading -- the plugin does not page this)",
        ))
    if not 200 <= status < 300:
        text = payload.decode("utf-8", "replace").strip()
        print("      body: %s" % text[:400])
        # post()/del() consult isContentChanged BEFORE classifyScopedStatus, so
        # a 400 the guard recognizes never reaches the status table. Reporting
        # the table's answer alone would libel the client as classifying a
        # concurrent edit `unexpected` when it does not.
        stale = is_content_changed(payload)
        print("      plugin would classify: %s%s" % (
            "content-changed" if stale else classify(status),
            "  (the last_commit_id guard, matched on the body)" if stale else "",
        ))
        detail = extract_permission_detail(payload)
        # B2 is one of the two assumptions already known to have been wrong
        # once, and this line is that item's whole answer -- but only for a
        # refusal that NAMES a permission. A plain "404 Branch Not Found" has
        # no name to extract and is not evidence either way, so it says
        # nothing rather than crying wolf on every 404.
        names_one = b"granular" in payload or b"permission" in payload.lower()
        if detail:
            print("      permission name the plugin would SHOW: %r" % detail)
        elif names_one:
            print(
                "      permission name the plugin would SHOW: NONE"
                "  <-- B2 CONTRADICTED: the body names a permission the parse missed"
            )
        if status == 400:
            print("      isContentChanged() would fire: %s" % is_content_changed(payload))
        return status, None

    if raw:
        return status, payload
    try:
        return status, json.loads(payload)
    except ValueError:
        return status, payload.decode("utf-8", "replace")


def classify(status):
    """classifyScopedStatus, gitlab-client.ts."""
    return {
        401: "rejected-credential",
        403: "insufficient-permission",
        404: "not-reachable",
    }.get(status, "unexpected")


def extract_permission_detail(payload):
    """extractPermissionDetail, gitlab-client.ts -- same order, same regexes."""
    try:
        body = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    text = next(
        (v for v in (body.get("error_description"), body.get("message")) if isinstance(v, str)),
        None,
    )
    if text is None:
        return None
    bracketed = re.search(r"\[([^\]]+)\]", text)
    if bracketed:
        return bracketed.group(1)
    named = re.search(r"insufficient_granular_scope\W+([a-z][a-z0-9_]*)", text, re.I)
    return named.group(1) if named else None


def is_content_changed(payload):
    """isContentChanged, gitlab-client.ts -- the 400-body prose match."""
    try:
        body = json.loads(payload)
    except ValueError:
        return False
    message = body.get("message") if isinstance(body, dict) else None
    return isinstance(message, str) and "changed since you started editing it" in message



def mr_facts(base, iid):
    """
    The facts §D8 asks you to read off a merge request by eye, printed.

    D8's checks are assertions about the REMOTE after a plugin action, not
    about the plugin's own surface: same review or a second one, one more
    commit or not, the file updated or created. Every one of those is a field
    on an API response, so reading them here removes the eye-strain half of
    the check while leaving the half that matters -- pressing the button in
    Obsidian and watching what the plugin does -- exactly where it was.
    """
    _, mr = call("GET", "%s/merge_requests/%s" % (base, iid), "facts/mr")
    if not isinstance(mr, dict):
        return
    print("      iid=%s state=%r source_branch=%r" % (mr.get("iid"), mr.get("state"), mr.get("source_branch")))
    print("      draft=%s merge_status=%r" % (mr.get("draft"), mr.get("merge_status")))

    _, commits = call("GET", "%s/merge_requests/%s/commits" % (base, iid), "facts/commits")
    if isinstance(commits, list):
        print("      commits=%d  (D8: a revision adds one and opens no second review)" % len(commits))
        for c in commits[:5]:
            print("        %s %s" % (str(c.get("short_id")), str(c.get("title"))[:60]))

    _, changes = call("GET", "%s/merge_requests/%s/changes" % (base, iid), "facts/changes")
    entries = (changes or {}).get("changes") if isinstance(changes, dict) else None
    if isinstance(entries, list):
        print("      changed files=%d" % len(entries))
        for ch in entries:
            # new_file is B3's whole question: a resubmit of a PUBLISHED
            # document must UPDATE the file, not create it. A `new_file: true`
            # here is docs/resubmission-lifecycle.md section 2's bug returning.
            # "created" is CORRECT on a first submit and WRONG on a resubmit
            # of a published document, so this states the fact and says when
            # it is the bug rather than shouting on every first submit.
            verb = "created" if ch.get("new_file") else ("deleted" if ch.get("deleted_file") else "updated")
            # The verb tracks whether the file is already on the default
            # branch, not whether this is a first submit -- established by
            # D8's four rows on 2026-09-28.
            note = "   (right unless the file is already on the default branch -- D8/B3)" if ch.get("new_file") else ""
            print("        %-7s %s%s" % (verb, ch.get("new_path"), note))

    _, discussions = call("GET", "%s/merge_requests/%s/discussions?per_page=100" % (base, iid), "facts/discussions")
    if isinstance(discussions, list):
        notes = [n for d in discussions for n in (d.get("notes") or [])]
        unresolved = [n for n in notes if n.get("resolvable") and not n.get("resolved")]
        print("      discussions=%d resolvable=%d unresolved=%d  -> plugin would say %r" % (
            len(discussions),
            len([n for n in notes if n.get("resolvable")]),
            len(unresolved),
            "changes requested" if unresolved else "waiting for review",
        ))


def leave_thread(base, iid):
    """
    A resolvable diff-line comment, created published rather than as a draft.

    Doing this in the UI means starting a review and remembering to submit it;
    a pending review leaves ZERO discussions and reads exactly like nobody
    having commented (section B5's trap, which cost a round trip on
    2026-09-27). Posting it here cannot be left pending.
    """
    _, versions = call("GET", "%s/merge_requests/%s/versions" % (base, iid), "scaffold/versions")
    if not isinstance(versions, list) or not versions:
        print("      no diff versions -- cannot place a line comment")
        return
    v = versions[0]
    _, changes = call("GET", "%s/merge_requests/%s/changes" % (base, iid), "scaffold/changes")
    entries = (changes or {}).get("changes") if isinstance(changes, dict) else None
    if not entries:
        print("      no changed files -- cannot place a line comment")
        return
    path = entries[0].get("new_path")
    call("POST", "%s/merge_requests/%s/discussions" % (base, iid), "scaffold/comment", body={
        "body": "probe: please change this (verification run)",
        "position": {
            "base_sha": v.get("base_commit_sha"),
            "start_sha": v.get("start_commit_sha"),
            "head_sha": v.get("head_commit_sha"),
            "position_type": "text",
            "new_path": path,
            "old_path": path,
            "new_line": 1,
        },
    })


def resolve_threads(base, iid):
    _, discussions = call("GET", "%s/merge_requests/%s/discussions?per_page=100" % (base, iid), "scaffold/list")
    if not isinstance(discussions, list):
        return
    for d in discussions:
        if any(n.get("resolvable") for n in (d.get("notes") or [])):
            call("PUT", "%s/merge_requests/%s/discussions/%s?resolved=true" % (base, iid, d.get("id")),
                 "scaffold/resolve")



def compare_file(base, local_path, remote_path, ref):
    """
    Is the local file byte-identical to what the remote holds at `ref`?

    Two checks want exactly this and neither could be answered by looking:
    section D9's "Reset restores exactly", where the note must match its
    branch INCLUDING front matter, and section E6's image, where a wrong
    answer renders as a broken embed rather than as an error. Reading a
    properties panel shows fields; this shows bytes.
    """
    try:
        with open(local_path, "rb") as handle:
            local = handle.read()
    except OSError as err:
        print("      cannot read local file: %s" % err)
        return

    _, remote = call(
        "GET",
        "%s/repository/files/%s/raw?ref=%s"
        % (base, urllib.parse.quote(remote_path, safe=""), urllib.parse.quote(ref)),
        "compare/remote",
        raw=True,
    )
    if remote is None:
        return

    print("      local : %6d bytes  sha256=%s" % (len(local), hashlib.sha256(local).hexdigest()[:16]))
    print("      remote: %6d bytes  sha256=%s" % (len(remote), hashlib.sha256(remote).hexdigest()[:16]))
    if local == remote:
        print("      *** BYTE-IDENTICAL ***")
        return
    print("      *** THEY DIFFER ***")
    if len(local) != len(remote):
        print("      lengths differ by %d bytes" % (len(local) - len(remote)))
    # Text files are the interesting case -- a reset that re-serialized front
    # matter differs in ways a field-by-field reading cannot see, which is
    # precisely what D9 was unable to rule out by eye.
    try:
        import difflib

        diff = list(difflib.unified_diff(
            remote.decode("utf-8").splitlines(), local.decode("utf-8").splitlines(),
            fromfile="remote", tofile="local", lineterm="", n=1,
        ))
        if diff:
            print("      first differing lines (remote -> local):")
            for line in diff[:20]:
                print("        %s" % line)
    except (UnicodeDecodeError, ImportError):
        print("      binary, or not decodable as UTF-8 -- compare by hash above")


def section(title):
    print("\n== %s" % title)


def selftest():
    """
    The three functions above are reimplementations of the client's own
    parses, and the probe's verdicts are only worth anything if they still
    agree with it. Checked against the bodies actually observed on
    gitlab.com and recorded in docs/ce-verification.md.
    """
    granular = json.dumps(
        {
            "error": "insufficient_granular_scope",
            "error_description": "Access denied: This operation requires a fine-grained personal "
            "access token with the following project permissions: [Merge Request: Read].",
        }
    ).encode()
    assert extract_permission_detail(granular) == "Merge Request: Read"

    # error_description wins over message -- the ordering that was the fix.
    both = json.dumps({"message": "[Wrong: One]", "error_description": "[Right: Two]"}).encode()
    assert extract_permission_detail(both) == "Right: Two"

    # The identifier fallback, and the backtracking bug it was written around.
    bare = json.dumps({"message": "insufficient_granular_scope: read_merge_request"}).encode()
    assert extract_permission_detail(bare) == "read_merge_request"

    assert extract_permission_detail(b"not json at all") is None
    assert extract_permission_detail(json.dumps({"message": "plain refusal"}).encode()) is None

    stale = json.dumps({"message": "The file has changed since you started editing it: a/b.md"}).encode()
    assert is_content_changed(stale)
    assert not is_content_changed(json.dumps({"message": "Branch already exists"}).encode())
    assert not is_content_changed(b"<html>502</html>")

    assert classify(401) == "rejected-credential"
    assert classify(403) == "insufficient-permission"
    assert classify(404) == "not-reachable"
    assert classify(400) == "unexpected"

    print("selftest ok -- the parses still match gitlab-client.ts")


def main():
    global HOST, SECRET, CTX
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--host", default=os.environ.get("GITLAB_HOST", "https://gitlab.com"))
    parser.add_argument("--project", default=os.environ.get("GITLAB_PROJECT", "styl-group1/kb-docs"))
    parser.add_argument("--file", help="markdown path for the file reads (default: first the tree lists)")
    parser.add_argument("--mr", type=int, help="merge request iid for the discussions/changes reads")
    parser.add_argument("--writes", action="store_true", help="also probe commits, MR creation, branch delete")
    parser.add_argument("--selftest", action="store_true", help="check the parse reimplementations, then exit")
    # Scaffolding and assertions, not plugin behaviour. Everything below sets
    # GitLab up, or reads back what a plugin action did to it. None of it
    # presses a button in Obsidian: automating that would test this script
    # instead of the plugin, which is the thing under test.
    parser.add_argument("--facts", type=int, metavar="IID",
                        help="print the merge-request facts D8 asks you to read by eye, then exit")
    parser.add_argument("--comment", type=int, metavar="IID",
                        help="leave a PUBLISHED resolvable diff-line thread (never a draft), then exit")
    parser.add_argument("--resolve", type=int, metavar="IID",
                        help="resolve every resolvable thread, then exit")
    parser.add_argument("--merge", type=int, metavar="IID", help="merge it, then exit")
    parser.add_argument("--close", type=int, metavar="IID", help="close it without merging, then exit")
    parser.add_argument("--compare", nargs=2, metavar=("LOCAL", "REMOTE"),
                        help="byte-compare a local file against the remote's copy, then exit "
                             "(settles D9's 'restores exactly' and E6's image)")
    parser.add_argument("--ref", default=None, metavar="REF",
                        help="branch for --compare (default: the project's default branch)")
    args = parser.parse_args()

    if args.selftest:
        return selftest()

    HOST = args.host.rstrip("/")
    SECRET = os.environ.get("GITLAB_TOKEN") or getpass.getpass("GitLab token (hidden): ")
    project = urllib.parse.quote(args.project, safe="")
    base = "/projects/%s" % project

    print("probing %s -- project %s -- %s" % (HOST, args.project, time.strftime("%Y-%m-%d %H:%M")))
    # Which token is this? `export GITLAB_TOKEN=...` outlives the shell command
    # that set it, so creating a NEW token in the web UI changes nothing here
    # until the variable is re-exported -- and two runs then look identical for
    # a reason that has nothing to do with the instance. Eight hex characters
    # of a SHA-256 distinguish one token from another and reverse to nothing.
    print("token fingerprint: %s (from %s)" % (
        hashlib.sha256(SECRET.encode()).hexdigest()[:8],
        "$GITLAB_TOKEN" if os.environ.get("GITLAB_TOKEN") else "the prompt",
    ))
    print("paste this whole output back; it contains no token")

    # One-shot modes. Each does its one job and stops, so a scaffolding step
    # never drags the whole read pass along behind it.
    if args.facts is not None:
        section("facts for merge request !%d" % args.facts)
        return mr_facts(base, args.facts)
    if args.comment is not None:
        section("leaving a resolvable thread on !%d" % args.comment)
        leave_thread(base, args.comment)
        return mr_facts(base, args.comment)
    if args.resolve is not None:
        section("resolving threads on !%d" % args.resolve)
        resolve_threads(base, args.resolve)
        return mr_facts(base, args.resolve)
    if args.merge is not None:
        section("merging !%d" % args.merge)
        # May be refused: Merge Request: Merge is NOT one of section A2.10's
        # eight, because the plugin never merges. A 403 here names it and is
        # an answer to A2's operation 6 rather than a failure of this script.
        call("PUT", "%s/merge_requests/%s/merge" % (base, args.merge), "scaffold/merge", body={})
        return mr_facts(base, args.merge)
    if args.compare is not None:
        section("comparing %s against %s" % (args.compare[0], args.compare[1]))
        ref = args.ref
        if ref is None:
            _, project_body = call("GET", base, "compare/default-branch")
            ref = (project_body or {}).get("default_branch") or "main"
            print("      ref=%r (the project's default branch)" % ref)
        return compare_file(base, args.compare[0], args.compare[1], ref)
    if args.close is not None:
        section("closing !%d without merging" % args.close)
        call("PUT", "%s/merge_requests/%s?state_event=close" % (base, args.close), "scaffold/close", body={})
        return mr_facts(base, args.close)

    # --- section 0: which instance is this, actually ---------------------
    section("0  instance identity")
    _, version = call("GET", "/version", "0/version")
    if version:
        print("      version=%r revision=%r" % (version.get("version"), version.get("revision")))
    status, _ = call("GET", "/license", "0/edition")
    # Heuristic, not proof: CE has no license endpoint at all, EE has one that
    # refuses a non-admin. Help -> Version is still the item's real answer, and
    # a call that never completed tells you nothing either way.
    if status is None:
        tell = "UNKNOWN -- the call did not complete"
    elif status == 404:
        tell = "CE (no /license endpoint)"
    else:
        tell = "EE-ish (a /license endpoint exists)"
    print("      edition tell: %s" % tell)

    # --- section A: identity and role ------------------------------------
    section("A  identity, role, project")
    _, me = call("GET", "/user", "A2/user")
    if me:
        print("      username=%r id=%s" % (me.get("username"), me.get("id")))
    _, project_body = call("GET", base, "A2/project")
    default_branch = None
    if project_body:
        default_branch = project_body.get("default_branch")
        permissions = project_body.get("permissions") or {}
        levels = [(permissions.get(k) or {}).get("access_level") for k in ("project_access", "group_access")]
        print("      default_branch=%r access_levels=%s" % (default_branch, levels))
        print("      (30=Developer, 40=Maintainer -- docs/gitlab-roles.md)")
    ref = default_branch or "main"
    quoted_ref = urllib.parse.quote(ref)

    # --- E4/E5: the tree read --------------------------------------------
    section("E4/E5  repository tree")
    _, tree = call(
        "GET",
        "%s/repository/tree?ref=%s&recursive=true&per_page=100&page=1" % (base, quoted_ref),
        "E5/tree",
    )
    markdown = args.file
    if isinstance(tree, list):
        print("      entries=%d first=%s" % (len(tree), tree[0] if tree else None))
        if markdown is None:
            markdown = next(
                (e["path"] for e in tree if e.get("type") == "blob" and e["path"].endswith(".md")),
                None,
            )
        print("      file used for the reads below: %r" % markdown)

    # --- A5/A6/A8, B1/B7/B8, E7: branches and files ----------------------
    section("A5/A6/A8 B1/B7/B8 E7  branch and file reads")
    call("GET", "%s/repository/branches/%s" % (base, urllib.parse.quote(ref, safe="")), "A5/branch-read")
    # B1: a missing branch must answer 404 with a recognizable body.
    call("GET", "%s/repository/branches/does-not-exist-probe" % base, "B1/branch-404")
    if markdown:
        path = urllib.parse.quote(markdown, safe="")
        _, text = call(
            "GET", "%s/repository/files/%s/raw?ref=%s" % (base, path, quoted_ref), "A6/file-raw", raw=True
        )
        if text is not None:
            print("      raw bytes=%d starts=%r" % (len(text), text[:60]))
        _, meta = call("GET", "%s/repository/files/%s?ref=%s" % (base, path, quoted_ref), "A8/file-json")
        if meta:
            print("      last_commit_id=%r  (B8)" % meta.get("last_commit_id"))
            print("      encoding=%r content present=%s  (E7)" % (meta.get("encoding"), "content" in meta))
        # B7: a missing file must answer 404, not 200-with-empty.
        call(
            "GET",
            "%s/repository/files/no-such-file-probe.md/raw?ref=%s" % (base, quoted_ref),
            "B7/file-404",
        )

    # --- A3/A4/A7, B3-B6, C1: merge requests -----------------------------
    section("A3/A4/A7 B3-B6 C1  merge requests")
    _, merge_requests = call(
        "GET",
        "%s/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=100&page=1" % base,
        "A3/mr-list",
    )
    iid = args.mr
    if isinstance(merge_requests, list):
        print("      entries=%d  (B6: fewer than 100 here means the loop stops on this page)" % len(merge_requests))
        states = sorted({m.get("state") for m in merge_requests})
        print("      states seen=%s  (B4 fails on anything outside opened/closed/merged/locked)" % states)
        if merge_requests:
            entry = merge_requests[0]
            required = ["iid", "state", "source_branch"]
            degrading = ["web_url", "user_notes_count"]
            print("      required present=%s  (B3 -- a missing one fails every refresh)"
                  % {k: k in entry for k in required})
            print("      degrading present=%s  (B3)" % {k: k in entry for k in degrading})
            print("      blocking_discussions_resolved present=%s  (C1)"
                  % ("blocking_discussions_resolved" in entry))
            iid = iid or entry.get("iid")
    if iid:
        _, discussions = call(
            "GET", "%s/merge_requests/%s/discussions?per_page=100&page=1" % (base, iid), "A4/discussions"
        )
        if isinstance(discussions, list):
            notes = [n for d in discussions for n in (d.get("notes") or [])]
            print("      discussions=%d notes=%d" % (len(discussions), len(notes)))
            keys = sorted({k for n in notes for k in ("resolvable", "resolved") if k in n})
            print("      note keys seen=%s  (B5 -- both must appear on resolvable notes)" % keys)
            print("      unresolved by the plugin's rule: %s"
                  % any(n.get("resolvable") and not n.get("resolved") for n in notes))
            # An empty discussions list is ambiguous, and the ambiguity cost a
            # round trip on 2026-09-27: it reads as "nobody has commented"
            # when it can equally mean "somebody commented and never clicked
            # Submit review". A pending review's notes live on a separate
            # endpoint and are invisible to /discussions until published, so
            # ask that endpoint before concluding the merge request is quiet.
            # Nothing in the plugin calls this -- it is here to stop a draft
            # review being mistaken for a B5 failure.
            if not discussions:
                _, drafts = call(
                    "GET", "%s/merge_requests/%s/draft_notes" % (base, iid), "diagnostic/draft-notes"
                )
                if isinstance(drafts, list) and drafts:
                    print("      *** %d UNPUBLISHED draft note(s). Someone commented and did not"
                          % len(drafts))
                    print("          submit the review, so no discussion exists yet. B5 cannot be")
                    print("          read until it is published: Your review -> Submit review.")

        # A7: never observed, and possibly deprecated on newer versions.
        call("GET", "%s/merge_requests/%s/changes" % (base, iid), "A7/mr-changes")
    else:
        print("      no merge request to read -- pass --mr IID")

    if not args.writes:
        print("\nreads done. rerun with --writes for A2's write half (B9/B10/B11).")
        return

    # --- writes ----------------------------------------------------------
    section("A2/A5/A8 B9/B10/B11  writes")
    branch = "probe/ce-verification-%d" % int(time.time())
    doc = "%s/probe.md" % branch
    image = "%s/probe.png" % branch
    quoted_branch = urllib.parse.quote(branch)
    print("      branch=%s" % branch)

    # A5: the plugin creates branches through the commits API's start_branch,
    # never through the branches API.
    status, _ = call(
        "POST",
        "%s/repository/commits" % base,
        "A5/commit-create",
        body={
            "branch": branch,
            "start_branch": ref,
            "commit_message": "probe: create",
            "actions": [{"action": "create", "file_path": doc, "content": "probe\n"}],
        },
    )
    if status is None or not 200 <= status < 300:
        # The commit was refused, so nothing exists to commit against and the
        # B9/B10/B11 probes cannot run. The remaining WRITE PERMISSIONS can
        # still be named, though, and without writing anything: this instance
        # evaluates permission BEFORE existence (see the branch-read 403 on a
        # branch that does not exist), so aiming these at deliberately absent
        # targets returns the same 403 and the same permission name that a real
        # attempt would. On a token that DOES hold them, they fail harmlessly
        # on the missing branch instead.
        print("      commit refused -- naming the remaining write permissions instead.")
        call("POST", "%s/merge_requests" % base, "A3/mr-create-perm", body={
            "source_branch": "does-not-exist-probe",
            "target_branch": ref,
            "title": "probe: permission check only",
        })
        call(
            "DELETE",
            "%s/repository/branches/does-not-exist-probe" % base,
            "A5/branch-delete-perm",
        )
        return

    _, meta = call(
        "GET",
        "%s/repository/files/%s?ref=%s" % (base, urllib.parse.quote(doc, safe=""), quoted_branch),
        "A8/read-back",
    )
    last_commit_id = (meta or {}).get("last_commit_id")

    # B9 + B11: several actions, mixed verbs, base64 binary, per-action
    # last_commit_id. Confirmed on gitlab.com only.
    call(
        "POST",
        "%s/repository/commits" % base,
        "B9+B11/multi-action",
        body={
            "branch": branch,
            "commit_message": "probe: mixed actions",
            "actions": [
                {"action": "update", "file_path": doc, "content": "probe v2\n", "last_commit_id": last_commit_id},
                {
                    "action": "create",
                    "file_path": image,
                    "content": base64.b64encode(PNG).decode(),
                    "encoding": "base64",
                },
            ],
        },
    )
    _, back = call(
        "GET",
        "%s/repository/files/%s/raw?ref=%s" % (base, urllib.parse.quote(image, safe=""), quoted_branch),
        "B11/binary-read-back",
        raw=True,
    )
    if back is not None:
        print("      binary round-trip byte-identical: %s  (B11)" % (back == PNG))

    # B10: a STALE last_commit_id on a LATER action must be REFUSED, not
    # ignored. An instance that ignores it silently overwrites a reviewer.
    status, _ = call(
        "POST",
        "%s/repository/commits" % base,
        "B10/stale-last-commit-id",
        body={
            "branch": branch,
            "commit_message": "probe: stale guard",
            "actions": [
                {"action": "create", "file_path": "%s/other.md" % branch, "content": "x\n"},
                {"action": "update", "file_path": doc, "content": "probe v3\n", "last_commit_id": last_commit_id},
            ],
        },
    )
    print(
        "      B10 verdict: %s"
        % (
            "REFUSED -- the guard holds"
            if status and status >= 400
            else "ACCEPTED -- B10 CONTRADICTED, the guard is ignored and a reviewer's edit can be overwritten"
        )
    )

    _, merge_request = call(
        "POST",
        "%s/merge_requests" % base,
        "A3/mr-create",
        body={"source_branch": branch, "target_branch": ref, "title": "probe: %s" % branch},
    )
    new_iid = (merge_request or {}).get("iid")

    call(
        "DELETE",
        "%s/repository/branches/%s" % (base, urllib.parse.quote(branch, safe="")),
        "A5/branch-delete",
    )

    print(
        "\nCLEAN UP BY HAND: close merge request !%s in the web UI." % new_iid
        if new_iid
        else "\nno merge request was created."
    )


if __name__ == "__main__":
    sys.exit(main())
