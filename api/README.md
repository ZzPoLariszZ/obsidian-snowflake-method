# Local API

A RESTful API for the Snowflake Method plugin, answered by the plugin itself on the computer it runs on. It is made for programs that work beside the author, such as an MCP server or a command line tool an AI agent drives. Those packages live outside this repository and call what is described here.

The contract is [`openapi.yaml`](openapi.yaml), an OpenAPI 3.1 document. It is the one source of truth. The routes, the checking of every call, the access classes and the document the API serves about itself are all read from it.

## Switching it on

The API is off until the author switches it on. It is a desktop feature. On a phone or a tablet there is no listener, no settings section and no command.

Open **Settings → Snowflake Method → Local API**.

| Setting | What it does |
| --- | --- |
| Status | Says the access level, then whether the listener is up, and why not where it is not. |
| Enable local API | Answers calls on `127.0.0.1` at the port below. Off by default. |
| Port | `27125` unless changed. Two vaults open at once need two ports. |
| Access | **Read only** (the default), **Read and write**, or **Read, write and delete**. |
| Access token | Made on this device and kept in Obsidian's keychain. Copy it for the caller. Making a new one ends the old one. |
| Command line bridge | Answers the same operations through Obsidian's own command line. Off by default. No token is asked there. |

The listener binds to `127.0.0.1` only. A call from a web page is refused, since a page always says where it comes from and the API takes no call that does.

## Calling it

### Over HTTP

Every call carries the token as a bearer token. The base address is `http://127.0.0.1:27125/v1`.

```bash
curl -H "Authorization: Bearer $SNOWFLAKE_TOKEN" http://127.0.0.1:27125/v1/projects
```

A body is JSON. A `PATCH` body is a JSON merge patch (RFC 7396).

```bash
curl -X POST -H "Authorization: Bearer $SNOWFLAKE_TOKEN" -H "Content-Type: application/json" -d '{"title":"Count the bells"}' http://127.0.0.1:27125/v1/projects/$PROJECT_ID/tasks
```

`GET /v1` and `GET /v1/ready` answer without a token, with nothing of the author's in them. With the token, `GET /v1` also says the access level and whether renames are possible, and `GET /v1/openapi.json` gives the contract as this build answers it, with the port in use.

### Through Obsidian's command line

One command reaches every operation by its name.

```bash
obsidian snowflake-method:api op=listProjects
```

| Flag | What it carries |
| --- | --- |
| `op` | The operation's name, its `operationId` in the contract. |
| `params` | One JSON object of the address and query parameters, by their names in the contract. |
| `body` | The call's body as JSON. |
| `ifMatch` | The version a change is made against. |
| `pretty` | Indents the answer. |

A value that begins with `%` is read back out of percent-encoding first, which spares a caller its shell's quoting. The answer is always one JSON object: `{ok, status, operationId, etag, location, data}` when the call landed, and `{ok: false, status, operationId, error}` when it did not, where `error` is the same problem document HTTP gives. `params` and `body` together may be 128 KB at most. Send longer text over HTTP.

## How it behaves

**One call at a time.** Calls are answered in the order they come, reads among them. A read never sees half of a change. Where too many wait, a new one answers `503 busy` at once.

**Ids and addresses.** A project, a character, a scene, a worldbuilding note, a task, a thread, a revision and a sticky note each have a stable `id`. A manuscript note has none. It is addressed by its path inside the project, percent-encoded into one segment, such as `50_Manuscript%2FChapter%201.md`. Every note that is returned carries its `path` in the vault, for use with Obsidian's own command line.

**Versions.** A thing that is a note carries an `etag`. Send it back in `If-Match` to change or delete that thing. Where the note has changed since, the answer is `412` with the `etag` that stands, and nothing is written. `If-Match: *` takes whichever version stands.

**Lists.** `offset` and `limit` page a list. The default is 100 and the most is 500.

**Errors.** Every error is a problem document (RFC 9457) with a stable `code`. Branch on the code. The contract lists every code under `x-snowflake-problems`.

**Access.** Each operation needs one of the three levels, said in `x-snowflake-access`. A call above the author's level answers `403 access-denied` with what it needs.

## What to know before writing

**The author may be typing.** A manuscript note or a sticky note may be open in the plugin with words not yet saved. Those words are saved first. A change is then made only against that latest text, which is what `If-Match` is for. Once the change is sure to be made, the plugin's editor on that note closes. A call that is refused leaves the author writing where they were.

**Word counts.** Text written through the API is not counted as the author's own typing, and the modification history files it as the plugin's. A note deleted through the API counts as words the project lost, as any deleted note does.

**Renaming.** Obsidian rewrites the links to a note that takes another name. Where the author has Obsidian ask first, it opens a dialog and waits, and a caller cannot answer a dialog. While **Automatically update internal links** is off in Obsidian's **Files and links** settings, every change that would rename a note or a folder answers `409 link-updates-ask` before anything is written. `GET /v1` says which way it is set, in `canRename`.

