import { ButtonComponent, ItemView, setIcon } from 'obsidian';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import type { ActionSlot, WriteAction } from '../action-slot';
import { AUTHOR_MESSAGES, AUTHOR_TEMPLATES } from '../author-messages';
import type { ProjectAddress } from '../git-publishing/project-address';
import type { SetupStateHolder } from '../platform-config/setup-state';
import { awaitingFirstCheck, buildSetupView } from '../platform-config/setup-view';
import type { SetupControlId, SetupView } from '../platform-config/setup-view';
import type { DocumentState } from '../submission-tracking/derive-state';
import type { DerivedStatesHolder } from '../submission-tracking/derived-states';
import type { NoteIdentities } from '../submission-tracking/note-identities';
import {
	bannerKind,
	buildPanelModel,
	initialsOf,
	needsYouEmpty,
	projectChangeLabel,
	projectChanges,
	refreshNotice,
	sectionSuffix,
	stateLabel,
	submitLabel,
	updatesLine,
	waitingUpdates,
} from './panel-model';
import type { BannerKind, ListedNote, PanelModel, PanelRow } from './panel-model';
import { listCandidateNotes } from './vault-documents';

export const VIEW_TYPE = 'docs-publisher-view';

/** Which collapsible sections the author has collapsed, by key. "Waiting on reviewers" and "Not sent yet" open collapsed. */
const WAITING_SECTION_KEY = 'waiting';
const NOT_SENT_SECTION_KEY = 'not-sent';
const FROM_PROJECT_SECTION_KEY = 'from-project';
const CHANGES_SECTION_KEY = 'changes';

/** The banner's icon for each of its four conditions. */
const BANNER_ICONS: Record<BannerKind, string> = {
	latest: 'check-circle-2',
	waiting: 'download',
	failed: 'alert-triangle',
	unchecked: 'refresh-cw',
};

/** Files "From the project" names before saying "and N more": the first update after connecting is the whole project. */
const FROM_PROJECT_LIMIT = 50;

/** One marker beside a row's name: its words, and the extra class that colours it. */
interface Badge {
	text: string;
	cls: string;
}

/** What one row of a list shows, whichever list it is in. */
interface ChangeRow {
	name: string;
	folder: string;
	path: string;
	badges: Badge[];
	/** The document's state, which names the send control; null for a note never sent. */
	state: DocumentState | null;
	link: string | null;
	/** Whether the row offers the send control whether or not it is the open note. */
	canSubmit: boolean;
	/** The open note's row above the groups: the only one that offers Reset. */
	head?: boolean;
}

/** What one draw reads from the vault, once, so every part of the screen agrees. */
interface VaultReading {
	notes: ListedNote[];
	files: TFile[];
	vaultPaths: ReadonlySet<string>;
	model: PanelModel;
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

function folderOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

/** What the view needs, handed in so the controls and the command palette are the same paths. */
export interface PanelDeps {
	setup: SetupStateHolder;
	pressSetup: (id: SetupControlId) => void;
	/** One of setup's explicit triggers: facts are read now, and never from a render. */
	refreshSetup: () => void;
	states: DerivedStatesHolder;
	identities: NoteIdentities;
	writeAction: ActionSlot;
	address: () => ProjectAddress | null;
	/** The single refresh path. Opening the view and pressing Refresh both come through it. */
	refresh: (asked: boolean) => void;
	newDocument: () => void;
	submitForReview: () => void;
	/** Submits a note from a row, through the same path as the open note's control. */
	submitNote: (file: TFile) => void;
	/** Starts the update described by vault-sync, through the same path as the command palette. */
	getUpdates: () => void;
	/** Null until Reset is rebuilt on git; the control is not offered without it. */
	resetDocument: ((file: TFile) => void) | null;
}

/**
 * The sidebar: setup progress until setup is complete, then the ready screen
 * (replace-rest-with-local-git-ssh tasks 1.10 and 2.6).
 *
 * Draws from state it already holds. It redraws on every note switch and every
 * front-matter change, so nothing here may start a process or reach the
 * network: refreshing is the view opening and the Refresh control, and nothing
 * else. What is shown is decided in `panel-model.ts` and the setup view-model,
 * which are tested; this class only places it.
 */
export class DocsPublisherView extends ItemView {
	private readonly collapsed = new Set<string>([WAITING_SECTION_KEY, NOT_SENT_SECTION_KEY, FROM_PROJECT_SECTION_KEY]);
	// The pending `setTimeout` id for a scheduled-but-not-yet-run render.
	private renderTimer: number | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: PanelDeps
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return AUTHOR_MESSAGES.pluginName;
	}

