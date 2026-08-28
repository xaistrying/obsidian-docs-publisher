import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent, TFile } from 'obsidian';
import type { Category } from './categories';
import { CATEGORIES } from './categories';

export interface SubmitModalResult {
	title: string;
	category: Category;
}

/**
 * Collects `title` and `category`, and shows the note's target remote path
 * before anything freezes — the confirmation moment
 * `docs/document-identity.md` §4's vault-mirroring rule makes possible: the
 * note's current vault path IS its target remote path, read once at open
 * per design.md's "read once" lean.
 *
 * `onConfirm` runs only when the author presses Submit, never on close, and
 * only once both fields are non-empty — enforced by disabling the button
 * rather than discovering the gap as a failure after remote calls begin.
 */
export class SubmitModal extends Modal {
	private title = '';
	private category: Category | '' = '';
	private submitButton: ButtonComponent | null = null;

	constructor(
		app: App,
		private readonly file: TFile,
		private readonly onConfirm: (result: SubmitModalResult) => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('docs-publisher-submit-modal');
		contentEl.createEl('h2', { text: 'Submit for review' });

		new Setting(contentEl).setName('Title').addText((text) =>
			text.onChange((value) => {
				this.title = value;
				this.updateSubmitState();
			})
		);

		new Setting(contentEl).setName('Category').addDropdown((dropdown) => {
			// Fixed width, not just anchored right: an unstyled <select> sizes
			// itself to its selected option's text, so the row's right edge
			// would otherwise jump between e.g. "SOP" and "Configuration
			// Reference". See styles.css.
			dropdown.selectEl.addClass('docs-publisher-category-select');
			dropdown.addOption('', 'Choose a category');
			for (const category of CATEGORIES) {
				dropdown.addOption(category, category);
			}
			dropdown.onChange((value) => {
				this.category = value === '' ? '' : (value as Category);
				this.updateSubmitState();
			});
		});

		// Read-only: no component is added, so there is nothing here to edit.
		new Setting(contentEl).setName('Target path').setDesc(this.file.path);

		new Setting(contentEl).addButton((button) => {
			this.submitButton = button;
			button
				.setButtonText('Submit')
				.setCta()
				.setDisabled(true)
				.onClick(() => {
					const title = this.title.trim();
					const category = this.category;
					if (title === '' || category === '') {
						return;
					}

					this.close();
					this.onConfirm({ title, category });
				});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private updateSubmitState(): void {
		this.submitButton?.setDisabled(this.title.trim() === '' || this.category === '');
	}
}
