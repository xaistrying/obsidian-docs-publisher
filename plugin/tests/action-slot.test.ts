import { describe, expect, it } from 'vitest';
import { ActionSlot } from '../src/action-slot';

/**
 * The one guard every write action goes through (add-action-busy-states
 * tasks.md 1.2). The two properties that matter: a second start while one
 * runs does nothing, and the slot always comes back — a slot left taken after
 * a throw would leave every write control disabled until reload.
 */
describe('the write-action slot', () => {
	it('refuses a second run while the first is pending', async () => {
		const slot = new ActionSlot();
		let release: () => void = () => {};
		const first = slot.run('reset', 'a.md', () => new Promise<void>((resolve) => (release = resolve)));

		let secondRan = false;
		await slot.run('import', '', async () => {
			secondRan = true;
		});

		expect(secondRan).toBe(false);
		expect(slot.current).toEqual({ action: 'reset', target: 'a.md' });

		release();
		await first;
		expect(slot.current).toBeNull();
	});

	it('is free again after work that throws', async () => {
		const slot = new ActionSlot();

		await expect(
			slot.run('submit', 'a.md', async () => {
				throw new Error('boom');
			})
		).rejects.toThrow('boom');

		expect(slot.current).toBeNull();
		let ran = false;
		await slot.run('submit', 'a.md', async () => {
			ran = true;
		});
		expect(ran).toBe(true);
	});
});
