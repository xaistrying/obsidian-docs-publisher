## ADDED Requirements

### Requirement: Messages about the access token tell the author how to fix it themselves
Each author creates their own access token, and a token's permissions cannot
be changed once it has been created. Every message the plugin shows about the
token SHALL therefore name what the author can do, and SHALL NOT send them to
an admin to fix it. An admin cannot renew a person's token or add a
permission to it. Role messages are outside this rule: a role is the one
thing only an admin can change.

A rejected or expired token SHALL be reported with the same text wherever it
is met: "Your access token has expired or is incorrect. Check you pasted all
of it, or create a new one in GitLab." That covers the connection check, the
panel's connection state, and every other action that talks to the platform.
A rejected token SHALL NOT be reported as a connection problem, a generic
failure, or a reason to try again. Retrying cannot succeed until the token
changes.

A token missing a permission SHALL be reported as "Your access token doesn't
have permission to <action>", followed by one of two endings:
- where the platform named the permission: " (missing: <name>). Create a new
  access token that includes it."
- where it named none: ". Create a new access token with the permissions
  listed in the plugin's settings."

Each surface keeps its own <action> wording.

#### Scenario: The token expires in the middle of a session
- **WHEN** the author connected successfully earlier in the session, their token has since expired, and they select Submit for review
- **THEN** they are told "Your access token has expired or is incorrect. Check you pasted all of it, or create a new one in GitLab." and not that the submission failed for a connection reason

#### Scenario: A rejected token met by a status refresh
- **WHEN** a refresh of the panel's document states is refused because the server rejected the token
- **THEN** the panel shows "Your access token has expired or is incorrect. Check you pasted all of it, or create a new one in GitLab."

#### Scenario: A named permission is missing
- **WHEN** an action is refused because the token lacks a permission and the platform names it, for example Merge Request: Create during a submit
- **THEN** the author is told "Your access token doesn't have permission to submit documents (missing: Merge Request: Create). Create a new access token that includes it."

#### Scenario: An unnamed permission is missing
- **WHEN** an action is refused for a missing permission and the platform does not name it
- **THEN** the message ends "Create a new access token with the permissions listed in the plugin's settings." and names no permission

#### Scenario: A role still points at an admin
- **WHEN** a connection check succeeds but the author's role grants reading only
- **THEN** the message still asks the author to ask their admin for Developer access, unchanged by this requirement

## MODIFIED Requirements

### Requirement: The connection check states exactly why it failed
Every failure of the connection check SHALL be reported in the settings tab
with a message naming what to do next. The plugin SHALL distinguish a rejected
token, an unreachable project, and a failure to reach the server at all, and
SHALL NOT report a raw status code or an unexplained failure.

#### Scenario: One or more fields are empty
- **WHEN** the author selects "Test connection" with any of the three fields empty
- **THEN** the settings tab shows "Fill in all three fields before testing the connection." and no request is made

#### Scenario: The token is rejected or has expired
- **WHEN** the author selects "Test connection" and the server rejects the token
- **THEN** the settings tab shows "Your access token has expired or is incorrect. Check you pasted all of it, or create a new one in GitLab."

#### Scenario: The project cannot be reached with this token
- **WHEN** the author selects "Test connection" with a valid token but a project path that does not exist or that their access does not cover
- **THEN** the settings tab shows "That project could not be found, or your access does not include it. Check the project path above."

#### Scenario: The server cannot be reached
- **WHEN** the author selects "Test connection" and the address is wrong or the network is unavailable
- **THEN** the settings tab shows "Could not reach GitLab at that address. Check the address above and your connection, then try again."

#### Scenario: An unexpected failure
- **WHEN** the author selects "Test connection" and the attempt fails for any reason other than those above
- **THEN** the settings tab shows "The connection check did not succeed. Check the details above and try again." and does not display a status code or raw error text
