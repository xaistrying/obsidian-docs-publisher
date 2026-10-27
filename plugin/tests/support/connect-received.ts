import { advanceSynced, readRef } from '../../src/git-publishing/repo';
import type { RepoContext } from '../../src/git-publishing/repo';
import type { ProjectAddress } from '../../src/git-publishing/project-address';
import { fetchedDefaultRef } from '../../src/git-publishing/ref-names';
import { connectVault } from '../../src/vault-sync/connect';

/**
 * Connects, and then does what the first update would have done: records the
 * project as received. Most tests are about what happens to documents a vault
 * already has; connecting alone leaves the base empty, which is the right state
 * for a vault that has downloaded nothing and the wrong one for them.
 */
export async function connectReceived(ctx: RepoContext, address: ProjectAddress, branch = 'main'): Promise<void> {
	const result = await connectVault(ctx, address);
	if (!result.ok) {
		throw new Error(`could not connect: ${JSON.stringify(result)}`);
	}
	const tip = await readRef(ctx, fetchedDefaultRef(branch));
	if (tip.ok && tip.value !== null) {
		await advanceSynced(ctx, tip.value);
	}
}
