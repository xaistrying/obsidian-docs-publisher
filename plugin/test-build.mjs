import esbuild from "esbuild";
import builtInModules from "builtin-modules";

await esbuild.build({
  entry: 'src/main.ts',
  bundle: true,
  external: ['obsidian', '@codemirror/autocomplete', ...builtInModules],
  format: 'cjs',
  target: 'ES6',
  outfile: '/tmp/test-nobundler.js',
  footer: { js: 'module.exports = module.exports.default;' },
});

console.log('Build complete');
