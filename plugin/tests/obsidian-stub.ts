/**
 * The `obsidian` module, as much of it as the tests touch and no more.
 *
 * Every source module imports `obsidian` at runtime — `Notice`, `Modal`,
 * `Setting` — and that module does not exist outside the Obsidian
 * application, so without this alias nothing here is importable in a test
 * process at all. That is the whole of this file's job.
 *
 * IT IS NOT A REIMPLEMENTATION OF OBSIDIAN AND MUST NOT GROW INTO ONE
 * (design.md decision 5). Anything a test needs to control belongs in a fake
 * the test builds and hands to the code under test, not in a richer stub
 * here: a stub that starts modelling the vault becomes a second, unverified
 * Obsidian that the tests then pass against while the real one behaves
 * differently.
 */

/** Obsidian's own path normalization, to the extent anything here relies on it. */
export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Enough of `Notice` to be constructed without an Obsidian window. */
export class Notice {
	constructor(
		public readonly message: string | DocumentFragment,
		public readonly duration?: number
	) {}

	hide(): void {
		// Nothing to hide; there is no DOM here.
	}
}

/** Enough of `Modal` for the modules that subclass it to be imported. */
export class Modal {
	contentEl: unknown = null;
	titleEl: unknown = null;

	constructor(public readonly app: unknown) {}

	open(): void {
		// A test that wants to drive a modal should call its callback directly.
	}

	close(): void {
		// Nothing is open.
	}

	onOpen(): void {
		// Overridden by subclasses.
	}

	onClose(): void {
		// Overridden by subclasses.
	}
}

/** Enough of `Setting` for the modules that construct one to be imported. */
export class Setting {
	constructor(public readonly containerEl: unknown) {}

	setName(): this {
		return this;
	}

	setDesc(): this {
		return this;
	}

	addText(): this {
		return this;
	}

	addDropdown(): this {
		return this;
	}

	addButton(): this {
		return this;
	}
}
