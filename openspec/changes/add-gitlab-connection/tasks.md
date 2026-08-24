## 1. Remote access client

- [ ] 1.1 Create the client module — the only file importing `requestUrl` — taking the connection details per call and exposing an identity read and a project-access read
- [ ] 1.2 Classify failures into rejected credential, target not reachable, server unreachable, and unexpected, returning the classification rather than a message

## 2. Session credentials

- [ ] 2.1 Hold the GitLab address, project path, and token on the plugin instance for the session, with no `saveData` call anywhere near them
- [ ] 2.2 Add a guard that reports missing details with "Add your GitLab details in the plugin's settings first." for later capabilities to reuse

## 3. Settings tab

- [ ] 3.1 Register the settings tab with the three inputs, the token one masked, and text naming the fine-grained token flow and that permissions come from their admin
- [ ] 3.2 Add the "Test connection" control that reads identity then project access via the client, showing "Checking…" and refusing a second concurrent run
- [ ] 3.3 Render the success line "Connected as <name> — <access> access" and the exact failure sentence for each classification, including the empty-fields case

## 4. Verify by hand

- [ ] 4.1 Build, install into the test vault, and confirm the settings tab shows three empty inputs with the token masked
- [ ] 4.2 Paste valid details, click "Test connection", and confirm it names who it connected as and their access level
- [ ] 4.3 Click with a field empty, then with a bad token, a wrong project path, and a wrong address — confirm each shows its own sentence and never a status code
- [ ] 4.4 Reopen the settings tab in the same session and confirm the values are still there; restart Obsidian and confirm all three are empty again
- [ ] 4.5 Confirm the token appears in no file in the test vault, `data.json` included
