/**
 * What a send needs besides the note, for a test that is not about moving it: the
 * vault holds the one note, and a move, were one asked about, is confirmed.
 */
export const sendDefaults = (notePath: string): {
	vaultPaths: ReadonlySet<string>;
	knownNotes: Array<{ path: string; blob: string }>;
	confirmMove: () => Promise<boolean>;
} => ({
	vaultPaths: new Set([notePath]),
	knownNotes: [],
	confirmMove: async () => true,
});
