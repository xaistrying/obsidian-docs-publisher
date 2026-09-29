## MODIFIED Requirements

### Requirement: The plugin has a settings tab with three connection fields
The plugin SHALL register a settings tab containing three separate text
inputs — the GitLab address, the project path, and an access token — and the
token input SHALL mask its contents so a pasted token is not left readable on
screen.

The tab SHALL name the permissions a token actually needs, rather than
deferring the question. It previously said only that the exact permissions
were assigned by an admin, because nobody knew what they were: GitLab exposes
no endpoint reporting which permissions a fine-grained token holds, so they
could only be learned by attempting each call and reading what a refusal
named. Once established, withholding them would leave every author asking an
admin for an unspecified grant, and every admin guessing.

#### Scenario: Opening the settings tab for the first time
- **WHEN** the author opens the plugin's settings tab after enabling the plugin
- **THEN** three empty inputs are shown, labelled for the GitLab address, the project path, and the access token, with the token input masked

#### Scenario: Settings tab explains where to get a token
- **WHEN** the author views the settings tab
- **THEN** it names the fine-grained access token flow as the place to create a token

#### Scenario: Settings tab names the permissions the token needs
- **WHEN** the author views the settings tab
- **THEN** it lists the permissions a token needs for this plugin's operations, so the author can tick them or send the list to whoever creates the token for them

#### Scenario: The list covers what the plugin actually calls, and no more
- **WHEN** the listed permissions are compared against the operations the plugin performs
- **THEN** every listed permission is one some operation requires, and no permission is listed for an operation the plugin does not perform