	getIcon(): string {
		return 'git-branch';
	}

	async onOpen(): Promise<void> {
		// Teardown goes through the view's own component lifecycle, so a change
		// that arrives after the view closes cannot render into a detached
		// container.
		for (const holder of [this.deps.setup, this.deps.states, this.deps.identities, this.deps.writeAction]) {
			this.register(holder.onChange(() => this.scheduleRender()));
		}

		// Clicking a button in this view while it is not the active leaf makes
		// Obsidian activate the leaf on `mousedown`, tens of milliseconds before
		// `click`. The rebuild that used to follow tore out the very button being
		// pressed. This view's own leaf becoming active changes nothing it
		// displays, so that one transition is skipped rather than raced.
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (leaf !== this.leaf) {
					this.scheduleRender();
				}
			})
		);
		this.registerEvent(this.app.workspace.on('file-open', () => this.scheduleRender()));
		this.registerEvent(this.app.metadataCache.on('changed', () => this.scheduleRender()));
		this.registerEvent(this.app.vault.on('modify', () => this.scheduleRender()));
		// A note that is renamed, moved, added or deleted changes which notes are
		// not on the project, but fires no `modify` and no metadata change, so the
		// list stayed as it was until the panel was closed and opened. Registered
		// once the workspace is ready: while a vault loads, Obsidian reports a
		// `create` for every file in it, and each would queue a rebuild.
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on('rename', () => this.scheduleRender()));
			this.registerEvent(this.app.vault.on('create', () => this.scheduleRender()));
			this.registerEvent(this.app.vault.on('delete', () => this.scheduleRender()));
		});

		this.render();
		// The two explicit triggers: setup is read, and the states are refreshed.
		this.deps.refreshSetup();
		this.deps.refresh(false);
	}

	async onClose(): Promise<void> {
		if (this.renderTimer !== null) {
			window.clearTimeout(this.renderTimer);
			this.renderTimer = null;
		}
	}

	/** Folds same-burst render requests into one rebuild. Not a defence against rebuilding mid-click; see `onOpen`. */
	private scheduleRender(): void {
		if (this.renderTimer !== null) {
			return;
		}
		this.renderTimer = window.setTimeout(() => {
			this.renderTimer = null;
			this.render();
		}, 0);
	}

	private render(): void {
		const container = this.contentEl;
		container.empty();
		// The styles measure this element, not the window: a side panel is as wide
		// as the author drags it, and the layout follows that width.
		container.addClass('docs-publisher-root');

		const setup = this.deps.setup.current;
		if (awaitingFirstCheck(setup)) {
			// Nothing is known yet, and the empty facts would say git is missing.
			container.createEl('p', { text: AUTHOR_MESSAGES.checkingSetup, cls: 'setting-item-description' });
			return;
		}
		const view = buildSetupView(setup, this.deps.writeAction.current);
		if (view !== null) {
			this.renderSetup(container, view);
			return;
		}
		this.renderReady(container, setup.facts.username);
	}

	/** The first screen until setup is complete: the first step not done, what it needs, and its controls. */
	private renderSetup(container: HTMLElement, view: SetupView): void {
		container.createEl('h4', { text: view.title });
		container.createEl('p', { text: view.progress, cls: 'setting-item-description' });
		container.createEl('h5', { text: view.step.heading });
		container.createEl('p', { text: view.step.text });
		if (view.notice !== null) {
			container.createEl('p', { text: view.notice, cls: 'setting-item-description' });
		}

		const actions = container.createDiv({ cls: 'docs-publisher-actions' });
		view.step.controls.forEach((control, index) => {
			const button = new ButtonComponent(actions)
				.setButtonText(control.label)
				.setDisabled(control.disabled)
				.onClick(() => {
					this.deps.pressSetup(control.id);
				});
			// The first control is the one thing most likely to be pressed next.
			if (index === 0) {
				button.setCta();
			}
		});
	}

	private renderReady(container: HTMLElement, username: string | null): void {
		// Top to bottom: the toolbar (who is connected, and the three things that act
		// on the whole project or start a note); the open note, when no row shows it;
		// then the groups: Changes, New, Waiting on reviewers, From the project.
		const reading = this.readVault();
		// Until something has been derived no note can be told from any other: a
		// note with an older identity property would be listed with no status and
		// the open note would get a row of its own, both wrong a moment later. So
		// until then the panel shows the toolbar and says it is checking, and lists
		// nothing. A failed check is not this: it is shown as it is.
		const settling = this.deps.states.current === null && this.deps.states.lastOutcome.kind !== 'failed';
		this.renderToolbar(container, reading, username, settling);
		if (settling) {
			return;
		}
		this.renderOpenNote(container, reading.model);
		this.renderChanges(container, reading);
		this.renderNew(container, reading.model);
		this.renderWaiting(container, reading.model.waiting);
		this.renderFromProject(container, reading);
	}

	/**
	 * The top of the panel: who is connected, a banner saying what the project
	 * has, and the actions that start a note or act on the whole project: New
	 * document, which is the one thing most often wanted, then Get updates and
	 * Refresh as icons with tooltips. Get updates is marked, not made primary,
	 * while something is waiting, so the two never compete for the eye.
	 */
	private renderToolbar(container: HTMLElement, reading: VaultReading, username: string | null, settling: boolean): void {
		const outcome = this.deps.states.lastOutcome;
		const waiting = waitingUpdates(this.deps.states.current, reading.vaultPaths, this.deps.identities.identified(reading.files));

		const named = username !== null && username !== '';
		const header = container.createDiv({ cls: 'docs-publisher-header' });
		header.createDiv({
			cls: 'docs-publisher-avatar',
			text: named ? initialsOf(username) : '?',
			attr: { 'aria-label': named ? AUTHOR_TEMPLATES.connectedAs(username) : AUTHOR_MESSAGES.setupReady },
		});
		const who = header.createDiv({ cls: 'docs-publisher-who' });
		who.createDiv({ cls: 'docs-publisher-who-name', text: named ? username : AUTHOR_MESSAGES.pluginName });
		who.createDiv({ cls: 'docs-publisher-who-status', text: AUTHOR_MESSAGES.connectedShort });

		const kind = bannerKind(waiting, outcome);
		const banner = container.createDiv({ cls: `docs-publisher-banner is-${kind}` });
		setIcon(banner.createSpan({ cls: 'docs-publisher-banner-icon' }), BANNER_ICONS[kind]);
		banner.createSpan({ text: settling ? AUTHOR_MESSAGES.checkingDocuments : (refreshNotice(outcome) ?? updatesLine(waiting, outcome)) });

		const actions = container.createDiv({ cls: 'docs-publisher-toolbar' });
		const create = actions.createEl('button', { cls: 'mod-cta docs-publisher-new' });
		setIcon(create.createSpan({ cls: 'docs-publisher-button-icon' }), 'plus');
		create.createSpan({ text: AUTHOR_MESSAGES.tipNewDocument });
		create.addEventListener('click', () => {
			this.deps.newDocument();
		});

		const getUpdates = new ButtonComponent(actions)
			.setIcon('download')
			.setTooltip(AUTHOR_MESSAGES.tipGetUpdates)
			.onClick(() => {
				this.deps.getUpdates();
			});
		getUpdates.buttonEl.createSpan({ cls: 'docs-publisher-button-label', text: AUTHOR_MESSAGES.getUpdates });
		if (kind === 'waiting') {
			getUpdates.buttonEl.addClass('is-attention');
		}
		this.showWriteBusy(getUpdates, 'update', '', true);

		const checking = outcome.kind === 'refreshing';
		const refresh = new ButtonComponent(actions)
			.setIcon('refresh-cw')
			.setTooltip(checking ? AUTHOR_MESSAGES.busyChecking : AUTHOR_MESSAGES.tipRefresh)
			.onClick(() => {
				this.deps.refresh(true);
			});
		refresh.buttonEl.createSpan({ cls: 'docs-publisher-button-label', text: AUTHOR_MESSAGES.refresh });
		if (checking) {
			refresh.setDisabled(true);
		}

		container.createDiv({ cls: 'docs-publisher-divider' });
	}

	/**
	 * The vault's notes, their content identifiers as last computed (and asked for
	 * where missing), and the model drawn from them. Opens no file: identifiers come
	 * from the cache, which reads in the background and redraws when it has more.
	 */
	private readVault(): VaultReading {
		const candidates = listCandidateNotes(this.app);
		const files = candidates.map((candidate) => candidate.file);
		this.deps.identities.retain(new Set(files.map((file) => file.path)));
		void this.deps.identities.ensure(files);
		const notes: ListedNote[] = candidates.map((candidate) => ({
			name: candidate.file.basename,
			folder: folderOf(candidate.file.path),
			path: candidate.file.path,
			blob: this.deps.identities.get(candidate.file),
			legacyDocId: candidate.legacyDocId,
		}));
		const vaultPaths = new Set(this.app.vault.getFiles().map((file) => file.path));
		const model = buildPanelModel(notes, this.deps.states, this.deps.address(), vaultPaths);
		return { notes, files, vaultPaths, model };
	}

	/**
	 * The open note, always, above the groups: its status and the controls for it,
	 * whether it was sent, published, moved or never sent, and whether or not the
	 * group that lists it is folded. One place for "this note", so it does not
	 * depend on which group the note happens to be in. Reset is offered here and
	 * nowhere else.
	 */
	private renderOpenNote(container: HTMLElement, model: PanelModel): void {
		const file = this.app.workspace.getActiveFile();
		if (file === null || file.extension !== 'md') {
			return;
		}
		const listed = model.needsYou.find((row) => row.path === file.path) ?? model.waiting.find((row) => row.path === file.path);
		const match = model.resolutions.get(file.path);
		const document = match === undefined ? null : this.deps.states.statusFor(match.docId);
		const state = document === null ? null : document.state;

		const base: ChangeRow =
			listed !== undefined
				? this.changeRowFor(listed, true)
				: {
						name: file.basename,
						folder: folderOf(file.path),
						path: file.path,
						badges: state === null ? [] : [{ text: stateLabel(state), cls: `status-${state}` }],
						state,
						link: null,
						canSubmit: true,
					};
		// Every note has a status line here, so the card is the same height for all of
		// them and the groups below do not move when the author opens another note.
		const badges = base.badges.length > 0 ? base.badges : [{ text: AUTHOR_MESSAGES.notSentStatus, cls: 'status-new' }];
		const list = container.createEl('ul', { cls: 'docs-publisher-document-list docs-publisher-open-note' });
		this.renderChangeRow(list, { ...base, badges, canSubmit: true, head: true });
	}

	/**
	 * A group's heading: a chevron, the title and its count as a pill. The heading
	 * is a toggle that remembers its state for this session. What a group holds is
	 * a tooltip, not a paragraph: it is true and rarely needed, and as text it
	 * pushed the lists down the panel. Returns whether the body is to be drawn.
	 */
	private renderGroupHeading(container: HTMLElement, group: { key: string; heading: string; tooltip: string; count: string }): boolean {
		const header = container.createDiv({ cls: 'docs-publisher-documents-header' });
		const expanded = !this.collapsed.has(group.key);
		const toggle = header.createDiv({ cls: 'docs-publisher-section-toggle' });
		setIcon(toggle.createSpan({ cls: 'docs-publisher-chevron' }), expanded ? 'chevron-down' : 'chevron-right');
		const title = toggle.createEl('h4', { text: group.heading });
		title.setAttribute('aria-label', group.tooltip);
		toggle.createSpan({ cls: 'docs-publisher-section-count', text: group.count });
		toggle.addEventListener('click', () => {
			if (expanded) {
				this.collapsed.add(group.key);
			} else {
				this.collapsed.delete(group.key);
			}
			this.render();
		});
		return expanded;
	}

	/**
	 * Changes: documents the author has sent and must now act on: edited since,
	 * moved, or not accepted. Open until the author folds it, because it is the
	 * list that asks something of them; the notes never sent are a group of
	 * their own below.
	 */
	private renderChanges(container: HTMLElement, reading: VaultReading): void {
		const { model } = reading;
		const section = container.createDiv({ cls: 'docs-publisher-documents' });
		const open = this.renderGroupHeading(section, {
			key: CHANGES_SECTION_KEY,
			heading: AUTHOR_MESSAGES.needsYouHeading,
			tooltip: AUTHOR_MESSAGES.needsYouDescription,
			count: sectionSuffix(this.deps.states.lastOutcome.kind, model.needsYou.length),
		});
		if (!open) {
			return;
		}

		if (model.needsYou.length === 0) {
			section.createEl('p', { text: needsYouEmpty(model), cls: 'setting-item-description' });
			return;
		}
		const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
		for (const row of model.needsYou) {
			this.renderChangeRow(list, this.changeRowFor(row, true));
		}
	}

	/**
	 * New: every note that is not on the project, each with a send button, the way
	 * git lists new files. Folded, with its count, since a vault can hold hundreds
	 * and they are the part of it that is not a document yet. Before anything has
	 * been derived it says so and lists nothing, because "not on the project"
	 * cannot be told yet.
	 */
	private renderNew(container: HTMLElement, model: PanelModel): void {
		const known = this.deps.states.current !== null;
		const section = container.createDiv({ cls: 'docs-publisher-documents' });
		const open = this.renderGroupHeading(section, {
			key: NOT_SENT_SECTION_KEY,
			heading: AUTHOR_MESSAGES.newNoteBadge,
			tooltip: AUTHOR_MESSAGES.notSentDescription,
			count: known ? sectionSuffix(this.deps.states.lastOutcome.kind, model.notSent.length) : AUTHOR_MESSAGES.notDerivedYet,
		});
		if (!open || !known) {
			return;
		}
		if (model.notSent.length === 0) {
			section.createEl('p', { text: AUTHOR_MESSAGES.nothingNotSent, cls: 'setting-item-description' });
			return;
		}
		const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
		for (const row of model.notSent) {
			this.renderChangeRow(list, {
				name: row.name,
				folder: row.folder,
				path: row.path,
				badges: [],
				state: null,
				link: null,
				canSubmit: true,
			});
		}
	}

	/** "Waiting on reviewers": present even at zero, and reporting a failed check beside its heading while folded. */
	private renderWaiting(container: HTMLElement, rows: readonly PanelRow[]): void {
		const section = container.createDiv({ cls: 'docs-publisher-documents' });
		const open = this.renderGroupHeading(section, {
			key: WAITING_SECTION_KEY,
			heading: AUTHOR_MESSAGES.waitingHeading,
			tooltip: AUTHOR_MESSAGES.waitingDescription,
			count: sectionSuffix(this.deps.states.lastOutcome.kind, rows.length),
		});
		if (!open) {
			return;
		}
		if (rows.length === 0) {
			section.createEl('p', { text: AUTHOR_MESSAGES.nothingWaiting, cls: 'setting-item-description' });
			return;
		}
		const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
		for (const row of rows) {
			this.renderChangeRow(list, this.changeRowFor(row, false));
		}
	}

	/**
	 * From the project: the files Get updates would act on, by name, so "3 updates
	 * available" is something the author can look at. Folded, with its count, and
	 * capped, because the first update after connecting is the whole project.
	 */
	private renderFromProject(container: HTMLElement, reading: VaultReading): void {
		const rows = projectChanges(this.deps.states.current, reading.vaultPaths, this.deps.identities.identified(reading.files));
		const section = container.createDiv({ cls: 'docs-publisher-documents' });
		const open = this.renderGroupHeading(section, {
			key: FROM_PROJECT_SECTION_KEY,
			heading: AUTHOR_MESSAGES.fromProjectHeading,
			tooltip: AUTHOR_MESSAGES.fromProjectDescription,
			count: rows === null ? AUTHOR_MESSAGES.notDerivedYet : sectionSuffix(this.deps.states.lastOutcome.kind, rows.length),
		});
		if (!open || rows === null) {
			return;
		}
		if (rows.length === 0) {
			section.createEl('p', { text: AUTHOR_MESSAGES.nothingFromProject, cls: 'setting-item-description' });
			return;
		}
		const list = section.createEl('ul', { cls: 'docs-publisher-document-list' });
		for (const row of rows.slice(0, FROM_PROJECT_LIMIT)) {
			const item = list.createEl('li', { cls: 'docs-publisher-document' });
			item.createSpan({ cls: 'docs-publisher-document-name', text: baseName(row.path), attr: { 'aria-label': row.path } });
			const meta = item.createDiv({ cls: 'docs-publisher-row-meta' });
			meta.createSpan({ cls: `docs-publisher-status status-${row.kind}`, text: projectChangeLabel(row.kind) });
			if (folderOf(row.path) !== '') {
				meta.createSpan({ cls: 'docs-publisher-document-folder', text: folderOf(row.path) });
			}
		}
		if (rows.length > FROM_PROJECT_LIMIT) {
			section.createEl('p', { text: AUTHOR_TEMPLATES.andMore(rows.length - FROM_PROJECT_LIMIT), cls: 'setting-item-description' });
		}
	}

	/** What a listed document's row shows: its state, its markers, and the actions that make sense for it. */
	private changeRowFor(row: PanelRow, canSubmit: boolean): ChangeRow {
		const badges: Badge[] = [];
		if (row.state !== null) {
			badges.push({ text: stateLabel(row.state), cls: `status-${row.state}` });
		}
		if (row.moved) {
			badges.push({ text: AUTHOR_MESSAGES.movedMarker, cls: 'status-moved' });
		}
		if (row.edited) {
			badges.push({ text: AUTHOR_MESSAGES.editedMarker, cls: 'status-edited' });
		}
		return { name: row.name, folder: folderOf(row.path), path: row.path, badges, state: row.state, link: row.link, canSubmit };
	}

	/**
	 * One row, on one line: the name, its folder muted after it, its markers, and
	 * icon buttons at the right. The row of the note that is open is marked, and
	 * only that row offers Reset (design: never a destructive control on a row the
	 * author is not looking at) and, whatever list it is in, the send control.
	 */
	private renderChangeRow(list: HTMLElement, row: ChangeRow): void {
		const active = this.app.workspace.getActiveFile()?.path === row.path;
		const head = row.head === true;
		const item = list.createEl('li', { cls: head ? 'docs-publisher-document is-active' : active ? 'docs-publisher-document is-current' : 'docs-publisher-document' });
		// Two lines: the name with its buttons, then what it is and where it lives,
		// muted. One line could not hold a name, "Waiting for review" and three
		// buttons in a panel this narrow without squeezing the name to nothing.
		item.createSpan({ cls: 'docs-publisher-document-name', text: row.name, attr: { 'aria-label': row.path } });
		const actions = item.createSpan({ cls: 'docs-publisher-row-actions' });
		const meta = item.createDiv({ cls: 'docs-publisher-row-meta' });
		for (const badge of row.badges) {
			meta.createSpan({ cls: `docs-publisher-status ${badge.cls}`.trim(), text: badge.text });
		}
		if (row.folder !== '') {
			meta.createSpan({ cls: 'docs-publisher-document-folder', text: row.folder });
		}

		if (row.canSubmit || head) {
			const submit = new ButtonComponent(actions)
				.setIcon('upload')
				.setTooltip(submitLabel(row.state))
				.onClick(() => {
					const file = this.app.vault.getFileByPath(row.path);
					if (file !== null) {
						this.deps.submitNote(file);
					}
				});
			if (head) {
				submit.setCta();
			}
			this.showWriteBusy(submit, 'submit', row.path, true);
		}
		// Reset destroys local work, so it is offered on the note being looked at
		// and never on a row the author is not on.
		const reset = this.deps.resetDocument;
		if (reset !== null && head && row.state === 'pending') {
			const button = new ButtonComponent(actions)
				.setIcon('undo-2')
				.setTooltip(AUTHOR_MESSAGES.tipReset)
				.setWarning()
				.onClick(() => {
					const file = this.app.vault.getFileByPath(row.path);
					if (file !== null) {
						reset(file);
					}
				});
			this.showWriteBusy(button, 'reset', row.path, true);
		}
		if (row.link !== null) {
			const link = actions.createEl('a', {
				cls: 'docs-publisher-document-link clickable-icon',
				href: row.link,
				attr: { 'aria-label': AUTHOR_MESSAGES.openInGitLab },
			});
			setIcon(link, 'external-link');
			link.setAttr('target', '_blank');
			link.setAttr('rel', 'noopener noreferrer');
		}
	}

	/**
	 * A write control while one of the actions runs: the busy label and disabled
	 * when it is THIS action on THIS target, disabled alone otherwise, untouched
	 * when nothing runs. Disabling is courtesy only — `ActionSlot.run` is what
	 * refuses a press that lands before this redraw.
	 */
	private showWriteBusy(button: ButtonComponent, action: WriteAction, target: string, iconOnly = false): void {
		const running = this.deps.writeAction.current;
		if (running === null) {
			return;
		}
		button.setDisabled(true);
		if (running.action === action && running.target === target) {
			// An icon button has no words to replace: its tooltip says what it is doing.
			if (iconOnly) {
				button.setTooltip(BUSY_LABELS[action]);
			} else {
				button.setButtonText(BUSY_LABELS[action]);
			}
		}
	}
}

/** What each write control says while its own action runs. Reset borrows "Checking…": until it is confirmed, nothing has been reset. */
const BUSY_LABELS: Record<WriteAction, string> = {
	submit: AUTHOR_MESSAGES.busySending,
	reset: AUTHOR_MESSAGES.busyChecking,
	restore: AUTHOR_MESSAGES.busyChecking,
	import: AUTHOR_MESSAGES.busyChecking,
	update: AUTHOR_MESSAGES.busyGettingUpdates,
	connect: AUTHOR_MESSAGES.busyConnecting,
	test: AUTHOR_MESSAGES.busyTesting,
	createKey: AUTHOR_MESSAGES.busyCreating,
};
