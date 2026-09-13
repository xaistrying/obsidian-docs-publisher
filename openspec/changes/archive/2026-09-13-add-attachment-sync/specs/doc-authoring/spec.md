## ADDED Requirements

### Requirement: A submission carries the images the document embeds
The plugin SHALL commit, alongside the note, every image the note embeds,
each at the same path it occupies in the vault relative to the vault root.
This SHALL apply to every write path: a first submission, an update to a
document under review, and a new cycle for a published or not-accepted
document.

#### Scenario: A first submission of a document with images
- **WHEN** the author submits a document whose note embeds two images
- **THEN** the note and both images are committed together, each at its own vault-relative path

#### Scenario: An update to a document under review
- **WHEN** the author sends an update for a document under review whose note embeds an image added since the last submission
- **THEN** the note and the newly embedded image are committed together to that document's existing branch

#### Scenario: A document that embeds nothing
- **WHEN** the author submits a document whose note embeds no images
- **THEN** the note alone is committed, exactly as before

### Requirement: Embeds are resolved through the vault's own resolver
The plugin SHALL resolve an embed written as a wikilink through the vault's
own link resolution, and SHALL NOT determine its location by matching
filenames from the note's text. A wikilink embed names a file, not a
location, and two folders may hold files of the same name.

An embed written as a markdown link SHALL be resolved as a path relative to
the note, and confirmed to exist in the vault before being carried.

#### Scenario: Two images share a filename in different folders
- **WHEN** a note embeds `![[diagram.png]]` as a wikilink, and the vault holds a `diagram.png` in two different folders
- **THEN** the image the vault's own resolver selects for that note is the one committed, not whichever file matched the name first

#### Scenario: A markdown-style embed
- **WHEN** a note embeds an image written as a markdown link with a path
- **THEN** that path is resolved relative to the note and the file it names is committed

### Requirement: An embed that cannot be resolved does not block the submission
The plugin SHALL skip an embed it cannot resolve to a file in the vault,
and SHALL submit the document without it. It SHALL NOT refuse the
submission, and SHALL NOT fail after a partial write.

A broken link in the author's own note is not a reason to stop them
publishing, and refusing would make a typo block a document.

#### Scenario: A note embeds an image that does not exist
- **WHEN** the author submits a document whose note embeds a filename matching no file in the vault
- **THEN** the submission proceeds, carrying the note and any embeds that did resolve, and is not refused

#### Scenario: A note embeds a file outside the vault
- **WHEN** a note's embed resolves to a location outside the vault
- **THEN** that embed is skipped and the submission proceeds

### Requirement: An attachment already on the remote is updated, not recreated
For each file a submission carries, the plugin SHALL determine whether that
path already exists on the ref being committed to, and SHALL update it
carrying its current commit identifier where it does, or create it where it
does not. This SHALL apply to attachments exactly as it already applies to
the note.

#### Scenario: An image shared with other documents
- **WHEN** the author submits a document embedding an image whose path already exists on the remote, because other documents embed the same image
- **THEN** that image is committed as an update carrying its current commit identifier, not as a new file

#### Scenario: An image nobody has published before
- **WHEN** the author submits a document embedding an image whose path does not exist on the remote
- **THEN** that image is committed as a new file

#### Scenario: A shared image changed since it was read
- **WHEN** a submission carries an update to a shared image whose remote copy changed after its commit identifier was read
- **THEN** the write is refused rather than silently overwriting it, and the author is told the document changed since they last opened it

### Requirement: The plugin never deletes a remote attachment
The plugin SHALL NOT delete any attachment from the remote, under any
circumstance, including when a note stops embedding an image or embeds it
from a different path.

#### Scenario: An author removes an image from a note
- **WHEN** the author removes an embed from a note and submits the document again
- **THEN** the image remains on the remote, and the submission neither deletes it nor fails because of it
