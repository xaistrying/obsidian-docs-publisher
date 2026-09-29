import { describe, expect, it } from 'vitest';
import { DocumentStatusHolder } from '../src/submission-tracking/document-status';
import type { ResolvedDocument } from '../src/submission-tracking/reconcile';

/**
 * A refresh that FAILS keeps the states a previous refresh resolved.
 *
 * `docs/ce-verification.md` §D6, third check. The author is better off with a
 * stale answer about the same project, told plainly that it may have moved on,
 * than with a list that empties itself the moment a token is narrowed.
 *
 * WHY THIS IS A UNIT TEST AND NOT A CLICK-THROUGH. Three attempts to observe it
 * in the running plugin all failed, and the third showed why: editing the token
 * in the settings tab fires `discardResult()`, which sets the connection
 * `unverified`, which clears the held states BEFORE any refresh runs. That
 * clearing is correct and deliberate — editing connection details used to leave
 * another project's documents listed with live actions beside them — but it
 * makes the settings tab the wrong instrument for this measurement. Swapping
 * tokens there can never show the property, whether or not it holds.
 *
 * So the property is pinned here instead, where the only thing that happens
 * between the two refreshes is the failure itself. What a manual run adds on
 * top is that the panel RENDERS what the holder kept, which follows from
 * `renderDocumentRow` gating its label on `statusFor(docId) !== null`.
 */

function resolved(docId: string, state: 'pending' | 'changes-requested' | 'published'): ResolvedDocument {
	return { docId, submission: { state, mrIid: 1, webUrl: null } };
}

describe('what a failed refresh does to states already resolved', () => {
	it('keeps them', () => {
		const holder = new DocumentStatusHolder();
		holder.recordSuccess([resolved('test-004', 'changes-requested')]);

		holder.recordFailure('insufficient-permission', 'Merge Request: Read');

		expect(holder.statusFor('test-004')?.submission?.state).toBe('changes-requested');
	});

	it('says the refresh failed, and carries the permission that refused it', () => {
		const holder = new DocumentStatusHolder();
		holder.recordSuccess([resolved('test-004', 'changes-requested')]);

		holder.recordFailure('insufficient-permission', 'Merge Request: Read');

		// Both halves matter: keeping a stale answer is only defensible while
		// the author is told it may have moved on.
		expect(holder.lastOutcome).toEqual({
			kind: 'failed',
			failure: 'insufficient-permission',
			detail: 'Merge Request: Read',
		});
	});

	it('keeps every document, not only the one that was looked at', () => {
		const holder = new DocumentStatusHolder();
		holder.recordSuccess([
			resolved('test-004', 'changes-requested'),
			resolved('test-008', 'changes-requested'),
			resolved('test-002', 'published'),
		]);

		holder.recordFailure('not-reachable');

		expect(holder.statusFor('test-004')).not.toBeNull();
		expect(holder.statusFor('test-008')).not.toBeNull();
		expect(holder.statusFor('test-002')).not.toBeNull();
	});

	it('survives more than one consecutive failure', () => {
		const holder = new DocumentStatusHolder();
		holder.recordSuccess([resolved('test-004', 'pending')]);

		holder.recordFailure('server-unreachable');
		holder.recordFailure('insufficient-permission', 'Merge Request: Read');

		// A token narrowed for an afternoon is several failed refreshes, not
		// one, and the states must not erode across them.
		expect(holder.statusFor('test-004')?.submission?.state).toBe('pending');
	});

	it('replaces them wholesale when a refresh SUCCEEDS, since the remote decided all of it', () => {
		const holder = new DocumentStatusHolder();
		holder.recordSuccess([resolved('test-004', 'changes-requested'), resolved('test-008', 'pending')]);

		holder.recordSuccess([resolved('test-004', 'published')]);

		expect(holder.statusFor('test-004')?.submission?.state).toBe('published');
		// Gone rather than carried: a document absent from a successful
		// listing is absent, and keeping it would assert a state nothing
		// established.
		expect(holder.statusFor('test-008')).toBeNull();
	});

	it('DROPS them when the connection details change, which a failure is not', () => {
		const holder = new DocumentStatusHolder();
		holder.recordSuccess([resolved('test-004', 'changes-requested')]);

		holder.clear();

		// The distinction this whole test file turns on. A failed refresh asks
		// the same project and gets no answer; `clear()` is the panel being
		// pointed somewhere else, where what is held describes nothing.
		expect(holder.statusFor('test-004')).toBeNull();
		expect(holder.lastOutcome).toEqual({ kind: 'never' });
	});
});
