/**
 * Every string an author reads that this change introduces, in one place.
 *
 * One module, not one per capability, so that a single test can read all of it
 * and fail on a banned word (`tests/author-messages.test.ts`). The vocabulary
 * ban — no *branch, commit, merge request, MR, conflict* or *main* in anything
 * an author sees — is only as strong as the weakest string, and a string
 * written inline at its call site is invisible to a scan of this file.
 * Callers import a constant or call a function here; they do not build a
 * message.
 *
 * The texts are the ones quoted in the specs of
 * `replace-rest-with-local-git-ssh`. They are not reworded here: a spec
 * scenario and the string a test asserts on are meant to be the same words.
 *
 * Strings that predate this change still live beside the code that shows them
 * and move here as that code is rewritten or deleted (task 5.1).
 */

const GITLAB = 'GitLab';

export const SETUP_STEP_COUNT = 5;

export const AUTHOR_MESSAGES = {
	// --- setup: why a step failed, and what to do (platform-config) ---
	gitMissing: "Git isn't installed on this computer. Install it, then check again.",
	sshMissing: "Docs Publisher couldn't find SSH on this computer. Reinstalling Git usually fixes this.",
	keyRejected: `${GITLAB} doesn't recognise this key yet. Add it on ${GITLAB}'s SSH keys page, then test again.`,
	keyProtected:
		"This key is protected by a password, which Docs Publisher can't type for you. Create a new key for Docs Publisher.",
	keyUnreadable:
		"Docs Publisher can't read this key, so it can't use it. Create a new key for Docs Publisher instead.",
	keyExists:
		"There is already a file named docs-publisher_ed25519 in your .ssh folder that Docs Publisher can't use. Rename or move it, then press Create key again.",
	addressRewritten:
		'A setting on this computer sends this address somewhere else, so Docs Publisher stopped. Ask whoever set up Git on this computer to remove it.',
	hostChanged: `${GITLAB}'s identity has changed since you last connected. Ask your admin before continuing.`,
	serverUnreachable: `Could not reach ${GITLAB} at that address. Check the address and your connection, then try again.`,
	projectNotFound:
		'That project could not be found, or your access does not include it. Check the address in settings.',
	emptyProject: 'That project has nothing in it yet. Ask your admin to add a first file.',
	setupUnexpected: 'The check did not succeed. Check your setup and try again.',
	addressHint: `Paste the SSH address from ${GITLAB}'s Clone button — it starts with git@ or ssh://.`,
	addressInvalid: `That address isn't one Docs Publisher can use. Paste the SSH address from ${GITLAB}'s Clone button — it starts with git@ or ssh://.`,
	identityMissing: "Tell us your name and email in the plugin's settings first.",
	notReady: 'Finish the setup steps in the Docs Publisher panel first.',
	checkingSetup: 'Checking your setup…',
	stillChecking: 'Docs Publisher is still checking your setup. Try again in a moment.',
	keyIntro: `A key lets ${GITLAB} recognise this computer. It stays on this computer.`,
	keyWorksNoName: 'Your key works.',
	usernamePrompt: 'Type your GitLab username so new documents can name you as their owner.',
	remembered:
		'Your project address and the location of your key are remembered. Docs Publisher never stores a password.',
	keyCopied: `Your key was copied. Paste it on ${GITLAB}'s SSH keys page.`,
	usernameInvalid: `That isn't a ${GITLAB} username. Use the name that follows the @ on your ${GITLAB} profile.`,
	identityReadonly: 'You can change these once this vault is connected.',
	identityInvalid: 'Type your name, and an email address such as name@example.com.',
	identitySaved: 'Saved for this vault.',
	settingsNameName: 'Name',
	settingsEmailName: 'Email',
	saveIdentity: 'Save',
	namePlaceholder: 'Your name',
	emailPlaceholder: 'name@example.com',
	scopeVault: 'from this vault',
	scopeComputer: 'from your computer-wide settings',
	scopeSystem: 'from the system settings',
	advancedNote: 'These settings do not change how documents are sent or received.',
	advancedHeading: 'Advanced',
	backToDefault: 'Back to default',
	advancedInvalid: "That value isn't one Git accepts for this setting.",
	advancedUnconnected: 'You can change these once this vault is connected.',

	// --- the settings tab's own labels ---
	pluginName: 'Docs Publisher',
	settingsKeyName: 'Your key',
	settingsUsernameName: 'GitLab username',
	addressPlaceholder: 'git@gitlab.example.com:group/project.git',

	// --- the panel's first screen (plugin-shell) ---
	setupTitle: 'Set up Docs Publisher',
	stepLabel1: 'Git installed',
	stepLabel2: 'Project address',
	stepLabel3: 'Key tested',
	stepLabel4: 'Vault connected',
	stepLabel5: 'Name and email',
	setupReady: 'Ready to publish your documentation.',
	step2Heading: "Add your project's address.",
	step2Text: `Paste the SSH address from ${GITLAB}'s Clone button.`,
	step3Heading: `Connect this computer to ${GITLAB}.`,
	step3TextUntested: `Add your key to ${GITLAB}, then test it.`,
	step4Heading: 'Connect this vault to the project.',
	step4Text:
		"Docs Publisher will download the project's documents. Your own notes are never replaced without asking.",
	step5Heading: 'Tell us who you are.',
	step5Text: 'Your name and email appear on the documents you send.',
	step1Heading: "Git isn't installed on this computer.",
	step1Text: 'Docs Publisher needs Git to send and get documents. Install it, then check again.',

	// --- controls and busy labels ---
	getGit: 'Get Git',
	checkAgain: 'Check again',
	openSettings: 'Open settings',
	createKey: 'Create key',
	copyKey: 'Copy key',
	openGitLab: 'Open GitLab',
	test: 'Test',
	connectVault: 'Connect this vault',
	getUpdates: 'Get updates',
	openToRequestReview: 'Open to request review',
	cancel: 'Cancel',
	busySending: 'Sending…',
	busyChecking: 'Checking…',
	busyGettingUpdates: 'Getting updates…',
	busyConnecting: 'Connecting…',
	busyTesting: 'Testing…',
	busyCreating: 'Creating…',
	stillBusy: 'Still finishing your last action. Try again in a moment.',

	// --- the updates line (plugin-shell) ---
	latestDocuments: 'You have the latest documents.',
	updatesNotChecked: 'Not checked yet.',
	checkingDocuments: 'Checking your documents…',
	updatesCheckFailed: 'Could not check for updates. Try Refresh.',
	needsYouDescription: 'Documents you sent that now need you: not accepted, or edited or moved since you last sent them.',

	// --- connecting a vault (vault-sync) ---
	vaultConnected: 'This vault is connected to your project.',
	foreignOrigin:
		'This vault is already linked to a different project, so Docs Publisher left it alone. Use a different vault for this project.',
	differentVersion:
		'This vault is already tracking a different version of the project, so Docs Publisher left it alone. Ask whoever set it up to switch it back.',
	unsentChanges: `This vault holds changes that were never sent to ${GITLAB}, so Docs Publisher left it alone. Ask whoever set it up to send them first.`,
	nestedVault:
		'This vault sits inside a larger project folder, so Docs Publisher left it alone. Use a vault whose own folder is the project.',
	obsidianGit:
		'The Obsidian Git plugin is also turned on for this vault. It can send changes on its own and clash with Docs Publisher. Turn one of them off.',

	// --- getting updates and choosing between versions (vault-sync) ---
	alreadyLatest: 'You already have the latest documents.',
	updateFailed: 'Could not get updates. Check your connection and try again.',
	summaryTitle: 'Get the latest documents?',
	twoVersionsText: 'You and someone else both changed this document. Choose which one to keep.',
	removedHereText: `You removed this document here, but it changed on ${GITLAB}.`,
	removedOnProjectText: `This document was removed on ${GITLAB}, but you changed it here.`,
	keepMine: 'Keep mine',
	useTheirs: 'Use theirs',
	keepBoth: 'Keep both',
	removeIt: 'Remove it',
	keepRemoved: 'Keep it removed',
	getItBack: 'Get it back',

	// --- sending a document (doc-authoring) ---
	submitFailed: "Submit didn't go through. Check your connection and submit again.",
	notAllowed: `${GITLAB} did not accept this document. Your account may not be allowed to add documents to this project. Ask your admin for Developer access.`,
	changedWhileSending: `Someone changed this document on ${GITLAB} while you were sending it. Get updates, then send again.`,
	changedSinceUpdates: `Someone changed this document on ${GITLAB} since you last got updates. Get updates, then send again.`,
	reviewHasChanges:
		"The version under review has changes that aren't in your note. Use Reset to bring them in, then make your edits again.",
	sentNoRequest: `Your document was sent, but a review request could not be opened automatically. Open ${GITLAB} to request a review.`,
	updateSent: 'Your update was sent.',
	pathNotReceived: `A document already exists at this path on ${GITLAB} that you haven't downloaded yet. Get updates first, then try again.`,
	identityNotUnique:
		"Another document in the project already has this file name, so this one can't be sent. Rename this file and try again.",
	alreadyWaiting:
		"A document with this file name is already waiting for review. If that's this document, there's nothing more to do. If it's a different one, rename the file and submit again.",
	replacesPublished: 'This replaces the published version of this document. Reviewers will see what changed.',
	invalidIdentity:
		"This note's identity isn't valid, so it can't be sent. Remove the doc_id line from the note's properties and submit again.",
	resetReadFailed: "Couldn't read the version under review just now, so nothing was reset. Try again.",
	resetMissingNote: 'That note is no longer in your vault, so nothing was reset.',
	resetFailed: "This document wasn't reset. Try again.",
	resetDone: 'This note now matches the version under review.',
	resetConfirmTitle: 'Reset this document?',
	resetFinished:
		"This document's review has already finished, so nothing was reset. Get updates to see where it stands now.",

	// --- state labels (submission-tracking) ---
	waitingForReview: 'Waiting for review',
	published: 'Published',
	notAccepted: 'Not accepted',

	// --- sending a document: what is refused before anything is written ---
	noActiveNote: 'Open the note you want to submit first.',
	invalidFilename:
		"This file's name can't be used as a document ID. Rename it — no spaces and none of ~^:?*[\\ — then submit again.",
	incompleteFrontMatter:
		"This note's title or category is missing or not one of the nine categories. Fill it in on the note, then submit again.",
	nothingToSend: 'There is nothing new to send: this document already matches the version on GitLab.',
	sendingTo: 'Sending to',
	moveConfirmTitle: 'Move this note on the project?',
	moveConfirmText: 'This note has moved. Submitting will move it on the project too, so reviewers see it in its new place.',
	moveAndSubmit: 'Move and submit',

	// --- the ready screen (plugin-shell) ---
	newDocument: 'New Document',
	submitForReview: 'Submit for review',
	sendUpdate: 'Send update',
	submitNewVersion: 'Submit a new version',
	submitAgain: 'Submit again',
	resetDocument: 'Reset',
	refresh: 'Refresh',
	needsYouHeading: 'Changes',
	waitingHeading: 'Waiting on reviewers',
	waitingDescription: 'Sent and unchanged. Nothing to do until a reviewer responds.',
	noDocuments: 'Nothing submitted yet. Documents you submit will be listed here.',
	nothingNeedsYou: 'No changes to send.',
	nothingWaiting: 'Nothing is waiting for review right now.',
	editedMarker: 'Unsent edits',
	movedMarker: 'Moved',
	openInGitLab: 'Open in GitLab',

	// --- notes that were never sent (plugin-shell) ---
	notSentHeading: 'Not sent yet',
	notSentDescription: 'Notes that are not on the project yet. Submit asks for a title and category if a note has none.',
	nothingNotSent: 'Every note is on the project.',
	submitNote: 'Submit',
	newNoteBadge: 'New',
	notSentStatus: 'Not sent yet',
	connectedShort: 'Connected',

	// --- what the project has that the vault lacks (plugin-shell) ---
	fromProjectHeading: 'From the project',
	fromProjectDescription: 'What Get updates would bring into this vault.',
	nothingFromProject: 'Nothing new on the project.',
	projectAdded: 'New',
	projectChanged: 'Changed',
	projectRemoved: 'Removed',
	projectDeletedHere: 'Deleted here',

	// --- tooltips for the toolbar's icon buttons (plugin-shell) ---
	tipGetUpdates: 'Get updates: bring in what the project has that this vault lacks',
	tipRefresh: 'Refresh: check the project for changes',
	tipNewDocument: 'New document',
	tipReset: 'Reset: replace this note with the version under review',
	refreshFailed:
		"Could not check your documents' status just now. They may have changed since this was last updated.",
	checkFailedSuffix: '(check failed)',
	notDerivedYet: 'Not checked yet.',
} as const;

