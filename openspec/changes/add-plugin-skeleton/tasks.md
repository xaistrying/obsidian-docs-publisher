## 1. Project scaffold

- [ ] 1.1 Create `manifest.json` — id `obsidian-git-publisher`, name "Git Publisher", version `0.1.0`, minAppVersion, description, author, `isDesktopOnly: false`. The id is fixed from this commit; see the Plugin identity decision in `design.md`
- [ ] 1.2 Create `package.json` (name `obsidian-git-publisher`) with `dev`/`build` scripts and devDependencies (`typescript`, `esbuild`, `obsidian`, `@types/node`, `builtin-modules`, `tslib`)
- [ ] 1.3 Add `tsconfig.json` and `esbuild.config.mjs`
- [ ] 1.4 Add `.gitignore` — `node_modules`, build output (`main.js`), and `data.json` with a comment noting it holds the access token from `platform-config` onward. It does not exist yet in this milestone; that is why it is easy to forget and why it goes in now

## 2. Sidebar view

- [ ] 2.1 Define a `VIEW_TYPE` constant and a view class extending `ItemView` with `getViewType`/`getDisplayText`/`getIcon`, and an `onOpen()` that renders a heading naming the plugin plus a one-line placeholder note
- [ ] 2.2 In the plugin's `onload()`, call `registerView(VIEW_TYPE, ...)`
- [ ] 2.3 Implement a single `activateView()` function: check `workspace.getLeavesOfType(VIEW_TYPE)` first — if a leaf exists, reveal it; otherwise get/create a right-sidebar leaf, set its view state to `VIEW_TYPE`, then reveal it. `getRightLeaf(false)` returns `WorkspaceLeaf | null` and `tsconfig` is `strict`, so handle the null case or the build fails
- [ ] 2.4 Add a one-line in-flight guard so two rapid triggers cannot both pass the existing-leaf check before either awaits `setViewState` (see the race entry in `design.md`)

## 3. Entry points

- [ ] 3.1 In `onload()`, add a ribbon icon whose click handler calls `activateView()`
- [ ] 3.2 In `onload()`, register a command whose callback calls `activateView()`

## 4. Verify

- [ ] 4.1 Build the plugin and load it in a test vault — confirm it appears in Community Plugins, enables, and no error notice or console error appears
- [ ] 4.2 Click the ribbon icon — the sidebar view opens in the right sidebar showing the placeholder heading
- [ ] 4.3 Close the view, then run the plugin's command from the command palette — the same view opens
- [ ] 4.4 With the view open, click the ribbon icon again and separately run the command again — confirm no duplicate panel appears each time, only the existing view is revealed/focused
- [ ] 4.5 Create an empty `data.json` in the plugin folder and run `git status` — confirm it is ignored, then delete it. Verifies the ignore rule now, while the file is harmless, rather than after it contains a token
