// Gathers what a release carries into plugin/release/: the three runtime files, the
// installer, and SHA256SUMS for the three. Run through `npm run release`, which builds
// first. It publishes nothing: attach the folder's files to a GitHub release tagged
// v<version> (see the README, "For admins"). It refuses a build whose version is not
// the same in every file that states it, because an installer that reports one
// version while the files are another is how an update is silently not applied.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'release');
const RUNTIME_FILES = ['main.js', 'manifest.json', 'styles.css'];

const readJson = (name) => JSON.parse(readFileSync(join(root, name), 'utf8'));
const fail = (message) => {
	console.error(`[release] ${message}`);
	process.exit(1);
};

const manifest = readJson('manifest.json');
const pkg = readJson('package.json');
const versions = readJson('versions.json');

if (pkg.version !== manifest.version) {
	fail(`package.json says ${pkg.version} but manifest.json says ${manifest.version}`);
}
if (versions[manifest.version] !== manifest.minAppVersion) {
	fail(`versions.json has no entry "${manifest.version}": "${manifest.minAppVersion}"`);
}
for (const name of RUNTIME_FILES) {
	if (!existsSync(join(root, name))) {
		fail(`${name} is missing: run "npm run build" first`);
	}
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const name of [...RUNTIME_FILES, 'install.sh']) {
	copyFileSync(join(root, name), join(out, name));
}
const sums = RUNTIME_FILES.map((name) => {
	const hash = createHash('sha256').update(readFileSync(join(out, name))).digest('hex');
	return `${hash}  ${name}`;
});
writeFileSync(join(out, 'SHA256SUMS'), `${sums.join('\n')}\n`);

console.log(`[release] ${manifest.id} ${manifest.version} is in ${out}`);
console.log(`[release] Publish: create a release tagged v${manifest.version} and attach every file in that folder.`);