export type AuthorMessageName = keyof typeof AUTHOR_MESSAGES;

/**
 * The messages that carry a value. Functions, not template strings left in
 * the caller, for the same reason as the constants above.
 */
export const AUTHOR_TEMPLATES = {
	stepOf: (step: number): string => `Step ${step} of ${SETUP_STEP_COUNT}`,
	keyWorks: (username: string): string => `Your key works. Connected as ${username}.`,
	connectedAs: (username: string): string => `Connected as ${username}`,
	duplicateDocId: (otherPath: string): string =>
		`Another note in this vault is the same document: ${otherPath}. Delete that copy, or clear its document ID, then submit again.`,
	resetConfirmText: (name: string): string =>
		`“${name}” will be replaced with the version currently under review. Anything you have changed in this note since you last sent it will be lost.`,
	destination: (host: string, project: string): string => `${host} — ${project}`,
	addressLocked: (project: string): string =>
		`This vault is connected to ${project}. To use a different project, use a different vault.`,
	andMore: (count: number): string => `and ${count} more`,
	updatesAvailable: (count: number): string => (count === 1 ? '1 update available' : `${count} updates available`),
	moveDetail: (from: string, to: string): string => `On the project: ${from}. Now: ${to}.`,
	gotUpdates: (added: number, updated: number, removed: number): string =>
		`Got the latest documents: ${added} added, ${updated} updated, ${removed} removed.`,
	merged: (name: string): string => `Merged your changes with ${GITLAB}'s in ${name}.`,
	skippedPath: (path: string): string =>
		`Couldn't save ${path} on this computer. Everything else was updated.`,
	unsavedNote: (name: string): string =>
		`${name} has unsaved changes, so it was left as it is. Save it and get updates again.`,
	summaryText: (download: number, update: number, decide: number): string =>
		`${download} to download, ${update} to update, ${decide} need your decision. Nothing changes until you confirm.`,
	twoVersionsTitle: (name: string): string => `Two versions of ${name}`,
	removedHereTitle: (name: string): string => `${name} was removed here`,
} as const;

export type AuthorTemplateName = keyof typeof AUTHOR_TEMPLATES;