**After a rename.** Obsidian may shorten a link it rewrites. The health check then reports `incomplete-link` as repairable, and `repairProject` writes the link back in full.

**Proposing, not changing.** `createRevision` proposes a change to a passage without making it. The author sees it as a card beside the text and decides. It is the gentle way to suggest prose. `acceptRevision` makes the change a revision proposes, as the card's own button does.

**Finding and replacing.** `searchProject` looks for words as they are typed, never as an expression. In a manuscript note it looks in the whole text. In any other note it looks in each thing the note says, and names the field. `replaceInProject` changes the manuscript's notes only. Send `dryRun` first: the answer says how many places would change, and how many revisions and thread appearances would lose their passage.

**Moving a note.** `moveManuscriptNote` changes the reading order and nothing else. A numbered note keeps its name, so `renameManuscriptNote` is what puts the count right afterwards.

**Boards.** A timeline, a beat sheet and a freeform view name a note by its id, and a change is refused where an id names nothing the project has. A timeline, a view of the timelines, a beat sheet and a freeform view each go by a name no other of its kind has. What an operation makes is told by its id in the answer. Taking a scene off a board, or a time off a timeline, needs the delete level, though the note itself stands.

**Freeform steps.** `applyFreeformSteps` takes a list of steps and makes all of them or none. A step may give a new card, frame or line a name in `id`, so that a later step of the same call can speak of it. The name holds for that call alone. The answer says which id each was kept under.

**Importing.** `inspectImport` says what another project of the vault has to bring, part by part, and `runImport` copies the parts named. Whatever a part cannot stand without comes with it. A link to a part that was not brought is dropped from the copy, and the answer says which. The other project is never changed.

**Exporting.** `exportManuscript` writes plain text or Markdown into the folder the author keeps exports in, or a folder below it, and nowhere else. `exportCanvas` writes a canvas beside the board's own file. Neither writes over a file that already stands unless the call says `overwrite`.

**Pictures.** `addGalleryPictures` takes pictures that already stand in the vault, each by its path, and copies them into the gallery folder of the note's kind. The API carries no picture's bytes. `removeGalleryPicture` sends a picture's file to the trash only where it stands in a gallery folder and no other note shows it.

**Deleting.** A deleted note goes where the author's Obsidian sends deleted files. A deleted task, thread or revision cannot be brought back. A character, a scene or a worldbuilding note that other notes name is refused with what names it, unless the call says `force=true`. A project is never deleted here. `archiveProject` puts it away and `restoreProject` brings it back.

**Reads that write.** A read changes nothing the author wrote. The plugin may still put three things right as it reads, as it does whenever it opens a project. A moved project has its link to the first manuscript note pointed at where that note stands. A record file that can no longer be read is set aside under a new name. Statistics and mentions are kept in a cache file of this device's own. `inspectImport` may put the plugin's record of earlier imports right where the two projects show it to be out of date.

## Operations

153 operations are answered now: 58 read, 69 write and 26 delete. Later rounds are written into the contract and marked `planned`. A planned operation answers `501 planned-operation` and is left out of the document the API serves.

A name marked ² needs the write level. A name marked ³ needs the delete level.

