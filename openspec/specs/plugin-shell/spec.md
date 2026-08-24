# Plugin Shell Specification

## Purpose

This capability defines the foundational plugin shell: the core infrastructure that allows the Obsidian plugin to load, register a sidebar view, and expose entry points for opening that view. This is the baseline all future plugin capabilities are built upon.

## Requirements

### Requirement: Plugin loads without error
The plugin SHALL load successfully when enabled in Obsidian, registering
its sidebar view type without throwing an error or preventing other
plugins from loading.

#### Scenario: Plugin enabled in a vault
- **WHEN** a user enables the plugin in Obsidian's Community Plugins settings
- **THEN** the plugin loads without error and no error notice appears

### Requirement: Sidebar view opens from the ribbon icon
The plugin SHALL add a ribbon icon that opens the plugin's sidebar view
in the right sidebar when clicked.

#### Scenario: Clicking the ribbon icon with the view closed
- **WHEN** the user clicks the plugin's ribbon icon and the sidebar view is not currently open
- **THEN** the sidebar view opens in the right sidebar and becomes the active leaf

### Requirement: Sidebar view opens from the command palette
The plugin SHALL register a command, discoverable in the command
palette, that opens the same sidebar view as the ribbon icon.

#### Scenario: Running the command with the view closed
- **WHEN** the user runs the plugin's command from the command palette and the sidebar view is not currently open
- **THEN** the sidebar view opens in the right sidebar, identical to clicking the ribbon icon

### Requirement: Opening the view never creates a duplicate panel
The plugin SHALL reveal the existing instance of the sidebar view rather
than opening a second one, regardless of which entry point is used or
how many times it is triggered.

#### Scenario: Triggering either entry point while the view is already open
- **WHEN** the sidebar view is already open and the user clicks the ribbon icon or runs the command again
- **THEN** the existing view is revealed and no additional panel is created

#### Scenario: Alternating entry points
- **WHEN** the user opens the view via the ribbon icon, then triggers the command palette entry
- **THEN** the same single view instance is revealed, not a second one

#### Scenario: Two triggers in rapid succession from a closed state
- **WHEN** the view is closed and the user triggers either entry point twice in immediate succession, faster than the first open completes
- **THEN** exactly one panel exists afterwards

### Requirement: The sidebar view shows placeholder content
The plugin's sidebar view SHALL render identifiable placeholder content
when opened, rather than an empty container that is indistinguishable
from a loading or broken state.

#### Scenario: Opening the view for the first time
- **WHEN** the user opens the sidebar view
- **THEN** the view displays a heading naming the plugin and no error state
