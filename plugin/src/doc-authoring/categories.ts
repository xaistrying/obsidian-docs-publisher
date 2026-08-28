/**
 * The nine fixed deliverables `category` may take. Closed list, no
 * mechanical role — per `openspec/config.yaml`, a tenth means shipping a
 * plugin update, and this field never routes or gates anything.
 */
export const CATEGORIES = [
	'User Manual',
	'Operational Manual',
	'Release FAQ',
	'SOP',
	'Runbook',
	'Configuration Reference',
	'Diagnostic Reference',
	'Known Errors',
	'Safe-Action Boundaries',
] as const;

export type Category = (typeof CATEGORIES)[number];