| Group | Operations |
| --- | --- |
| Service | `getApiRoot`, `getReadiness`, `getOpenApiDocument` |
| Projects | `listProjects`, `createProject` ², `getProject`, `updateProject` ², `getProjectHealth`, `archiveProject` ², `restoreProject` ², `repairProject` ², `repairProjectIssue` ², `migrateProjectNotes` ², `searchProject`, `inspectImport`, `runImport` ² |
| Steps | `listSteps`, `getStep`, `setStepStatus` ², `getStepText`, `updateStepText` ² |
| Kinds | `listKinds`, `createKind` ², `getKind`, `updateKind` ², `deleteKind` ³ |
| Members | `listMembers`, `getMemberUsage`, `addGalleryPictures` ², `removeGalleryPicture` ³ |
| Characters | `listCharacters`, `createCharacter` ², `getCharacter`, `updateCharacter` ², `deleteCharacter` ³, `moveCharacter` ² |
| Scenes | `listScenes`, `createScene` ², `getScene`, `updateScene` ², `deleteScene` ³, `moveScene` ² |
| Entities | `listEntities`, `createEntity` ², `getEntity`, `updateEntity` ², `deleteEntity` ³, `moveEntity` ² |
| Vocabularies | `getVocabulary`, `getVocabularyTree`, `getDefinitionNode`, `createDefinitionNode` ², `updateDefinitionNode` ², `deleteDefinitionNode` ³ |
| Field templates | `listFieldTemplates`, `createFieldTemplate` ², `getFieldTemplate`, `updateFieldTemplate` ², `deleteFieldTemplate` ³ |
| Manuscript | `getManuscript`, `listManuscriptNotes`, `getManuscriptNote`, `planManuscriptNumbering`, `createManuscriptNote` ², `writeManuscriptNoteBody` ², `appendManuscriptNoteBody` ², `renameManuscriptNote` ², `moveManuscriptNote` ², `splitManuscriptNote` ², `mergeManuscriptNoteWithNext` ², `deleteManuscriptNote` ³, `replaceInProject` ², `exportManuscript` ² |
| Tasks | `listTasks`, `getTask`, `listDerivedTasks`, `createTask` ², `updateTask` ², `moveTask` ², `deleteTask` ³, `purgeArchivedTasks` ³ |
| Foreshadowing | `listForeshadowing`, `getForeshadowing`, `createForeshadowing` ², `updateForeshadowing` ², `addForeshadowingOccurrence` ², `updateForeshadowingOccurrence` ², `deleteForeshadowingOccurrence` ³, `deleteForeshadowing` ³ |
| Revisions | `listRevisions`, `getRevision`, `createRevision` ², `updateRevision` ², `acceptRevision` ², `discardRevision` ³ |
| Sticky notes | `listStickyNotes`, `getStickyNote`, `createStickyNote` ², `updateStickyNote` ², `deleteStickyNote` ³ |
| Statistics | `getWritingCounts`, `getProseStatistics`, `getWordFrequency`, `getSensitiveWords`, `getDialogue`, `listNoteDialogue` |
| Mentions | `getMentions`, `listNoteMentions` |
| Writing sessions | `listWritingDays`, `getWritingSpread`, `getWritingSession` |
| History | `getHistory` |
| Timeline | `getTimeline`, `createTimeline` ², `updateTimeline` ², `deleteTimeline` ³, `addTimelineTime` ², `removeTimelineTime` ³, `addTimelineRow` ², `updateTimelineRow` ², `deleteTimelineRow` ³, `placeTimelineScene` ², `removeTimelineScene` ³, `createTimelineView` ², `updateTimelineView` ², `deleteTimelineView` ³ |
| Beat sheets | `listBeatSheets`, `getBeatSheet`, `createBeatSheet` ², `updateBeatSheet` ², `deleteBeatSheet` ³, `addBeatSheetAct` ², `updateBeatSheetAct` ², `deleteBeatSheetAct` ³, `addBeat` ², `updateBeat` ², `deleteBeat` ³, `addBeatRow` ², `updateBeatRow` ², `deleteBeatRow` ³, `placeBeatSheetScene` ², `removeBeatSheetScene` ³, `listBeatSheetTemplates`, `saveBeatSheetTemplate` ², `deleteBeatSheetTemplate` ³ |
| Freeform | `listFreeformViews`, `getFreeformView`, `createFreeformView` ², `updateFreeformView` ², `deleteFreeformView` ³, `applyFreeformSteps` ², `exportCanvas` ² |
| Relationship graph | `getRelationshipGraph` |

### Planned

| Round | What it adds | Operations |
| --- | --- | --- |
| 5 | Environment | `getSettings`, `updateSettings`, `startWritingSession`, `stopWritingSession`, `listMentionIgnores`, `addMentionIgnore`, `removeMentionIgnore` |

Each operation also carries a tier in `x-snowflake-tier`: `core`, `extended` or `advanced`. A client that offers a short list of tools can start with the core ones.

## The folder

| Part | What it holds |
| --- | --- |
| `openapi.yaml` | The contract. The build turns it into an object, so no YAML is parsed in Obsidian. |
| `spec/` | Reading the contract: its operations, and the document the API serves. |
| `schema/` | Checking a call against the contract's shapes. |
| `dispatch.ts`, `queue.ts` | The path every call takes: found, allowed, checked, queued, answered. |
| `operations/` | The handlers, one file a group. |
| `dto/` | What the plugin's records look like to a caller. |
| `http/`, `cli/` | The two doors. Both hand a call to the same dispatcher. |
| `host.ts` | Everything the API asks of the plugin, by name. |

The code here imports no Node module and nothing of the plugin's screens. It reaches the plugin through `host.ts` alone, and reaches Node's `http` through the plugin's own desktop guard.

### Adding an operation

1. Describe it in `openapi.yaml`: its address, its shapes, `x-snowflake-access`, `x-snowflake-availability` and `x-snowflake-tier`.
2. Write its handler in `operations/` under the same name as its `operationId`.
3. If it changes something, give it a line in `tests/api/writes.test.ts`. That one line holds it to the access levels, the read-only and archived projects, and the rule that nothing is told as the author's typing.
4. Test what it does in `tests/api/`.

A test holds the handlers and the answered operations to the same list. An operation with no handler, or a handler with no operation, fails it.
