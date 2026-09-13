import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The alias IS the configuration. Every source module imports `obsidian` at
 * runtime, so a test process has nothing to import until that specifier
 * resolves to something — see `tests/obsidian-stub.ts` for what that
 * something deliberately is not.
 *
 * Vitest runs the TypeScript sources directly, so there is no build step here
 * and none for `npm run build` to depend on: tests are not a build dependency
 * (tasks.md 1.4).
 */
export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL('./tests/obsidian-stub.ts', import.meta.url)),
		},
	},
	test: {
		include: ['tests/**/*.test.ts'],
	},
});
