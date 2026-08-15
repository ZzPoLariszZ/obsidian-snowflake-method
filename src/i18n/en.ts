export const en = {
	'plugin.name': 'Snowflake Method',
	'common.cancel': 'Cancel',
	'common.close': 'Close',
	'common.create': 'Create',
	'common.save': 'Save',
	'common.retry': 'Retry',
	'common.open': 'Open',
	'common.add': 'Add',
	'common.working': 'Working…',
	'common.none': 'None',
	'common.optional': 'Optional',
	'common.recommended': 'Recommend',
	'commands.createProject': 'Create project',
	'commands.openDashboard': 'Open dashboard',
	'commands.openProjectManager': 'Open project manager',
	'commands.addCharacter': 'Add character',
	'commands.addScene': 'Add scene',
	'commands.openCharacterBase': 'Open character base',
	'commands.openSceneBase': 'Open scene base',
	'commands.openHealthChecker': 'Open health checker',
	'commands.openManuscriptStream': 'Open manuscript stream',
	'commands.migrateMemberNotes': 'Bring the project’s notes up to date',
	'commands.splitManuscriptSegment': 'Split manuscript note at the cursor',
	'commands.manuscriptNextSegment': 'Go to the next manuscript note',
	'commands.manuscriptPreviousSegment': 'Go to the previous manuscript note',
	'commands.manuscriptBackToAnchor': 'Go back to where the stream opened',
	'commands.manuscriptInsertAfter': 'Insert a manuscript note after this one',
	'commands.manuscriptInsertBefore': 'Insert a manuscript note before this one',
	'commands.closeManuscriptStream': 'Close manuscript stream',
	'commands.toggleManuscriptPath': 'Toggle note paths in the manuscript',
	'commands.manuscriptPathShown': 'Manuscript note paths are shown.',
	'commands.manuscriptPathHidden': 'Manuscript note paths are hidden.',
	'commands.toggleManuscriptSequence': 'Toggle order numbers in the manuscript',
	'commands.manuscriptSequenceShown': 'Manuscript order numbers are shown.',
	'commands.manuscriptSequenceHidden': 'Manuscript order numbers are hidden.',
	'commands.toggleManuscriptTypewriter': 'Toggle typewriter scrolling',
	'commands.manuscriptTypewriterOn': 'Typewriter scrolling is on.',
	'commands.manuscriptTypewriterOff': 'Typewriter scrolling is off.',
	'commands.setFocusMode.off': 'Set focus mode to off',
	'commands.setFocusMode.on': 'Set focus mode to on',
	'commands.setFocusMode.deep': 'Set focus mode to deep',
	'commands.setFocusMode.solo': 'Set focus mode to solo',
	'commands.manuscriptFocus.off': 'Focus mode is off.',
	'commands.manuscriptFocus.on': 'Focus mode is on.',
	'commands.manuscriptFocus.deep':
		'Focus mode is deep: the dashboard fades too.',
	'commands.manuscriptFocus.solo':
		'Focus mode is solo: nothing but the manuscript.',
	'commands.toggleManagedBoundaries': 'Toggle managed boundary protection',
	'commands.boundaryProtectionEnabled':
		'Managed boundary protection enabled.',
	'commands.boundaryProtectionDisabled':
		'Managed boundary protection disabled.',
	'commands.toggleReducedAnimations': 'Toggle reduced animations',
	'commands.reducedAnimationsEnabled': 'Reduced animations enabled.',
	'commands.reducedAnimationsDisabled': 'Reduced animations disabled.',
	'commands.toggleNotesBesideDashboard':
		'Toggle opening notes beside the dashboard',
	'commands.notesBesideDashboardEnabled':
		'Notes will open beside the dashboard.',
	'commands.notesBesideDashboardDisabled': 'Notes will open in tabs.',
	'commands.toggleTableProgressStatus': 'Toggle progress status in tables',
	'commands.tableProgressStatusShown': 'Tables show progress status.',
	'commands.tableProgressStatusHidden': 'Tables no longer show progress status.',
	'commands.toggleTableActionsColumn': 'Toggle the actions column in tables',
	'commands.tableActionsColumnShown': 'Tables show an actions column.',
	'commands.tableActionsColumnHidden':
		'Row actions sit behind one menu at the end of the row.',
	'commands.toggleCreateFromField':
		'Toggle opening a form for new notes from a field',
	'commands.createFromFieldForm': 'New notes from a field open their form.',
	'commands.createFromFieldNow': 'New notes from a field are created directly.',
	'settings.projectRoot.name': 'Project root folder',
	'settings.projectRoot.desc':
		'Vault-relative folder path for Snowflake projects.',
	'settings.projectRoot.placeholder': 'Vault root (/)',
	'settings.uiLocale.name': 'Interface language',
	'settings.uiLocale.desc': 'Language used by the plugin interface.',
	'settings.locale.project': 'Follow project',
	'settings.locale.system': 'Follow Obsidian',
	'settings.projectLocale.name': 'Default project language',
	'settings.projectLocale.desc': 'Language used for new projects.',
	'settings.split.name': 'Open notes beside the dashboard',
	'settings.split.desc':
		'Open Snowflake notes in one pane beside the dashboard.',
	'settings.protectBoundaries.name': 'Protect managed boundaries',
	'settings.protectBoundaries.desc':
		'Protect section markers from accidental edits.',
	'settings.createFromField.name': 'New notes from a field',
	'settings.createFromField.desc':
		'Behaviour when creating a note by typing its name into a field.',
	'settings.createFromField.form': 'Open its form',
	'settings.createFromField.now': 'Create directly',
	'settings.reduceMotion.name': 'Reduce animations',
	'settings.reduceMotion.desc': 'Use static visual effects instead of animations.',
	'settings.tableActionsColumn.name': 'Show the actions column in tables',
	'settings.tableActionsColumn.desc':
		"Show each row's actions in a separate column.\nIf off, the action menu appears at the end of the row when focused.",
	'settings.tableProgressStatus.name': 'Show progress status in tables',
	'settings.tableProgressStatus.desc':
		"Show each note's progress status under its name in the tables.",
	'settings.manuscript.heading': 'Manuscript stream',
	'settings.manuscriptWindow.name': 'Notes to keep loaded',
	'settings.manuscriptWindow.desc':
		'Notes kept loaded around the current one.\nHigher values scroll further but use more memory.',
	'settings.manuscriptPath.name': 'Show note paths',
	'settings.manuscriptPath.desc': 'Show each note’s vault path above its text.',
	'settings.manuscriptSequence.name': 'Show order numbers',
	'settings.manuscriptSequence.desc':
		'Show the number that sets each note’s place.',
	'settings.manuscriptTypewriter.name': 'Typewriter scrolling',
	'settings.manuscriptTypewriter.desc':
		'Keep the current line at the middle of the page.',
	'settings.manuscriptFocus.name': 'Focus mode',
	'settings.manuscriptFocus.levelOff': 'Off',
	'settings.manuscriptFocus.levelOn': 'On',
	'settings.manuscriptFocus.levelDeep': 'Deep',
	'settings.manuscriptFocus.levelSolo': 'Solo',
	'settings.manuscriptFocus.off': 'Nothing is faded.',
	'settings.manuscriptFocus.on':
		'All but the current paragraph fades.\nThe dashboard stays bright.',
	'settings.manuscriptFocus.deep': 'Same as on, but the dashboard fades as well.',
	'settings.manuscriptFocus.solo':
		'Only the manuscript, in full screen.\nEverything returns when you leave.',
	'dashboard.title': 'Snowflake Method',
	'dashboard.project': 'Project',
	'dashboard.projectSwitcher': 'Project switcher',
	'dashboard.manageProjects': 'Manage projects…',
	'dashboard.noProjects': 'No Snowflake projects found.',
	'dashboard.chooseProject': 'Choose a project',
	'dashboard.noProject': 'Create or open a Snowflake project to begin.',
	'dashboard.progress': 'Progress',
	'dashboard.currentStep': 'Current step',
	'dashboard.repair': 'Repair project structure',
	'dashboard.readOnly':
		'This project uses a newer schema and is open read-only. Update the plugin before editing it.',
	'dashboard.readOnlySchema':
		'This project uses an unsupported newer schema and is open read-only.',
	'dashboard.readOnlyTitle': 'Newer project format',
	'dashboard.steps': 'Steps',
	'dashboard.emptyTitle': 'No projects',
	'dashboard.emptyDesc':
		'Open the project manager to create your first project',
	'dashboard.openArtifact': 'Open step note',
	'status.not-started': 'Not started',
	'status.in-progress': 'In progress',
	'status.in-revision': 'In revision',
	'status.complete': 'Complete',
	'status.skipped': 'Skipped',
	'status.label': 'Status',
	'steps.optional': 'Optional step',
	'actions.newProject': 'New project',
	'actions.repair': 'Check',
	'actions.repairItem': 'Repair',
	'actions.addCharacter': 'Add character',
	'actions.addScene': 'Add scene',
	'actions.addMoreCharacters': 'Add more characters…',
	'actions.addMoreScenes': 'Add more scenes…',
	'actions.openBase': 'Open base',
	'actions.restoreBase': 'Restore base',
	'modal.restoreBase.title': 'Restore this base?',
	'modal.restoreBase.description':
		'The file is rewritten from the current template. Views and arrangements you added in it are replaced.',
	'modal.restoreBase.action': 'Restore',
	'actions.openNote': 'Open note',
	'actions.edit': 'Edit',
	'actions.delete': 'Delete',
	'actions.merge': 'Merge',
	'actions.discardDraft': 'Discard draft and load latest',
	'actions.setStatus': 'Set status',
	'actions.moveUp': 'Move up',
	'actions.moveDown': 'Move down',
	'actions.move': 'Move',
	'fields.oneSentenceSummary': 'One-sentence summary',
	'fields.oneSentenceSummaryPlaceholder': 'Write the story’s one-sentence summary.',
	'fields.oneSentenceSummaryCount': 'Current length: {count} {unit}.',
	'step1.hints.title': 'Hints for one-sentence summary',
	'step1.hints.shorter':
		'Shorter is better. Try for fewer than 15 words.',
	'step1.hints.characters':
		'Focus on one or two characters but no character names.',
	'step1.hints.pictures':
		'Tie together the big picture and the personal picture.',
	'step1.hints.imagination':
		'Hint is helpful. But don’t limit your imagination.',
	'step1.hints.revision':
		'Don’t strive for perfection. You can revise at any time.',
	'step2.hints.title': 'Hints for one-paragraph summary',
	'step2.hints.structure':
		'Try a four-part structure, a three-act structure, or the Hero’s Journey.',
	'step2.hints.sentences':
		'Let each sentence handle one part of the structure.',
	'step2.sourceSummary.title': 'One-sentence summary',
	'step2.sourceSummary.empty': 'Complete step 1 to see the summary here.',
	'step2.description.title': 'Description',
	'step2.description.description':
		'Optionally write a brief description of your novel.',
	'step1.targetReaders.title': 'Before you begin: define your target readers',
	'step1.targetReaders.intro':
		'Decide what kind of novel you want to write and clearly define your target readers.',
	'step1.targetReaders.questions': 'Answer these questions',
	'fields.genre': 'My novel’s genre is',
	'fields.audienceAppeal':
		'This kind of story will delight my target readers because:',
	'fields.audienceReasonsPlaceholder': 'List two or three reasons.',
	'step1.candidateTitles.title': 'Candidate titles',
	'step1.candidateTitles.description':
		'You can list up to six candidate titles for your novel.',
	'fields.candidateTitle': 'Candidate title {number}',
	'fields.oneParagraphSummary': 'One-paragraph summary',
	'fields.oneParagraphSummaryPlaceholder':
		'Expand your one-sentence summary into a full paragraph.',
	'fields.description': 'Description',
	'fields.descriptionPlaceholder': 'Write a brief description of your novel.',
	'table.name': 'Name',
	'table.category': 'Category',
	'table.description': 'Description',
	'table.oneSentenceStoryline': 'One-sentence storyline',
	'table.goal': 'Goal',
	'table.conflict': 'Conflict',
	'table.actions': 'Actions',
	'table.options': 'More options for {name}',
	'table.order': 'Order',
	'table.searchCharacters': 'Search characters',
	'table.searchScenes': 'Search scenes',
	'table.filter': 'Filter',
	// "Progress status" in full: a project also has world status records, and a
	// column headed "Status" would be read as those.
	'table.progressStatus': 'Progress status',
	'table.filterConfirm': 'Confirm',
	'table.filterReset': 'Reset',
	'table.filterAllStatuses': 'All progress',
	'table.filterAllCategories': 'All categories',
	'table.filterAllPov': 'All points of view',
	'table.filterAllTimes': 'All times',
	'table.filterAllLocations': 'All locations',
	'table.filterAllCast': 'All characters',
	'table.filteredCount': '{shown} / {total}',
	'table.moveToPosition': 'Move to position…',
	'table.moveAfter': 'Move after…',
	'table.insertCharacterAfter': 'Insert character after',
	'table.insertSceneAfter': 'Insert scene after',
	'table.sceneName': 'Name',
	'table.scenePov': 'POV character',
	'table.sceneTime': 'Time',
	'table.sceneLocation': 'Location',
	'table.sceneCharacters': 'Characters',
	'table.pov': 'POV',
	'characters.empty': 'No characters',
	'characters.hints.title': 'Hints for major character sheet',
	'characters.hints.reorder': 'Drag to reorder the characters. The row menu moves one to an exact position.',
	'characters.hints.revision':
		'It’s perfectly fine to revisit steps 1 and 2. Your characters may teach you something new about your story.',
	'scenes.empty': 'No scenes',
	'messages.projectCreated': 'Created Snowflake project “{name}”.',
	'messages.projectRenamed': 'Renamed project to “{name}”.',
	'messages.projectTrashed': 'Moved project “{name}” to the trash.',
	'messages.projectRepaired': 'Project structure repaired.',
	'messages.repairSummary':
		'Repair finished: {created} created, {repaired} repaired, {conflicts} conflicts.',
	'messages.healthCheckPassed': 'Health check passed. No problems were found.',
	'messages.migrateMemberNotesDone':
		'Brought {migrated} note(s) up to date. Skipped {skipped}.',
	'migrate.membersTitle': 'Older project format',
	'migrate.membersCallout':
		'{count} note(s) from an older format can be brought up to date.',
	'migrate.membersAction': 'Update',
	'messages.healthCheckIssues': 'Health check found {count} problem(s).',
	'messages.characterCreated': 'Created character “{name}”.',
	'messages.characterDeleted': 'Moved character note to the trash.',
	'messages.sceneCreated': 'Created scene “{name}”.',
	'messages.sceneDeleted': 'Moved scene note to the trash.',
	'messages.canvasCreated': 'Created scene canvas “{name}”.',
	'messages.stepChanged': 'Step {step} status changed to {status}.',
	'messages.noCurrentProject': 'Open a Snowflake project first.',
	'errors.unknown': 'Something went wrong.',
	'errors.dashboard': 'The Snowflake dashboard could not be loaded.',
	'errors.readOnly': 'This project is read-only.',
	'errors.invalidProject': 'This is not a valid Snowflake project.',
	'errors.fileMissing': 'The note “{path}” could not be found.',
	'errors.projectExists': 'A project named “{name}” already exists.',
	'errors.characterExists':
		'A character named “{name}” already exists in this project.',
	'errors.sceneExists': 'A scene named “{name}” already exists in this project.',
	'errors.markerMissing':
		'The managed section markers are missing. Repair the project before editing this section.',
	'errors.concurrentChange':
		'The note changed while it was being updated. Review the latest version and try again.',
	'editor.managedSection.guide':
		'Write inside the highlighted section. Keep its Snowflake boundary markers unchanged.',
	'editor.managedSection.placeholder': 'Write here…',
	'editor.managedSection.boundaryTooltip':
		'Snowflake boundary marker. Do not edit or delete it.',
	'editor.managedSection.protectedNotice':
		'Snowflake section boundaries are protected.',
	'editor.managedSection.generatedNotice':
		'The overview is generated from the note properties. Use the dashboard to edit (recommended) or modify the properties above directly.',
	'editor.managedSection.recordNotice':
		'These records are managed by the plugin. Open the note in the dashboard to change them.',
	'editor.managedSection.unlock': 'Unlock boundaries',
	'editor.managedSection.relock': 'Relock boundaries',
	'editor.managedSection.unlockConfirmTitle':
		'Unlock Snowflake boundaries?',
	'editor.managedSection.unlockConfirmDescription':
		'Boundary markers let the dashboard find and safely update each section. Unlock them only if you understand the Markdown data contract.',
	'editor.managedSection.unlockConfirmAction': 'Unlock',
	'editor.managedSection.switchToSource': 'Switch to source mode',
	'editor.managedSection.damagedTitle':
		'Snowflake section boundary needs repair',
	'editor.managedSection.damagedDescription':
		'One or more boundary markers were changed. The dashboard cannot safely update this section until it is repaired.',
	'editor.managedSection.navigationUnavailable':
		'The safe writing section could not be located. Repair the project before editing this section.',
	'editor.managedSection.navigationDamaged':
		'The safe writing section is damaged. The affected boundary marker has been highlighted for manual review.',
	'editor.managedSection.repair': 'Check project health',
	'editor.managedSection.openNote': 'Open',
	'editor.managedSection.readOnlyNewerSchema':
		'This section uses a newer Snowflake schema and is read-only.',
	'editor.managedSection.repairUnchanged':
		'The managed section is healthy and was left unchanged.',
	'editor.managedSection.documentLabel': 'Managed document',
	'editor.managedSection.repairConflict':
		'No automatic changes were made. Review this managed structure manually.',
	'projectStructure.damagedTitle': 'Snowflake project needs repair',
	'projectHealth.needsAttention': 'This project needs attention',
	'projectHealth.dashboardStructureSummary':
		'Run the health check to review project issues and available actions.',
	'projectHealth.dashboardSectionSummary':
		'Run the health check to review this step and available actions.',
	'projectStructure.damagedDescription':
		'Required project metadata, folders, or notes are missing or invalid. Check the listed items before continuing.',
	// Every entry in the health report is read the same way: the first line says
	// what is wrong about this one note, subject first, with the names it found
	// after a colon; the second says what to do about it, the action first and
	// the reason after. Nothing in the first line explains, and nothing in the
	// second states the problem again.
	'projectStructure.issue.missing-metadata-field':
		'This project note is missing a property:',
	'projectStructure.action.missing-metadata-field':
		'Repairing here writes it back.',
	'projectStructure.issue.invalid-metadata-field':
		'This project note holds a property this plugin cannot read:',
	'projectStructure.action.invalid-metadata-field':
		'Repairing here writes a value it can read.',
	'projectStructure.issue.missing-directory': 'This project folder is missing.',
	'projectStructure.action.missing-directory': 'Repairing here creates it.',
	'projectStructure.issue.missing-artifact': 'This project note is missing.',
	'projectStructure.action.missing-artifact':
		'Repairing here writes it from the template for its step.',
	'projectStructure.issue.missing-system-template':
		'This system template is missing.',
	'projectStructure.action.missing-system-template':
		'Repairing here writes it again.',
	'projectStructure.issue.missing-base': 'This project base is missing.',
	'projectStructure.action.missing-base': 'Repairing here writes it again.',
	'projectStructure.issue.missing-definition-node':
		'This category, status, or relationship entry has no note of its own.',
	'projectStructure.action.missing-definition-node':
		'Repairing here creates it.\nLinks point at that note rather than at the folder.',
	'projectStructure.issue.unresolved-definition-link':
		'This note names an entry the project does not have:',
	'projectStructure.action.unresolved-definition-link':
		'Repairing here creates what the links name.\nA folder may have been renamed or removed by hand.',
	'projectStructure.issue.stale-definition-alias':
		'This note shows a name that is no longer where it points:',
	'projectStructure.action.stale-definition-alias':
		'Repairing here rewrites the names from the links.\nRenaming a folder updates links but not the name they show.',
	'projectStructure.issue.mismatched-character-title':
		'The file name or heading no longer matches the character name.',
	'projectStructure.action.mismatched-character-title':
		'Repairing here brings both to the stored name.\nTo rename the character, edit it in the character table.',
	'projectStructure.issue.mismatched-scene-title':
		'The file name or heading no longer matches the scene name.',
	'projectStructure.action.mismatched-scene-title':
		'Repairing here brings both to the stored name.\nTo rename the scene, edit it in the scene table.',
	'projectStructure.issue.mismatched-entity-title':
		'The file name or heading no longer matches the name of this note.',
	'projectStructure.action.mismatched-entity-title':
		'Repairing here brings both to the stored name.\nTo rename it, edit it in the worldbuilding table.',
	'projectStructure.issue.mismatched-project-folder':
		'The folder name no longer matches the project name.',
	'projectStructure.action.mismatched-project-folder':
		'Repairing here renames the folder.\nTo rename the project, use the project manager.',
	'projectStructure.issue.invalid-system-template':
		'This system template is not the one this project format uses.',
	'projectStructure.action.invalid-system-template':
		'Repairing here writes the current one.',
	'projectStructure.issue.invalid-artifact-metadata':
		'This note no longer says what it is.',
	'projectStructure.action.invalid-artifact-metadata':
		'Repairing here writes back the properties that make it readable.',
	'projectStructure.issue.dangling-scene-pov':
		'This scene is told from a character the project no longer has:',
	'projectStructure.action.dangling-scene-pov':
		'Edit the scene and choose another point of view.\nLeaving it empty would say less than you meant, so it is left as it is.',
	'projectStructure.issue.dangling-time-span':
		'This period runs from or to a time note that is gone:',
	'projectStructure.action.dangling-time-span':
		'Edit it and choose the moment that takes its place.\nA period is written between two moments.',
	'projectStructure.issue.dangling-record-link':
		'A record here names a note that is gone:',
	'projectStructure.action.dangling-record-link':
		'Edit the note to say what it says now.\nA record is a sentence you wrote, so it is left as it is.',
	'projectStructure.issue.unlinked-path':
		'This note stores plain text where a link belongs:',
	'projectStructure.action.unlinked-path':
		'Repairing here writes them as links.\nOnly a link is kept up to date when the note it names is renamed.',
	'projectStructure.issue.incomplete-link':
		'This note names another by part of its path:',
	'projectStructure.action.incomplete-link':
		'Repairing here writes the whole path.\nA short name stops being unique as soon as it is reused.',
	'projectStructure.issue.foreign-link':
		'This note links into another project:',
	'projectStructure.action.foreign-link':
		'Repairing here takes them off the list.',
	'projectStructure.issue.missing-link':
		'This note links to a note that is gone:',
	'projectStructure.action.missing-link':
		'Repairing here takes them off the list.',
	'projectStructure.issue.extension-in-link':
		'These notes store links that still write “.md”:',
	'projectStructure.action.extension-in-link':
		'Repairing here rewrites them the way Obsidian writes a link.',
	'projectStructure.issue.missing-manuscript-sequence':
		'These manuscript notes have no place in the reading order:',
	'projectStructure.action.missing-manuscript-sequence':
		'Repairing here numbers the manuscript in the order it reads now.\nUntil then they are read last.',
	'projectStructure.issue.invalid-manuscript-sequence':
		'These manuscript notes store a place that is not a whole number:',
	'projectStructure.action.invalid-manuscript-sequence':
		'Repairing here numbers the manuscript in the order it reads now.',
	'projectStructure.issue.duplicate-manuscript-sequence':
		'These manuscript notes claim the same place:',
	'projectStructure.action.duplicate-manuscript-sequence':
		'Repairing here numbers the manuscript in the order it reads now.\nUntil then, which of them reads first is chance.',
	'editor.managedSection.issue.missing':
		'Both boundary markers are missing.',
	'editor.managedSection.issue.missing-start':
		'The opening boundary marker is missing.',
	'editor.managedSection.issue.missing-end':
		'The closing boundary marker is missing.',
	'editor.managedSection.issue.duplicate-start':
		'The opening boundary marker appears more than once.',
	'editor.managedSection.issue.duplicate-end':
		'The closing boundary marker appears more than once.',
	'editor.managedSection.issue.reversed':
		'The closing boundary appears before the opening boundary.',
	'editor.managedSection.issue.overlap':
		'This section overlaps or is nested inside another managed section.',
	'editor.managedSection.issue.unknown-section':
		'This Snowflake section is not recognized by this plugin version.',
	'editor.managedSection.name.genre': 'Novel genre',
	'editor.managedSection.name.audience-reason-1': 'Target reader reasons',
	'editor.managedSection.name.one-sentence-summary': 'One-sentence summary',
	'editor.managedSection.name.candidate-title-1': 'Candidate title 1',
	'editor.managedSection.name.candidate-title-2': 'Candidate title 2',
	'editor.managedSection.name.candidate-title-3': 'Candidate title 3',
	'editor.managedSection.name.candidate-title-4': 'Candidate title 4',
	'editor.managedSection.name.candidate-title-5': 'Candidate title 5',
	'editor.managedSection.name.candidate-title-6': 'Candidate title 6',
	'editor.managedSection.name.one-paragraph-summary': 'One-paragraph summary',
	'editor.managedSection.name.description': 'Description',
	'editor.managedSection.name.plot-synopsis': 'Plot synopsis',
	'editor.managedSection.name.long-synopsis': 'Long synopsis',
	'editor.managedSection.name.character-fields': 'Character overview',
	'editor.managedSection.name.scene-fields': 'Scene overview',
	'editor.managedSection.name.one-paragraph-storyline':
		'One-paragraph storyline',
	'editor.managedSection.name.character-synopsis': 'Character synopsis',
	'editor.managedSection.name.character-profile': 'Character profile',
	'editor.managedSection.name.scene-conflict': 'Scene conflict',
	'editor.managedSection.name.scene-events': 'Specific events',
	'editor.managedSection.name.scene-planning': 'Scene planning',
	'editor.managedSection.name.entity-fields': 'Overview',
	'editor.managedSection.name.world-status': 'World status',
	'editor.managedSection.name.relationships': 'Relationships',
	'editor.managedSection.name.entity-notes': 'Notes',
	'editor.managedSection.name.definition-fields': 'Overview',
	'common.remove': 'Remove',
	'dashboard.worldbuilding': 'Worldbuilding',
	'worldbuilding.kind.time': 'Time',
	'worldbuilding.kind.location': 'Location',
	'worldbuilding.kind.item': 'Item',
	'worldbuilding.kind.time.description':
		'Record the moments and periods your story spans, from a single date to a whole era.',
	'worldbuilding.kind.location.description':
		'Record the places your story visits, from a single room to a whole country.',
	'worldbuilding.kind.item.description':
		'Record the objects your story follows, such as what a character carries, seeks or loses.',
	'worldbuilding.add.time': 'Add time',
	'worldbuilding.add.location': 'Add location',
	'worldbuilding.add.item': 'Add item',
	'worldbuilding.addMore.time': 'Add more time…',
	'worldbuilding.addMore.location': 'Add more locations…',
	'worldbuilding.addMore.item': 'Add more items…',
	'worldbuilding.empty.time': 'No time',
	'worldbuilding.empty.location': 'No locations',
	'worldbuilding.empty.item': 'No items',
	'worldbuilding.search.time': 'Search time',
	'worldbuilding.search.location': 'Search locations',
	'worldbuilding.search.item': 'Search items',
	'worldbuilding.insertAfter.time': 'Insert time after',
	'worldbuilding.insertAfter.location': 'Insert location after',
	'worldbuilding.insertAfter.item': 'Insert item after',
	'modal.entity.title.time': 'Add time',
	'modal.entity.title.location': 'Add location',
	'modal.entity.title.item': 'Add item',
	'modal.entity.editTitle.time': 'Edit time',
	'modal.entity.editTitle.location': 'Edit location',
	'modal.entity.editTitle.item': 'Edit item',
	'modal.entity.name': 'Name',
	'modal.entity.nameRequired': 'A name is required.',
	'modal.entity.nameTaken': 'Another entry of this kind already uses this name.',
	'form.progressStatus': 'Progress status',
	'form.aliases': 'Aliases',
	'form.aliases.placeholder': 'Type an alias and press enter',
	'form.aliases.remove': 'Remove {name}',
	'form.category': 'Category',
	'form.category.create': 'Create category "{name}"',
	'form.category.remove': 'Remove {name}',
	'form.referenceMissing': 'No longer in this project: {name}',
	// One set per vocabulary: the dialog that adds an entry is the same for
	// all three, and only its wording says which one is being added to. The
	// examples stay in lower case because Obsidian asks every string it shows
	// to read as a sentence, whatever case the entries themselves are given.
	'form.definition.desc.category':
		'Categories can have levels which are separated by a slash,\ne.g., race/elf puts elf under race (can have at most 7 levels).',
	'form.definition.desc.world-status':
		'Statuses can have levels which are separated by a slash,\ne.g., health/injured puts injured under health (can have at most 7 levels).',
	'form.definition.desc.relationship':
		'Relationships can have levels which are separated by a slash,\ne.g., family/father puts father under family (can have at most 7 levels).',
	'form.definition.placeholder.category':
		'Search or create a category… (e.g., elf or race/elf)',
	'form.definition.placeholder.world-status':
		'Search or create a status… (e.g., injured or health/injured)',
	'form.definition.placeholder.relationship':
		'Search or create a relationship… (e.g., father or family/father)',
	'modal.definition.title.category': 'Add category',
	'modal.definition.title.world-status': 'Add status',
	'modal.definition.title.relationship': 'Add relationship',
	'modal.definition.name.category': 'Category',
	'modal.definition.name.world-status': 'Status',
	'modal.definition.name.relationship': 'Relationship',
	'modal.category.description': 'Description',
	'dashboard.definition.category': 'Category',
	'dashboard.definition.world-status': 'World status',
	'dashboard.definition.relationship': 'Relationship',
	'dashboard.definition.category.description':
		'Name the categories notes are filed under.',
	'dashboard.definition.world-status.description':
		"Name the world states, such as a character's health or growth stage.",
	'dashboard.definition.relationship.description':
		'Name the relationship between notes, such as family or allegiance.',
	'definition.kind.character': 'Character',
	'definition.kind.scene': 'Scene',
	'definition.add.category': 'Add category',
	'definition.add.world-status': 'Add status',
	'definition.add.relationship': 'Add relationship',
	'definition.pickKind': 'What kind?',
	'definition.addMore.category': 'Add more categories…',
	'definition.addMore.world-status': 'Add more statuses…',
	'definition.addMore.relationship': 'Add more relationships…',
	'definition.addChild': 'Add child',
	'definition.create': 'Create',
	'definition.empty.category': 'No categories',
	'definition.empty.world-status': 'No statuses',
	'definition.empty.relationship': 'No relationships',
	'definition.countLabel': '{count} entries',
	'definition.missingEntry':
		'The project has no such entry, but notes still name it.',
	'definition.search': 'Search entries',
	'definition.noMatches': 'No entries match.',
	'definition.options': 'More options for {name}',
	'definition.inspector.empty': 'Choose one entry to inspect',
	'definition.inspector.path': 'Path',
	'definition.inspector.description': 'Description',
	'definition.inspector.noDescription': 'No description',
	'definition.inspector.usedBy': 'Used by',
	'definition.inspector.unused': 'No notes',
	'definition.inspector.viewAll': 'View all {count}',
	'definition.inspector.showFewer': 'Show fewer',
	'definition.inspector.goTo': 'Go to {name}',
	'modal.definition.edit.category': 'Edit category',
	'modal.definition.edit.world-status': 'Edit status',
	'modal.definition.edit.relationship': 'Edit relationship',
	'modal.definition.edit.scope': 'Renaming only works for the current level.',
	'form.description': 'Description',
	'form.timeKind': 'Type',
	'form.timeKind.point': 'Time point',
	'form.timeKind.period': 'Time period',
	'form.timeStart': 'Start',
	'form.timeStart.placeholder': 'Search or create a time point…',
	'form.timeEnd': 'End',
	'form.timeEnd.placeholder': 'Search or create a time point…',
	'form.description.placeholder': 'Describe what this is',
	'form.worldStatus': 'World status',
	'form.relationships': 'Relationships',
	'form.record.addStatus': 'Add more status…',
	'form.record.addRelationship': 'Add more relationships…',
	'form.record.status': 'Status',
	'form.record.relationship': 'Relationship',
	'form.record.label': 'Label',
	'form.record.labelPlaceholder': 'Search, or type a new one',
	'form.record.createLabel': 'Create "{name}"',
	'form.record.target': 'Target',
	'form.record.chooseTarget': 'Choose a target…',
	'form.record.more': 'Add more context…',
	'form.record.pickGroup': 'What kind?',
	'form.record.pickEntity': 'Which {group}?',
	'form.record.createEntity': 'Create "{name}"',
	'form.record.removeRecord': 'Remove this record',
	'form.record.reorder': 'Drag to reorder',
	'form.record.removeLine': 'Remove {name}',
	'form.record.at': 'At',
	'form.record.when': 'When',
	'form.record.with': 'With',
	'form.record.span': 'Between',
	'form.record.reference': 'Note',
	'form.record.from': 'From',
	'form.record.to': 'To',
	'form.record.value': 'Value',
	'form.record.valuePlaceholder': 'Optional value or description…',
	'form.record.halfSpan': 'A time span needs both its from and its to.',
	'form.group.character': 'Character',
	'form.group.scene': 'Scene',
	'form.group.time-point': 'Time point',
	'form.group.time-period': 'Time period',
	'form.group.location': 'Location',
	'form.group.item': 'Item',
	'form.period.halfSpan':
		'A time period needs both its start and its end, or neither.',
	'form.definition.invalid': 'The name "{name}" cannot be used in a path.',
	'form.definition.tooDeep': 'A path can have at most {count} levels.',
	'form.definition.taken': 'The name "{name}" is already taken at this level.',
	'editor.managedSection.issue.unrecognized-record':
		'A line in this section does not read as a record. It stays exactly as written, and the dashboard cannot edit it.',
	'messages.entityCreated': 'Created “{name}”.',
	'messages.entityDeleted': 'Moved the note to the trash.',
	'messages.definitionDeleted': 'Moved the entry to the trash.',
	'errors.entityExists': 'This kind already has an entry named “{name}”.',
	'modal.project.title': 'Create Snowflake project',
	'modal.project.name': 'Project name',
	'modal.project.namePlaceholder': 'My novel',
	'modal.project.language': 'Project language',
	'modal.project.nameRequired': 'Enter a project name.',
	'modal.project.nameTaken': 'Another project already has this name.',
	'modal.projectManager.title': 'Manage Snowflake projects',
	'modal.projectManager.projects': 'Projects',
	'modal.projectManager.version': 'Version {version}',
	'modal.projectManager.createTitle': 'Create new project',
	'modal.projectManager.createDesc': 'Create a new Snowflake Method project.',
	'modal.projectManager.projectRoot': 'Set project root folder',
	'modal.projectManager.projectRootDesc':
		'Vault-relative folder path for Snowflake projects.',
	'modal.projectManager.projectRootPlaceholder': 'Vault root (/)',
	'modal.projectManager.projectRootInvalid':
		'Enter a valid vault-relative folder path.',
	'modal.projectManager.projectRootConflict':
		'A file already exists at “{path}”.',
	'modal.projectManager.language': 'Choose project language',
	'modal.projectManager.languageDesc':
		'Used for this project manager and new projects.',
	'modal.projectManager.projectOptions': 'More options for {name}',
	'modal.projectManager.rename': 'Rename project…',
	'modal.projectManager.renameTitle': 'Rename project',
	'modal.projectManager.openMetadata': 'Open project metadata',
	'modal.projectManager.trash': 'Move project to trash',
	'modal.character.title': 'Add character',
	'modal.character.editTitle': 'Edit character',
	'modal.character.name': 'Name',
	'modal.character.oneSentenceStoryline': 'One-sentence storyline',
	'modal.character.oneSentenceStorylinePlaceholder':
		'Summarize the entire story in one sentence from this character’s point of view.',
	'modal.character.oneParagraphStoryline': 'One-paragraph storyline',
	'modal.character.oneParagraphStorylinePlaceholder':
		'Expand the one-sentence storyline into a full paragraph.',
	'modal.character.motivation': 'Motivation',
	'modal.character.motivationPlaceholder':
		'What does he/she want abstractly?',
	'modal.character.goal': 'Goal',
	'modal.character.goalPlaceholder': 'What does he/she want concretely?',
	'modal.character.conflict': 'Conflict',
	'modal.character.conflictPlaceholder':
		'What prevents him/her from reaching this goal?',
	'modal.character.growth': 'Growth',
	'modal.character.growthPlaceholder':
		'What will he/she learn and how will he/she change?',
	'modal.character.nameRequired': 'Enter a character name.',
	'modal.character.nameTaken': 'Another character already has this name.',
	'modal.scene.title': 'Add scene',
	'modal.scene.editTitle': 'Edit scene',
	'modal.scene.name': 'Name',
	'modal.scene.time': 'Time',
	'modal.scene.time.choose': 'Choose or create a time…',
	'modal.scene.location': 'Location',
	'modal.scene.location.choose': 'Choose or create a location…',
	'modal.scene.characters': 'Characters',
	'modal.scene.conflict': 'Conflict',
	'modal.scene.pov': 'Point-of-view character',
	'modal.deleteMember.title': 'Delete “{name}”?',
	'modal.deleteMember.description':
		'Deleting “{name}” affects {count} other note(s).',
	'modal.deleteMember.needsDecision':
		'These notes will need another note in its place:',
	'modal.deleteMember.listed': '“{name}” will be removed from:',
	'modal.deleteMember.records': 'These notes mention it in their records:',
	'modal.deleteDefinition.title': 'Delete “{name}”?',
	'modal.deleteDefinition.description':
		'The entry and its note are moved to the trash.',
	'modal.deleteDefinition.subtree':
		'The entry and {count} more under it are moved to the trash.',
	'modal.deleteDefinition.listed': 'It will be removed from the categories of:',
	'modal.deleteDefinition.records':
		'These notes mention it in their records, and the health check will point each one out:',
	'modal.mergeSegments.title': 'Merge notes',
	'modal.mergeSegments.question':
		'Are you sure you want to merge “{removed}” into “{kept}”?',
	'modal.mergeSegments.consequence':
		'Its text is kept. Only the note itself is removed.',
	'modal.moveToPosition.title': 'Move to position',
	'modal.moveToPosition.position': 'Position (1 to {total})',
	'modal.moveToPosition.invalid': 'Enter a number from 1 to {total}.',
	'modal.moveAfter.placeholder': 'Type to find the entry to move after',
	'modal.scene.povChoose': 'Search or create a POV…',
	'modal.scene.createCharacter': 'Create character “{name}”',
	'modal.scene.povOmniscient': 'Omniscient',
	'table.povMissing': 'Missing character: {name}',
	'table.referenceMissing': 'Missing note: {name}',
	'modal.scene.povMultiple': 'Multi-POV',
	'modal.scene.povRequired': 'Choose a point of view.',
	'modal.scene.events': 'Specific events',
	'modal.scene.timePlaceholder': 'When does this scene take place?',
	'modal.scene.locationPlaceholder': 'Where does this scene take place?',
	'modal.scene.charactersPlaceholder': 'Who appears in this scene?',
	'modal.scene.charactersEmpty': 'No existing characters',
	'modal.scene.removeCharacter': 'Remove {name}',
	'modal.scene.conflictPlaceholder': 'What conflict drives this scene?',
	'modal.scene.eventsPlaceholder': 'What specifically happens in this scene?',
	'modal.scene.nameRequired': 'Enter a scene name.',
	'modal.scene.nameTaken': 'Another scene already has this name.',
	'steps.titleFormat': '{number}. {title}',
	'steps.number.1': '1',
	'steps.number.2': '2',
	'steps.number.3': '3',
	'steps.number.4': '4',
	'steps.number.5': '5',
	'steps.number.6': '6',
	'steps.number.7': '7',
	'steps.number.8': '8',
	'steps.number.9': '9',
	'steps.number.10': '10',
	'steps.1.title': 'One-sentence summary',
	'steps.1.description': 'Summarize the whole story in one sentence.',
	'steps.2.title': 'One-paragraph summary',
	'steps.2.description': 'Expand one-sentence summary to a full paragraph.',
	'steps.3.title': 'Major character sheet',
	'steps.3.description':
		'Provide a storyline for each major character.\nRecord their motivation, goal, conflict, and growth.',
	'steps.4.title': 'Plot synopsis',
	'steps.4.description':
		'Expand each sentence in the one-paragraph summary into a full paragraph.',
	'step4.sourceSummary.title': 'One-paragraph summary',
	'step4.sourceSummary.empty':
		'Complete step 2 to see the one-paragraph summary here.',
	'step4.hints.title': 'Hints for plot synopsis',
	'step4.hints.openNote': 'Open the separate note to edit your plot synopsis.',
	'step4.hints.structure':
		'Each paragraph can use a four-part structure or a three-act structure.',
	'step4.hints.paragraphs':
		'Let each paragraph develop one part of the story, with each ending leading naturally into the next paragraph.',
	'step4.hints.revision':
		'It’s perfectly fine to revisit steps 1 to 3. New discoveries are always useful.',
	'steps.5.title': 'Character synopsis',
	'steps.5.description':
		'Retell the story from each character’s point of view.\nExplain how their motivation, goal, conflict, and growth fit into the story.',
	'step5.hints.title': 'Hints for character synopsis',
	'step5.hints.reorder': 'Drag to reorder the characters. The row menu moves one to an exact position.',
	'step5.hints.openNote':
		'Open the separate note to edit the character synopsis.',
	'step5.hints.expand':
		'As with the plot synopsis, expand each character’s one-paragraph storyline.',
	'step5.hints.revision':
		'It’s perfectly fine to revisit steps 1 to 4 at any time. Your characters may help you discover something new about your story.',
	'steps.6.title': 'Long synopsis',
	'steps.6.description':
		'Expand each paragraph of the plot synopsis into full-page content.',
	'step6.hints.title': 'Hints for long synopsis',
	'step6.hints.openNote':
		'Open the separate note to edit your long synopsis.',
	'step6.hints.pageLength': 'Full-page content is about 500 words.',
	'step6.hints.revision':
		'It’s perfectly fine to revisit steps 1 to 5 at any time. This can help you add more story and character details.',
	'step6.sourceSynopsis.title': 'Plot synopsis',
	'step6.sourceSynopsis.empty':
		'Complete step 4 and the plot synopsis will appear here.',
	'steps.7.title': 'Character profiles',
	'steps.7.description':
		'Explore each character in your novel in depth.\nThis is where you can keep everything related to them.',
	'step7.hints.title': 'Hints for character profiles',
	'step7.hints.reorder': 'Drag to reorder the characters. The row menu moves one to an exact position.',
	'step7.hints.openNote':
		'Open the separate note to edit the character profile.',
	'step7.hints.contents':
		'Character profiles may include basic information, appearance and personality, personal background, relationships, status at different stages of the story, and more.',
	'step7.hints.storyDetails':
		'You can add any character details that help the story.',
	'step7.hints.revision':
		'It’s perfectly fine to revisit steps 1 to 6 at any time. New details may spark new ideas.',
	'steps.8.title': 'Scene list',
	'steps.8.description':
		'Scenes are the fundamental building blocks of a novel.\nList as many scenes in the novel as possible.',
	'step8.hints.title': 'Hints for scene list',
	'step8.hints.reorder': 'Drag to reorder the scenes. The row menu moves one to an exact position.',
	'step8.hints.elementsBefore':
		'The basic elements of a scene are time, place, characters, and ',
	'step8.hints.conflict': 'conflict',
	'step8.hints.elementsAfter':
		' (don’t add a scene solely for exposition or atmosphere).',
	'step8.hints.povBefore': 'You can identify the ',
	'step8.hints.povKeyword': 'point-of-view character',
	'step8.hints.povAfter':
		' and describe exactly what happens in each scene.',
	'step8.hints.canvasBefore': 'You can use the following table or explore',
	'step8.hints.canvasAction': 'Obsidian Canvas',
	'step8.hints.canvasAfter': 'to create a “timeline” or “scene board”.',
	'step8.hints.canvasAria': 'Create a new Obsidian Canvas',
	'step8.hints.revision':
		'It’s perfectly fine to revisit steps 1 to 7 at any time. Seeing your scenes take shape often helps you understand your story and characters more deeply.',
	'steps.9.title': 'Scene planning (optional)',
	'steps.9.description':
		'Optional step: before drafting, further develop each scene’s conflict,\nsatisfying moments, comic beats, foreshadowing, memorable dialogue, and more.',
	'step9.hints.title': 'Hints for scene list',
	'step9.hints.reorder': 'Drag to reorder the scenes. The row menu moves one to an exact position.',
	'step9.hints.sceneTypes':
		'Planning example: Decide whether each scene is proactive (goal → conflict → setback) or reactive (reaction → dilemma → decision).',
	'step9.hints.revision':
		'It’s perfectly fine to revisit steps 1 to 8 at any time.',
	'steps.10.title': 'Write your novel!',
	'steps.10.description':
		'Congratulations! You now have a thoughtfully designed story!\nWrite your novel! Remember to revisit and revise the earlier steps whenever you need to.',
	'step10.certificate': 'All ten steps complete',
	'step10.openManuscript': 'Open manuscript stream',
	'step10.lastOpen': 'You were last writing in',
	'step10.manuscriptHint':
		'Read and write the whole manuscript as one page. Every chapter stays its own note.',
	'manuscript.title': 'Manuscript',
	'manuscript.titleFor': '{project} · manuscript',
	'manuscript.empty': 'This project has no manuscript notes yet.',
	'manuscript.noProject': 'Open a Snowflake project to read its manuscript.',
	'manuscript.createFirst': 'Start writing',
	'manuscript.createNext': 'Write the next one',
	'manuscript.createPrevious': 'Write the previous one',
	'manuscript.insertSegment': 'Insert a note after this one',
	'manuscript.insertSegmentBefore': 'Insert a note before this one',
	'manuscript.splitHere': 'Split at the cursor',
	'manuscript.mergeWithNext': 'Merge “{note}” into this note',
	'manuscript.nowReading': 'Current view: reading',
	'manuscript.nowEditing': 'Current view: editing',
	'manuscript.clickToEdit': 'Click to edit',
	'manuscript.clickToRead': 'Click to read',
	'manuscript.typewriterOn': 'Typewriter scrolling: on',
	'manuscript.typewriterOff': 'Typewriter scrolling: off',
	'manuscript.modeTurnOn': 'Click to turn on',
	'manuscript.modeTurnOff': 'Click to turn off',
	'manuscript.focusLevel.off': 'Focus mode: off',
	'manuscript.focusLevel.on': 'Focus mode: on',
	'manuscript.focusLevel.deep': 'Focus mode: deep',
	'manuscript.focusLevel.solo': 'Focus mode: solo',
	'manuscript.focusNext.on': 'Click for: on',
	'manuscript.focusNext.deep': 'Click for: deep',
	'manuscript.focusNext.solo': 'Click for: solo',
	'manuscript.focusNext.off': 'Click to turn off',
	'manuscript.openNote': 'Open this note on its own',
	'manuscript.copySelection': 'Copy',
	'manuscript.newSegment': 'New manuscript note',
	'manuscript.segmentTitle': 'Name',
	'manuscript.segmentTitlePlaceholder': 'Chapter 1',
	'manuscript.segmentTitleRequired': 'A name is required.',
	'manuscript.defaultSegmentTitle': 'Untitled',
} as const;

export type TranslationKey = keyof typeof en;
