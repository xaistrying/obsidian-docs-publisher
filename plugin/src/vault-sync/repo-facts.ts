import { readIdentity } from '../git-publishing/git-config';
import { parseProjectAddress } from '../git-publishing/project-address';
import type { ProjectAddress } from '../git-publishing/project-address';
import { CONNECTED_REF } from '../git-publishing/ref-names';
import { inspectRepo, readRef } from '../git-publishing/repo';
import type { RepoContext } from '../git-publishing/repo';
import type { SetupRepoFacts } from '../platform-config/setup-controller';

/**
 * What setup needs to know that only the vault's repository can say: whether it
 * is connected, to what, and who the author is
 * (replace-rest-with-local-git-ssh tasks 2.3 and 2.7).
 *
 * Local only — every answer comes from files and local commands, never from
 * the network — because setup reads these on every refresh.
 */
export function createRepoFacts(deps: {
	context: () => RepoContext;
	savedAddress: () => ProjectAddress | null;
}): SetupRepoFacts {
	/** The origin of the vault's own repository, when connecting has been done. */
	const connectedOrigin = async (): Promise<ProjectAddress | null> => {
		const ctx = deps.context();
		const report = await inspectRepo(ctx);
		if (!report.ok || !report.value.present || !report.value.topLevelIsVault || report.value.origin === null) {
			return null;
		}
		const connected = await readRef(ctx, CONNECTED_REF);
		if (!connected.ok || connected.value === null) {
			return null;
		}
		return parseProjectAddress(report.value.origin);
	};

	return {
		connectedAddress: connectedOrigin,
		vaultConnected: async () => {
			const origin = await connectedOrigin();
			const saved = deps.savedAddress();
			return origin !== null && saved !== null && origin.sshUrl === saved.sshUrl;
		},
		identity: async () => {
			const identity = await readIdentity(deps.context());
			if (!identity.ok || identity.value.name === null || identity.value.email === null) {
				return null;
			}
			const { name, email } = identity.value;
			if (name.value.trim() === '' || email.value.trim() === '') {
				return null;
			}
			const scope = name.scope === email.scope ? name.scope : 'other';
			return { name: name.value, email: email.value, scope };
		},
	};
}
