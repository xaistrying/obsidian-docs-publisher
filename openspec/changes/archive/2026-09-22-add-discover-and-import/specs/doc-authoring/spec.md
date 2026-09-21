## ADDED Requirements

### Requirement: An imported document is written at its exact remote path
The plugin SHALL create an imported document's note at exactly the path it
occupies on the remote, relative to the vault root, and SHALL NOT place it at
any other local path. The configurable default directory for NEW documents
SHALL NOT apply to an import: a new document has no identity yet and may go
anywhere, whereas an imported document's path is already half of its
identity.

#### Scenario: Importing a document from a nested folder
- **WHEN** the author imports a document the remote holds at `Products/Barcode-Scanner/SOPs/BS-SOP-001_Help-Customer-Setup.md`
- **THEN** the note is created at that same path in the vault, with any missing folders created along the way

#### Scenario: The default directory setting is ignored for imports
- **WHEN** a default directory for new documents is configured and the author imports a document
- **THEN** the imported note is created at its remote path, and the configured directory is not consulted

### Requirement: Importing freezes the document's identity
The plugin SHALL write `doc_id` into an imported note's front matter at the
moment of import, derived from the document's remote filename by the same
rule a first submit uses.

An imported document's identity is already fixed on the remote — its name and
path were decided by whoever published it, and a document whose local path has
drifted from its remote one is refused rather than followed. The freedom to
rename freely before the identity is frozen, which a document authored in this
vault has until its first submit, does not exist for an imported one.

Freezing it here is what makes an imported document submittable: a note
carrying `doc_id` is resubmitted rather than submitted for the first time, so
the first-submit path's collision check — which would otherwise refuse every
imported document, because a file does exist at its path on the default
branch — does not apply to it.

#### Scenario: An imported note carries its identity immediately
- **WHEN** the author imports a document
- **THEN** the resulting note's front matter carries `doc_id`, derived from the remote filename

#### Scenario: An imported document can be edited and submitted
- **WHEN** the author imports a document, edits it, and submits it
- **THEN** the submission is not refused for a path that already exists, and a new review cycle is opened for it

#### Scenario: An imported document's other front matter is untouched
- **WHEN** the author imports a document whose front matter carries `title`, `owner` and `last_reviewed` written by someone else
- **THEN** those values are preserved exactly, and the plugin adds only `doc_id`

### Requirement: An import is refused rather than colliding with what the vault already has
The plugin SHALL refuse an import, writing nothing, when a note in the vault
already carries the `doc_id` the import would freeze, or when a note already
occupies the target path. It SHALL name what it collided with.

#### Scenario: A note in the vault already carries this document's identity
- **WHEN** the author imports a document whose `doc_id` a note already in the vault carries, including one the author moved to a different folder
- **THEN** the import is refused, nothing is written, and the author is told which note already has it

#### Scenario: A note already occupies the target path
- **WHEN** the author imports a document whose remote path a note in the vault already occupies
- **THEN** the import is refused and neither that note nor any other file is modified

### Requirement: Imported and recovered documents bring their images with them
The plugin SHALL fetch the attachments an imported or recovered document
embeds and write each at its own remote path, so the document renders as it
does on the remote.

Attachments SHALL be resolved after the note is written, through the same
resolution the submit path uses, since that resolution reads the embeds
Obsidian recorded for the note and a document that is not yet in the vault
has none recorded.

That resolution SHALL be asked of the REMOTE's own file listing rather than
of the vault. The vault cannot answer it: a newly arrived document's images
are not in the vault, which is the entire reason they are being fetched.

Where a document embeds a file by NAME and the remote holds more than one
file of that name, the plugin SHALL report that it could not place the embed
rather than choosing one. Only the editor's own link resolution decides which
file a name means, and a second implementation of that rule would disagree
with the first exactly when it mattered.

#### Scenario: Importing a document that embeds images
- **WHEN** the author imports a document embedding two images
- **THEN** both images are written to the vault at their own remote paths and the document's embeds resolve

#### Scenario: Recovering a document that embeds images
- **WHEN** the author recovers a document embedding an image
- **THEN** the image is fetched and written too, rather than the note being restored with a broken embed

#### Scenario: An attachment cannot be fetched
- **WHEN** a document's note is written but one of its attachments cannot be fetched
- **THEN** the note remains, the author is told which attachment did not arrive, and the failure is not silent

#### Scenario: An attachment already in the vault
- **WHEN** an imported document embeds an image the vault already holds at that path
- **THEN** the existing file is left alone rather than overwritten

#### Scenario: A document embeds an image by a name the remote holds several of
- **WHEN** an imported document embeds `diagram.png` and the remote holds a file of that name in more than one folder
- **THEN** no image is written for that embed, and the author is told which embed could not be placed

#### Scenario: A document embeds another document
- **WHEN** an imported document embeds another note rather than an attachment
- **THEN** nothing is fetched for it and nothing is reported, since embedding one document in another is out of scope for this plugin entirely
