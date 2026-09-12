import { Modal, Setting } from 'obsidian';
import type { App, ButtonComponent, TFile } from 'obsidian';
import type { Category } from './categories';
import { CATEGORIES } from './categories';

export interface SubmitModalResult {
	title: string;
	category: Category;
}

/**
 * Shows the note's target remote path before anything freezes — the
 * confirmation moment `docs/document-identity.md` §4's vault-mirroring rule
 * makes possible: the note's current vault path IS its target remote path,
 * read once at open per design.md's "read once" lean.
 *
 * TWO SHAPES, and which one opens is not a style choice. On a FIRST submit
 * the modal COLLECTS `title` and `category`, because that is the one moment
 * the plugin is permitted to write them. On a resubmit it DISPLAYS the two
 * the note already carries, read-only, because from the first submit onward
 * they are "by hand, by the author... with the plugin never writing again"
 * (`openspec/config.yaml`'s front matter contract). Re-collecting them would
 * invite an edit the plugin would then have to write back, which is exactly
 * the repeat write the contract forbids — and, until 2026-09-12, exactly
 * what happened.
 *
 * `onConfirm` runs only when the author presses Submit, never on close. On
 * the collecting shape it runs only once both fields are non-empty, enforced
 * by disabling the button rather than discovering the gap as a failure after
 * remote calls begin; on the confirming shape both are known good already,
 * having been validated before this opened.
 */
export class SubmitModal extends Modal {
	private title = '';
	private category: Category | '' = '';
	private submitButton: ButtonComponent | null = null;

	constructor(
		app: App,
		private readonly file: TFile,
		private readonly onConfirm: (result: SubmitModalResult) => void,
		/**
		 * The values the note already carries. Present ONLY on a resubmit, and
		 * its presence is what selects the read-only shape — there is no
		 * separate mode flag to keep in step with it.
		 */
		private readonly existing?: SubmitModalResult
	) {
		super(app);
		if (existing !== undefined) {
			this.title = existing.title;
			this.category = existing.category;
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('docs-publisher-submit-modal');
		contentEl.createEl('h2', { text: 'Submit for review' });

		if (this.existing === undefined) {
			this.renderFields(contentEl);
		} else {
			// Rendered the same way 'Target path' below always has been: a
			// Setting with a name and a description and no component, so there
			// is nothing here to edit.
			new Setting(contentEl).setName('Title').setDesc(this.existing.title);
			new Setting(contentEl).setName('Category').setDesc(this.existing.category);
		}

		new Setting(contentEl).setName('Target path').setDesc(this.file.path);

		new Setting(contentEl).addButton((button) => {
			this.submitButton = button;
			button
				.setButtonText('Submit')
				.setCta()
				.setDisabled(this.existing === undefined)
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

	/** The collecting shape's two editable rows — a first submit only. */
	private renderFields(contentEl: HTMLElement): void {
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
	}

	private updateSubmitState(): void {
		this.submitButton?.setDisabled(this.title.trim() === '' || this.category === '');
	}
}
