/**
 * The `obsidian` module, as much of it as the tests touch and no more.
 *
 * Every source module imports `obsidian` at runtime — `Notice`, `Modal`,
 * `requestUrl` — and that module does not exist outside the Obsidian
 * application, so without this alias nothing here is importable in a test
 * process at all. That is the whole of this file's job.
 *
 * IT IS NOT A REIMPLEMENTATION OF OBSIDIAN AND MUST NOT GROW INTO ONE
 * (design.md decision 5). Anything a test needs to control belongs in a fake
 * the test builds and hands to the code under test, not in a richer stub
 * here: a stub that starts modelling the vault becomes a second, unverified
 * Obsidian that the tests then pass against while the real one behaves
 * differently.
 *
 * `requestUrl` is the one exception, and only because it is transport rather
 * than behaviour: `gitlab-client.ts` calls it directly and takes no seam for
 * it, so a test that wants to pin a response shape has nowhere else to stand.
 * See `setRequestUrlHandler`.
 */

export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	contentType?: string;
	body?: string;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	headers: Record<string, string>;
	text: string;
	json: unknown;
	arrayBuffer: ArrayBuffer;
}

type RequestUrlHandler = (request: RequestUrlParam) => Promise<RequestUrlResponse> | RequestUrlResponse;

let handler: RequestUrlHandler | null = null;

/**
 * Installs what `requestUrl` answers for the duration of one test. Returns a
 * function that removes it again, so a test cannot leak its handler into the
 * next one.
 */
export function setRequestUrlHandler(next: RequestUrlHandler): () => void {
	handler = next;
	return () => {
		handler = null;
	};
}

/**
 * Builds a response with the shape `requestUrl` really returns, including
 * `json` throwing on a body that is not JSON — which is the behaviour
 * `gitlab-client.ts`'s try/catch around `response.json` is written against.
 */
export function stubResponse(params: { status: number; body?: string }): RequestUrlResponse {
	const text = params.body ?? '';
	return {
		status: params.status,
		headers: {},
		text,
		get json(): unknown {
			return JSON.parse(text);
		},
		arrayBuffer: new ArrayBuffer(0),
	};
}

export async function requestUrl(request: RequestUrlParam): Promise<RequestUrlResponse> {
	if (handler === null) {
		throw new Error(`No requestUrl handler installed for ${request.method ?? 'GET'} ${request.url}`);
	}

	return handler(request);
}

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
