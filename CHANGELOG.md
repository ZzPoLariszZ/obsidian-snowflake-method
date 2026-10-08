<a id="english"></a>

# Changelog

**English** · **[简体中文](#简体中文)**

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.23.0]

### Added

- **Export as Obsidian Canvas.** The freeform canvas, the timeline and the beat sheet each have a new button at the end of their toolbar. It writes the view you're looking at as an Obsidian Canvas file next to the workspace's own file: `732_Freeform/<view name>.canvas`, `733_Timeline/<view name>.canvas` or `734_Beat_Sheet/<sheet name>.canvas`. Notes become file cards and keep their colors. Frames, timelines and acts become groups. Typed text, sub-descriptions and beats become text cards. The toolbar's display switches, which hide the words, stack the scenes or reverse the order, change only the screen. The canvas always writes the words, puts the scenes beside them and keeps the stored order. Tasks, foreshadowing and revisions are not notes, so each becomes a text card that names it, and every line between cards is kept with its arrows and label. The canvas opens as soon as it's written. If a file of that name is already there and differs, you're asked before it's replaced. If it says the same, nothing is written and the canvas just opens. The plugin never reads the file back, so you can rearrange it in Canvas or delete it without touching the workspace.

### Changed

- The freeform toolbar's **Add view** button now wears a grid symbol, so only the canvas export beside it wears Obsidian's canvas symbol.

### Fixed

- A name that begins with a dot now loses the dot when it becomes a file name. Obsidian never shows a file named that way, so a note or a canvas with such a name could be written and never found again.

## [0.22.1]

### Fixed

- Every item in the freeform menus now shows a symbol in menus that Obsidian draws itself, as on Windows and Linux. The node menu's **Auto**, **Compact**, **Standard** and **Extended** items had no symbol, so their words came after an empty gap. **Snap to grid**, in the settings menu and the right-click menu, named a symbol that Obsidian doesn't have, so it showed none. **Snap to grid** and **Snap to objects** now use the same symbols as Obsidian's own Canvas.
- The progress status list on a card now shows each status in its own color. On Windows and Linux, the open list used to show every option in the color of the status already chosen. This applies to the cards in every tab of the visualization workspace, not only Freeform.

## [0.22.0]

### Added

- **The freeform canvas** is the last of the visualization workspace's four views, and the one with no grid at all. Each **view** is a blank canvas, and a project can have as many as you like. Pick one in the field at the start of the toolbar. Create views with **Add view**, and rename or delete them with the pencil. To open the canvas from the command palette, use **Open freeform workspace**. A project starts with a view named **Main**, which is saved the first time you place something on it.
- **Anything in the project as a card.** Characters, scenes, times, places, items, custom kinds, tasks, foreshadowing, revisions and sticky notes can all go on the canvas. Each shows as the card its own workspace draws, with its kind and color at the bottom. Double-click a card to open the note or record behind it. Beside them you can add **text** typed in place, **any file** of the project and **web links**. Pictures, video and sound show as themselves. A web link shows its address and fetches nothing. **Add node** lets you pick things by kind and name, and a strip of quick adds along the bottom has one for each kind. If you type a name into the form that no note has yet, the note is created on the spot.
- **Connections and frames.** Draw a line from one card to another to connect them. A line can have an arrow at neither end, at one end or at both. Its stroke can be solid, dashed, dotted or dash-dot, and you can put a label on it. A **frame** holds whatever you drop into it, and takes it along when you move the frame. A frame can have a color and a title. **Fit to contents** redraws a frame around what it holds.
- **The app's own gestures.** Drag to move and resize. The wheel pans, and the wheel with Ctrl or Cmd held zooms. Space or the middle button pans too. Dragging across empty canvas draws a selection box. Nodes snap to a dot grid and to each other. The controls in the corner zoom, fit and reset the view, and undo and redo every change. The minimap keeps the whole canvas in view, and the search finds a card by its words. Copy, cut, paste and duplicate work on cards as they do on text. Anything you can do with a gesture, you can also do another way. Use the arrow keys and **Size and position** to move and resize. Use **Connect to** and **Change start** or **Change end** for lines, **Move to frame** for frames, and the menus for the rest.
- **The views live in files of their own** under `732_Freeform`, one `freeform-view-<id>.json` for each view. A file holds where things are on the canvas and the text you type on it, never the words of your notes. Each file is read the same way as the timeline file. An entry that can't be read is set aside rather than dropped. A file from a newer version of the plugin is left as it is. A damaged file is kept, and a fresh one is started beside it. Deleting the last view leaves `freeform.json` next to where the views were. The project then opens with no views, rather than a fresh Main.
- **Search on the timeline and the beat sheet**. The search box is in the middle of their toolbars, and works as it does on the corkboard. Matches are counted, Enter steps through them, and everything else fades.
- **A tint on characters and worldbuilding notes**, chosen from the card's palette on the canvas. It's saved in the note under the same key a scene's color already uses.

### Changed

- The workspace's tab strip is complete. **Freeform**, between Corkboard and Timeline, used to read Planning stage….
- Every workspace toolbar has the same layout: the view field at the start, the search in the middle and the tools at the end. A toolbar too narrow for all of it scrolls rather than hiding anything.
- A new project is created with a `732_Freeform` folder. The health check offers to put it back, as it does for the other tool folders.

## [0.21.0]

### Added

- **The beat sheet** is the third of the visualization workspace's views. It asks what each scene is for in the shape of the story. A sheet is made of **acts**, with **beats** under them. Each act is numbered by its place, and has a label if you give it one. Each beat has a name and a description, kept in the sheet itself, since a beat has no note behind it. A project can have as many sheets as you like, and shows one at a time. You pick which one in the field at the start of the toolbar. On the toolbar, **Add beat sheet** creates a sheet and **Add act** creates an act. The pencil renames or deletes the sheet you're viewing. **Open beat sheet workspace** opens the tab from the command palette.
- **Templates** to start a sheet from. **Blank**, **Three Act**, **Kishōtenketsu**, **Story Circle**, **Save the Cat**, **Hero's Journey** and **Romancing the Beat** are built in. Each comes with its acts, its beats and a line on what every beat is there to do. They're written in the project's own language. Before you make a sheet, the form shows how many acts and beats your pick holds. **Export as template** in the toolbar saves the sheet you're viewing as a template of your own. It keeps the acts, the beats and their descriptions, and leaves out the sub-descriptions and the scenes. Saving a template under a name already in use replaces the older one. You delete your own templates from the same form.
- **Sub-descriptions and scenes under every beat**, exactly as under a time on a timeline. You write sub-descriptions a line at a time at the foot of a beat, and edit them in place. The **scene pool** beside the sheet holds every scene the sheet hasn't placed yet. A scene can have only one place on a sheet. Flat or stacked scenes, the eye that hides the sub-descriptions, and the two corner folds all work as they do on the timeline. The sheet also has a switch of its own that shows the last act first, without renumbering anything.
- **Every drag has a twin that is not a drag.** An act moves by its handle, or with Move up, Move down and **Insert act after**. A beat moves by its handle to any place in any act, even an empty one. It also moves with Move up and Move down, which cross an act's edge, and with **Move to act** and **Insert beat after**. A sub-description moves within its beat, or to another beat with **Move to beat**. A scene moves with **Move to sub-description**, or goes back to the pool with **Remove from this beat sheet**. If an action would lose words or placements, you're asked first and told what would go with it.
- **The beat sheets live in one file** under the project's visualization folder, `734_Beat_Sheet/beat-sheet.json`. The project's own templates are kept beside them. The file holds the scenes' ids, never their names. It's read the same way as the timeline file. An entry it can't read is set aside rather than dropped. A file from a newer version of the plugin is left as it is. A damaged file is kept, and a fresh one is started beside it.

### Changed

- In the workspace's tab strip, **Beat sheet** is now ready beside Corkboard and Timeline. Only Freeform still reads Planning stage….
- An empty scene pool now reads **Every scene is placed**, on a timeline and a beat sheet alike. It used to name the timeline.
- The health check treats every folder under `70_Tool` the same way. The three statistics folders used to be reported as damage when they were missing. That put a project made before them in the red, and stopped its steps from being reconciled. The six folders beside them were only offered as repairs. All nine are created with a new project, and put back by whatever writes into them. So all nine are now offered with a Repair button, and none of them marks the project. The entry reads **This project folder does not exist**. That's true of a folder that was removed, and of one that never existed. It used to say the folder had not been created yet.

### Fixed

- Words typed at the foot of a time that has since left the timeline are no longer refused with a message about the project. The message now says the time is gone, and the words are kept for you to copy.
- If saving a scene card on a timeline is refused while the plugin is unloading, its words now go to the console. A corkboard card already worked this way. Before, the timeline card opened a dialog that nothing owned.
- A timeline whose file couldn't be reached at the first read no longer stays empty until you reopen the tab. The failed read is forgotten, and the next one starts fresh.

## [0.20.3]

### Fixed

- The scene pool's top bar no longer shows how many scenes are left after a search or a filter. The two numbers had no room beside the field and the controls. So they stacked one above the other, and pushed the bar out of line with the toolbar beside it. The count above the cards still shows how many scenes are in the pool.
- A group's name is now trimmed to the width of the board it heads. Hovering over a trimmed name shows all of it. A linked chapter's name is wider than the scene pool, so it ran out over the cards and past the pool's edge.

## [0.20.2]

### Fixed

- The scene pool is now one scene card wide. A card there is as wide as it is on a timeline, so a scene neither grows nor shrinks as you drag it between them. The pool's search field, its name and its count all line up at the same two edges. So does the frame it shows when a scene comes back. The pool was widened in 0.20.1 to give that frame room. That left the top bar out of line with the name below it. The workspace again folds the time column and the pool at the window width it used before that.
- The pool's search field no longer shows what it searches inside the box, since there's no room for those words beside its controls. Hovering over it still tells you, and a screen reader still reads it out.

## [0.20.1]

### Fixed

- The input at the foot of each cell now waits until you need it. It used to show wherever no row was above it. Beside a single timeline, that's one invitation. Once timelines are side by side, the same invitation repeats through every empty cell. Each input now stays hidden until the pointer or the keyboard is in its own cell, or a drag is under way. It shows during a drag since you can drop a row or a scene on it. An input under rows already worked this way. Its wording still follows the rows above it. On a touch screen every input stays visible, as the other controls there do.
- The scene pool's mark for a scene coming back is now a rounded dashed frame with room of its own. It's drawn over a faint wash, in the accent color the lanes and their cells already use. It used to be an inset shadow, square at the corners and painted under the cards. The cards reach the board's sides, so down each side the frame only showed in the gaps between them. The pool is wider by the room the frame takes, so a card is as wide as it was. The workspace now folds the time column and the pool on its own at a window one rem wider than before.
- The gap between lanes is now set with the gap shorthand, not with the property for the inline axis alone. The community review's browser-support check reports that property as multicolumn. The two set the same gap, and the rows have no gap of their own, so nothing moves.

## [0.20.0]

### Added

- **The timeline** is the second of the visualization workspace's views. It asks when a scene happens, rather than what order it's read in. Each **timeline** is a column of its own, with a name. It's tied to a character or a worldbuilding note when it follows one. So a story can have one timeline for the world, and one for each person moving through it. A **view** decides which timelines appear side by side, and in what order. A project can have as many views as you have ways of reading the story. On the toolbar, **Add timeline** creates a timeline and **Add view** creates a view. A view's own form renames it and orders its timelines by their handles. It also adds and removes timelines, and deletes the view itself. **Open timeline workspace** opens the tab from the command palette.
- **One shared time column** runs down the left. It's drawn from the Time notes the project already has. Each time shows the main description written on its note, rather than a copy in the timeline. Every timeline crossing it meets those times on the same rows, so you can read two timelines against each other at a glance. A node on the axis marks each time a timeline actually reaches. Add a time to a timeline from the timeline's header, or from the plus in an empty cell. A time can be inserted before or after another, and ordered by dragging or from its menu. Removing a time removes the rows it holds. Clicking a description opens the Time note's own form at that field. A time whose note is gone shows as Missing time note, and can only be removed.
- **Sub-descriptions** are written a line at a time inside a cell, for what one timeline does at one time. The input at the end adds a line, and keeps the focus there for the next. An existing line is edited in place. Its menu moves it up or down, or to another time. The menu can also remove it, and asks first if it holds scenes. If a save is refused, the words it would have lost are kept at the foot of the cell. Where the row still exists, they're held for your next edit. Where it doesn't, they're shown for you to copy.
- **The scene pool** beside the lanes is the corkboard itself, in a single column. It holds every scene the active timeline hasn't placed yet, and has its own search, funnel, display and order. Drag a card from the pool onto a sub-description to place it, and drag it back to return it. A scene can have only one place on a timeline, so placing it again moves it rather than copying it. Every drag also has an action that isn't a drag: **Move to sub-description**, **Move to time**, **Move to position** and the ones next to them. So you can send a time, a row or a scene where it belongs from a menu alone.
- **Flat or stacked scenes**, set for each view. Flat lays every card out along the row. Stacked keeps one card in front, with a counter and arrows to step through the rest. A view opens flat with one timeline and stacked with several, until you set it otherwise. The toolbar can also hide the sub-descriptions to leave just the cards, and show the latest times first. It can fold the time column and the pool away into their corners too. A window too narrow to hold both folds them for you.
- **The timelines live in one file** under the project's visualization folder. It holds only identities: the ids of the scenes and the entities. Their names and descriptions are never in it, and stay on the notes they belong to. The file is read the same way as the task, foreshadowing and revision files. An entry it can't read is set aside rather than dropped. A file from a newer version of the plugin is left as it is. A damaged file is kept, and a fresh one is started beside it.

### Changed

- The workspace's tab strip now reads **Corkboard**, **Freeform**, **Timeline** and **Beat sheet**. Timeline has moved ahead of Beat sheet now that it's built, and **Plotline** has left the strip.
- Every scene card has a **grip** at its top center. It shows while the pointer is on the card or while the card is being dragged. A card that can't be dragged at all has no grip. The corkboard's cards have it too, since the corkboard, the timeline's lanes and the pool now share one card.

### Fixed

- If saving a scene is refused while the plugin is unloading, its words now go to the console. They're no longer gathered into a dialog that would outlive the workspace it belongs to. If the workspace is only closed, the dialog still appears as it did.
- Draft recovery no longer writes into a card that's gone. A card taken off the screen while its save was in progress is skipped. So is one whose scene has since been deleted. Neither is taken as a stand-in for the card that was actually edited.

## [0.19.0]

### Added

- **The visualization workspace** is a tab of its own, with one family of views over the scenes you plan in steps 8 and 9. **Corkboard** is the first of them. **Freeform**, **Beat sheet**, **Timeline** and **Plotline** are beside it in the strip, and each reads Planning stage… until its turn comes. Open it from the link row at the foot of the dashboard's Creation tools, or from the orbit icon in the ribbon. You can also use **Open visualization workspace** or **Open corkboard workspace** in the command palette. It follows the current project, the way the statistics and sticky note views do. A strip tab opened with Cmd or Ctrl held appears beside the others, rather than replacing them.
- **The corkboard** lays every scene out as a card in narrative order, numbered from one. The card is where you work, rather than something to click through on the way to a form. Edit the name in place. An empty name is refused, and so is one another scene already uses. The point of view and the progress status are dropdowns. A point of view whose note is gone stays as a choice of its own, rather than being quietly dropped. The conflict is a text box, saved when you leave it or press Mod+Enter. A swatch tints the card in one of the eight macaron colors the sticky notes use, or in none. Every save goes through one queue, so two edits made at the same moment both land. After each save, a card takes the version that save returns, not the one it was drawn from.
- **Order is what the board is for.** While the board is in plain order, dragging a card moves the scene, and only the ranks around it are rewritten. A **+** between two cards inserts a scene at exactly that point, and **Add scene** puts one at the end. The card's menu has Move up, Move down, **Move to position** and **Move after**, to do the same without a mouse. The direction button shows the whole board in **Reversed order**. There, moving a scene up moves it later in the story. Searching, filtering or grouping hides the actions that move a scene relative to its neighbors. The ones that name a target stay.
- **Search, filter and group the board.** The search box narrows the board to a name. The funnel narrows it by progress, category, point of view, time, location, cast, color or linked manuscript. **Display** sets the cards to Compact, Standard or Extended. It also groups them by any of those same eight fields, with a heading over each group. Every card keeps its narrative number. The card size, the grouping and the direction are remembered for each project across restarts. Only the cards in view are drawn, so a board of three thousand scenes scrolls just as a board of five does.
- **Two fields for every scene**: **Color** and **Linked manuscript**. The color is stored as `snowflake-color`. The links are stored as `snowflake-linked-manuscript`, exactly as you spell them, with subpaths and aliases kept. Both join the scene form after Events, and both can narrow the scene table and the board from the funnel. A card lists the chapters its scene belongs to, and each one opens the chapter it names. When a link would take you somewhere worth going, the form's button offers **Save scene and open {name}**.
- **A scene range in the funnel**, from a smallest to a largest scene number. It narrows the table and the board to one stretch of the story. The actions that move a scene relative to its neighbors stay where they are. **Insert scene before** joins the existing action that inserts a scene after a row.
- **Unsaved scene text is kept** when a card's save is refused. It's gathered into a dialog you can copy from, rather than dropped when the board closes.
- Two sidebar commands now name the sidebar they open: **Open sticky note sidebar** and **Open writing session sidebar**.

### Fixed

- An edit to a member now lands in the project whose dashboard opened it, whichever project became current while its dialog was open. This covers renaming or deleting a category, adding a category path and saving a custom field template. It also covers editing a character, a scene or a worldbuilding note, and the dialogs behind Move to position and Move after. Each now keeps the project it was opened from. Before this, clicking into another project while one of them was open sent the save to that project instead. Where that project had a note of the same name, this happened silently.
- The plugin now refuses to save a note whose managed section markers are damaged, rather than writing over it. This applies to characters, scenes and worldbuilding notes alike. Saving one used to write a fresh heading and markers below the old ones. That left your prose stranded outside any managed section, and the health issue went with it. So the checker then reported the project as healthy. The health report no longer offers **Edit** for such a note either, and offers **Open** instead.
- The scene table's time, location and category filters are now cleared when the note behind the chosen answer is renamed or deleted. The point of view and cast filters already worked this way. A stale answer used to leave an empty table, under a funnel row that looked as if nothing had been asked.
- The project switcher's damage mark now agrees with the health checker. A record line the checker calls informational no longer raises the mark. A damaged worldbuilding note, which the mark used to miss entirely, now raises it.

## [0.18.1]

### Added

- A button at the top of the dashboard's rail folds the rail down to its marks, however wide the pane is. A pane too narrow for the step names already folded the rail on its own. Now you can fold it at any width. The words go, and the marks and their counts stay. The same button opens the rail out again. Each dashboard remembers its own choice across restarts. **Toggle the dashboard rail** does the same from the command palette. It's only offered where there's room for the words to come back.
- A sticky note's float button now closes an open panel as well as opening one. Click it on the dashboard's card or the sidebar's compact card while the note is already floating in that window. That closes the panel, and every card showing the note updates to match.

### Fixed

- A four-digit count now stays inside its circle rather than spilling past it, wherever a circle is drawn. That covers the rail's kinds and vocabularies, and the entity tracking folds. It also covers the task board's columns, derived cards and archive, and the archives of the sticky notes and the project manager. Before, only the rail's own counts shrank at all, and only at a size that three digits had already outgrown.
- The reading in the middle of the writing stages ring now stays inside the ring's hole. A focus time of a hundred hours or more runs to nine or ten characters. It now shrinks by just enough to stay clear of the ring.

## [0.18.0]

### Added

- **Tasks** is the last of the four Task management tabs. It's a board of six columns: To do, In progress, Blocked, In review, Done and Cancelled. Your own tasks are cards you write. Each has a title no other task uses, a description, a priority from Low to Urgent and a due date. It also lists the characters, scenes and worldbuilding notes it's about. Each of those is tracked by its identity rather than its title, so renaming a note never loses the link. **Add task** on the tab and **New task** in the command palette open the form. Drag a card within its column to reorder it, or into another column to change its status. Its menu has **Edit**, a move to any other column for when a drag won't do, **Archive** and **Delete**. An urgent task has a stripe down its edge. A due date already past turns red, as a look rather than a status. A task in Done or Cancelled is never overdue. The plugin fills in the rest of the board itself. These cards are worked out fresh on every read, and never written into the file. Your daily, weekly and monthly writing goals get cards that move from To do through In progress to Done as the words land. Foreshadowing threads still under way get cards, and so do occurrences whose chapter no longer matches them. So do revisions still open, and revisions whose words have changed underneath them. The same goes for mentions no single entity can claim, the sensitive words you've listed, and sticky notes waiting to be read. Each of these cards goes in the column its count puts it in. It opens the tab it was counted from, narrowed to what it counted. It goes away when there's nothing left to count. **Toggle derived tasks on the task board** hides them all. The bar above the board searches every card, and narrows the columns by kind, by priority and by due date. **Archived** is a folded section underneath, with a search and a funnel of its own. Every card in it has **Restore** and **Delete**, and you can empty the whole section after a confirmation. Your own tasks live in one file under the project's task management folder. It's beside the revisions and the foreshadowing, and read by the same rules. The board keeps up with your writing as it happens. A word counted, a foreshadowing resolved, a revision accepted, a note archived or midnight starting a new day all reach it without a refresh.
- The **Revision** tab has a funnel beside its search. It narrows the table to one type of proposal, whether replace, insert or delete, or to the conflicts alone. A conflicting row's chapter name is now a link, just as on a row without a conflict. There's no passage left to flash, so the link opens the chapter the words were lost in. It also lights up the card pinned at the top of its margin.

### Changed

- The Chinese interface no longer uses 未解决 or 待定 where it can say what actually happened. A mention that several entities could match is now 有歧义的提及. A foreshadowing occurrence whose marked words are gone is 锚点失效, and is put back with 重新锚定锚点失效的伏笔落点. A revision whose words changed underneath was already 冲突, and stays so. Both tables label the funnel row 锚点. English is unchanged.

## [0.17.0]

### Added

- **Foreshadowing** follows one thread from its plant to its payoff. Click into a chapter of the manuscript stream and select the words that plant the thread. Then choose **Create foreshadowing** from the right-click menu, and the selection becomes the thread's first occurrence. Later passages join the same thread through **Add to existing foreshadowing**. Each is marked as a plant, a reinforcement or the payoff. The thread itself is planned, active, resolved or abandoned. A thread has a name no other thread uses, and a description. It also lists the characters, scenes and worldbuilding notes it's about. Each is tracked by its identity rather than its title, so renaming a note never loses the link. Every occurrence is marked in the prose, and has a card in the margin the revisions already use. The card shows its role, the thread's status, name and description, the marked words and a note of your own. **Open**, **Edit** and **Delete** are at the bottom. Arrows on the card step from one occurrence to the next through the whole manuscript. An occurrence follows its words as you write above and around them, and when a chapter is split or merged. If you rewrite the words directly, the occurrence becomes unresolved rather than lost. **Relink to unresolved foreshadowing** then puts it back on the passage that replaced them. The **Foreshadowing** tab of Task management gives every occurrence a row. You can search it by name, and narrow it by status, by role or to the unresolved alone. Its position column jumps to where the words are. The threads live in one shared file under the project's task management folder. It's beside the revisions, and read by the same rules. **Add foreshadowing** opens the form from the command palette.
- **Sticky notes** are short Markdown files for what doesn't belong in a record: an idea, a reminder or a question to come back to. **New sticky note** in the command palette, the sticker in the ribbon and **Add sticky note** on the dashboard each create one. The new note opens, ready to write in. A note has two faces. Click its prose to write in it with the plugin's own editor, and press Escape to read it back as rendered Markdown. One file shows three ways at once. It's a card in the **Sticky notes** tab of Task management, and a compact card in a sidebar of its own. It's also a floating panel over the workspace. Only one of them can be written in at a time. If you start writing in another, the note moves over to it, with what you typed already saved. You can drag a floating panel by its header, resize it from any edge and pin it in place. It can also thin out to let the page show through. Its position, its size, whether it's pinned, how transparent it is and which face it shows are remembered on that device. They're never written into the note. Focus mode never fades a panel, not even in solo. Moving to another project puts the old project's panels away and brings back the new one's. Eight colors tell the notes apart. On every board you can search their words, filter by color and sort them by age. **Archive** moves a note into a folded section under the dashboard's board, and closes all of its panels. There it can be read, restored or deleted. You can also empty the whole section at once, after a confirmation. Each note is its own file under the project's task management folder. The health check reads it as it reads every other managed note. **Open sticky notes** opens the sidebar from the command palette.

### Changed

- The **Foreshadowing** and **Sticky notes** tabs of Task management now hold what 0.15.0 named them for. That leaves **Tasks** as the only one still in the planning stage.

### Fixed

- A revision card with its form open keeps what you typed through every refresh of the margin. It stays in place for its record, even once the chapter no longer matches its words. It shows the new text the moment a save lands, rather than the old text until the next read. Its two faces are placed afresh when it switches between them, so the taller one no longer covers the cards below.
- Splitting a chapter now moves the revisions that go to the new note before it levels the ones that stay. Leveling first could re-anchor a revision in the tail onto the head's copy of the same words. That happened wherever one phrase appeared in both halves.
- When one entity's name is written inside another's, they're now marked in the right order, with the containing name first. An unrelated mention earlier in the same line could take the place the containing name needed. The name inside it was then drawn over the top.
- Clicking into a chapter to write in it puts the line you clicked back where it was. It's measured from the top of that row, rather than from the height of the pointer within it.
- The dashboard no longer takes the cursor out of what you're typing in it when it refreshes. That holds whether the refresh came from a writing record landing or the health verdict changing. Whatever had the focus and is still on the page gets it back.
- A card you jump to from a table keeps its highlight while the pointer rests on it. A conflicting revision's own frame was the more specific rule, and took the color back.

## [0.16.0]

### Added

- **Word milestones** mark the running count in the margin. Beside the line that reaches each interval, a small label gives the count reached there. The interval is five hundred words by default, and the count uses the same rule as the status bar. **Milestone mode** counts across the whole manuscript in reading order, or starts again at every chapter. The labels follow the writing. As a chapter grows, its marks move. When counting across the whole manuscript, the marks of every chapter after it move too. **Show word milestones** turns them on. A pane too narrow for the labels holds them back rather than drawing them over the prose.
- **Automatic chapter numbers**: a new chapter is numbered from the one before it. **Numbering style** offers Chinese numerals (第一章), Chinese with Arabic numerals (第 1 章) and English (Chapter 1). It also takes rules of your own, written in a simplified format such as `第{nnnn}章` or `Chapter {n}:`, or as a regular expression. One rule runs at a time. With a style on, the naming form has two fields: the number, already filled in, and the name you came to type. When numbered chapters follow, it also has a switch that moves each of them up by one. Merging a numbered chapter into the one before it offers the reverse. The chapters after it move down by one, so the count closes over the gap. The renames are settled before anything is written, and refused as a whole if a name is taken. A chapter whose heading you rewrote keeps that heading. A chapter the rule doesn't read stays where it is. A number keeps the spelling its title already has, so `第十章` becomes `第十一章` and `Chapter 0009` becomes `Chapter 0010`.
- **Plain-text export** writes the manuscript out with every Markdown and Obsidian mark removed. Headings become their words, and links their text. Comments and block ids are gone, and HTML entities become the characters they stand for. The export button in the stream's toolbar writes the whole book. It can be one file, with a blank line, a line of dashes or three asterisks between chapters. Or it can be one file per chapter, in a folder numbered in reading order. Every chapter's header has a button that exports the chapter alone, and another that copies it to the clipboard as the same text. Each line of prose is a paragraph. The **Export** settings decide whether it's indented or stripped of its indent, and whether blank lines between paragraphs are kept or dropped. The indent is two ideographic spaces in a Chinese project and two em spaces otherwise, unless you typed one yourself. Files go to `Snowflake Export` beside the projects, unless **Export folder** names another. They never go inside a project. They end in `.txt` or `.md`, with the same text inside either way. A file already there is written over only after you agree. Unsaved typing is saved first. Three commands do the same from the command palette.

### Changed

- The focus mode slider has a reset button like the other sliders. The settings page keeps its controls to one width. A number box and a folder field are the same width. A long description wraps rather than squeezing its control. A row with only a name sits level with its control.

## [0.15.0]

### Added

- **Revisions** are changes proposed beside the manuscript before they're made. Click into a chapter, select the words in question and choose **Create revision** from the right-click menu. The selection becomes a replacement, or a deletion if you leave the proposed text empty. With just a cursor and nothing selected, you get an insertion at that point. The words a proposal would take out are struck through in place. An insertion is marked by a bar where it goes. But the chapter itself doesn't change, and nothing is counted, analyzed or tracked until the proposal is accepted. Each proposal is a card in the margin to the right of the chapter. It holds the type, the original text, the proposed text and a comment. **Accept** writes the change into the chapter as your own edit, so you can undo it and it counts as writing. **Reject** removes the proposal and leaves the text as it was. **Edit** changes the proposed text or the comment. A deletion you give words to becomes a replacement again. The arrows on a card step from one proposal to the next through the whole manuscript. A proposal follows its words as you write above and around them, and when a chapter is split or merged. If you change a proposal's words directly, it shows as a conflict, to be discarded rather than applied. Two proposals can't cover the same words. The proposals live in one shared file under the project's task management folder. The file travels with the vault. If it won't parse, it's set aside rather than read. If a newer version of the plugin wrote it, it's left alone.
- **Task management** is a new dashboard pane for the work around the writing. Its **Revision** tab lists every open proposal with its type, original text, proposed text, comment and place. You can search by any of them. Clicking the place jumps to where the proposal is in the manuscript. A conflicting proposal shows its conflict there, with a discard button. The **Tasks**, **Foreshadowing** and **Sticky notes** tabs are named ahead of what they'll hold.
- The health check now knows about a folder the plugin only creates once it has something to put there. The revisions folder in a project made before this version is one example. The health check offers to create it now, as advice, rather than reporting the project as damaged.

### Changed

- The ignore rules written while tracking entities now live in the entity tracking folder. The prose statistics cache now lives in the prose analysis folder. Each is beside the tab that shows it. A file left where an older version kept it is still read there. It moves to its new place the first time it's written, and the health check offers to move it for you.

### Fixed

- A chapter opened for editing is laid out in full from its first frame. CodeMirror lays out only the visible stretch, and estimates the rest from lines of Latin letters. So a Chinese chapter collapsed to a fraction of its height, and grew back in waves as you scrolled. Lines you never scrolled near kept the wrong height for good.
- Closing the manuscript stream now closes every editor with it. An editor the cleanup missed kept listening to the window, and logged a layout error on every resize until the window closed.
- A chapter's length in prose analysis is now counted the same way as in the status bar. That's words or CJK characters, with headings treated as you've set. So a chapter has the same length wherever it's shown, and the dialogue share is worked out against that same length.
- Two lines of speech with narration between them now count as two pieces of dialogue. They used to close into one word across the gap, which left the dialogue share short. The share can also no longer exceed the whole.

## [0.14.0]

### Added

- **Entity tracking** follows the cast through the draft. It finds every character, scene, time, location, item and kind of your own that the manuscript names. It doesn't matter whether you wrote it as a link or as plain text. The **Entity tracking** tab in Data statistics gives each one a row. The row shows how often it's mentioned, and how many of those mentions are already links. It also shows the first and last chapter to name it, and a distribution that reads the whole book as one line. Open a row to see every mention, grouped by chapter with the sentence around it. Choose one to jump to that spot in the manuscript. In the stream itself, a mention is marked in place. Right-click a plain name to turn it into a link, or to leave it alone just here, in this chapter, or anywhere it appears. **Highlight mentions** sets whether to mark the first mention of each member, only the mentions not yet written as links, or all of them. Entities stay unmarked until you choose one.
- **Prose analysis** reads the draft back as prose. The top of the tab shows total reading time, reading time per chapter, sentences per chapter and words per sentence. It also shows the share of the writing that is dialogue. Under them, every chapter has a row of its own, which you can search by title and narrow by length. **Word frequency** counts and ranks the words themselves, with a word cloud of the ones you lean on. Stopwords and the names of your own members stay out of the count until you ask for them. Chinese is read as words rather than as single characters. **Reading speed, words per minute** and **Reading speed, CJK characters per minute** set the speed the reading times assume. **Custom stopwords** adds your own to the built-in lists.
- **Sensitive words** are the terms you'd rather catch early. List them under **Custom sensitive words**, one per line. They're marked in the manuscript, and counted in entity tracking beside the members. A term written in Latin letters is found in lower case, capitalized and in capitals alike.
- **Dialogue** is told apart from narration by the quote marks around it. Curly quotes, straight quotes, corner brackets and white corner brackets each have their own switch. Dialogue is counted per chapter and across the whole manuscript. **Show dialogue** either marks the quoted stretches or fades everything around them.
- **Custom highlight rules** mark your own patterns in the manuscript. A rule is literal text or a regular expression, and holds as many patterns as you like. It's drawn in the color and decoration you choose. The rules only change how the text looks. They're never counted and never written into your notes. **Toggle custom highlights** turns the whole set off and on from the command palette.

### Changed

- The settings page is now folded into card sections, each opening to show what it holds. The four families of highlighting are set together behind one menu, rather than scattered down the page.
- The custom field pane now has a frame of its own, and scrolls inside it. It ends with a tail line, as the other rail panes do.

### Fixed

- Clicking prose that contains a link now puts the cursor in the words you clicked. The spot used to be looked up in the text as written. So every link before the click pushed the cursor further off, by the length of the address it hides.
- Table headers now stay aligned with their bodies after the system switches between light and dark mode. The scrollbar width the layout reserves was measured once and never checked again.
- A manuscript stream or dashboard hidden behind another tab now refreshes when it comes back into view. It no longer shows what it held when it was covered.

## [0.13.1]

### Changed

- The first line of a paragraph is now indented by a blank box as wide as the indent. It no longer uses the CSS property made for the job. The community review's browser-support check flags that property for keywords no manuscript uses. Measured against the property at the manuscript's own settings, both methods put every character in the same place. They also break lines in the same places and leave the same flush right edge. With no indent set, no line moves.
- The wikilink popup now draws its own group headings. It no longer styles whichever element the CodeMirror underneath would have drawn them as. They look exactly as they did, and they'll keep looking that way when that element changes again.

## [0.13.0]

### Added

- **Manuscript typography**, so you can set up the page yourself. You choose the font family, font size, line height, content width, paragraph spacing, first-line indent, text alignment and automatic hyphenation. You also get a background tint for light and dark mode, and grid lines to write along. Reading and writing share one set of measurements, so a chapter is laid out the same whether you're reading it or writing in it. Any measurement you leave at the theme's value keeps following the theme. The **Typography** button in the manuscript toolbar opens the same controls right over the page. That way you see each change where it lands, not in a settings window somewhere else. Your reading position holds while the page changes shape under it. Each mode has four tints plus a custom color. In light mode they're Sage green, Parchment beige, Mist blue and Mist pink. In dark mode they're Midnight blue, Slate gray, Plum purple and Indigo blue.
- **Writing in the manuscript**, with the tools prose needs. A toolbar over the stream has undo and redo, heading levels one through six, bold, italic, strikethrough, underline and highlight. Press Cmd or Ctrl with B for bold, or with I for italic. Typing `[[` suggests the project's own members: characters, scenes, times, locations, items and every kind of your own. Each one appears under the heading of its group. An alias is listed under the name it belongs to, so you can still tell apart two members who share one. Brackets, quotes and Markdown emphasis markers close themselves as you type them, in full width as well as half width. Enter puts in the blank line a Markdown paragraph needs, and Shift+Enter still gives a plain line break. This only happens in prose, so lists, quotes, tables and code keep the Enter they expect. **Auto-pair brackets and quotes**, **Auto-pair Markdown syntax** and **Enter starts a new paragraph** each turn off their own part of this.

### Changed

- The space between paragraphs is now measured in lines, and it's set to one line. Nothing changes in the editor, since a blank line there was always one line high. The reading view grows to match it. For a manuscript left at the theme's own spacing, that's a wider gap than before. **Paragraph spacing** sets it anywhere from a quarter of a line to three lines, on the page and in the editor alike.
- Manuscript prose is justified unless you choose otherwise. **Text alignment** also offers left alignment. **Automatic hyphenation** is off by default. It breaks long words at line ends, using the browser's dictionary for the project's language. An existing manuscript that has never had its alignment set will show as justified after you upgrade.

### Fixed

- Pressing Enter on the blank line under a table now starts a paragraph instead of a soft break. The line that ended the table was read as one of its rows, so whatever you wrote there ended up stuck to the paragraph below it.
- A formatting command puts in a pair of markers. Typing a space between them no longer takes the closing marker with it. Bold or italic turned on with nothing selected used to last only until the next keystroke. A space would then take it apart.
- A chapter now opens with its typography in place. Clicking deep into a long chapter used to show its lines unaligned and unindented for a moment, until the page's own typography caught up.
- Text kept after a save conflict is now actually written. When a note had changed elsewhere, the notice promised that your words here were kept. But writing them was left to a timer. That timer never fired if the chapter left the loaded window first.
- Your reading position holds when a chapter goes back to prose, and while the typography changes under it. Leaving an editor when you were a page into a chapter used to carry you a long way off. That's because what was held was the chapter's own top, not the words in front of you.
- Cmd or Ctrl with B, I and E now act on the manuscript only while the caret is in it. Pressed while a slider or field in the typography popover had focus, they used to reach the chapter behind the panel.
- Table headers line up with their table bodies, and a dialog's fields line up with its header and footer. The layout reserves room for the scrollbar. Its width was measured before there was a window to measure it in, and never again, so it stayed at zero.
- The character and scene forms that the command palette opens are now the dashboard's own, with every field they have there. They no longer move the page to a step nobody asked for.
- A picker's arrow keys move through its list from the moment it opens. Its create row is styled like the rest of the list. A font your computer can't display is marked as missing instead of being offered.
- The wikilink popup's group headings are styled like every other list's headings. A link's kind is separated from its name by a character that no name can contain.
- Only one editor is open at a time, and it reads from the project the page is actually showing.
- A typography slider updates the page as it moves, and writes the file once it comes to rest. It no longer writes on every step of the drag.
- Letter case in a name is handled the same way, whatever locale your computer runs in.
- Code fences, tables and blocks nested inside other blocks are read the way the page reads them. That holds both for what counts as writing and for what Enter does.

## [0.12.0]

### Added

- Writing counts without a timer. Words you write while no session is running are recorded on the day you wrote them. So a morning spent in the manuscript belongs to that day, whether or not you started a session for it. Each day's count is kept per project and per device, in a file of its own beside the session records. It's included in today's words, the recent trend, the annual contribution, the calendar, and the daily, weekly and monthly goals. Focus, idle and total time, the session count, pace, the hours of the day and the writing stages still come only from sessions. That's because a day of writing with no timer behind it has no time to report. **Track writing count outside sessions** decides whether any of this is recorded, and there's a command of the same name. Turning it off stops the recording, not the archive, so the days already recorded are still read.
- Words you write while a session is paused, or during a pomodoro break, are recorded the same way. The timer stays frozen, and the session still reports no time for them. So pausing to think, or letting a break run on, no longer leaves that writing uncounted.

### Changed

- Whether a change counts as writing now depends on where it came from, not on which part of a note it landed in. Text you type into a form, a dashboard panel or a rendered field block is counted when it's saved. That means a character's motivation counts the same as a paragraph of the manuscript. A note rewritten by the plugin itself, by a migration, by a repair or by sync only sets a new baseline. That rewrite isn't credited to anyone, which keeps another device's writing out of this device's day. The note totals on display are unchanged, and they still leave out blocks the plugin wrote.

## [0.11.0]

### Added

- The status bar counts the writing in front of you. That's the note you're writing, the text you've selected, or the marked section your caret is in. It counts what the page shows, not the Markdown underneath. So syntax, blocks the plugin wrote and the note's own title stay out of the number. Its tooltip breaks the total into words, characters with and without spaces, non-Asian words and Asian characters. **Word count rule** chooses whose counting method to follow: MS Word, Jinjiang or Qidian. **Count headings** decides whether heading lines count as writing. **Count project words** reports the count for the whole project and for the manuscript alone.
- Writing sessions, timed three ways. A session runs as a stopwatch, as a countdown, or as a pomodoro that alternates work with breaks. You start it from the status bar or the command palette, or it starts by itself when focus mode opens. A session splits its time into focus, idle and paused time. Every number comes from timestamps, not from how many timer ticks happened to fire. So a laptop closed for two hours is classified exactly like two hours watched second by second. Words are credited note by note, against the count each note had when the session began. Whatever changes while a session is paused sets a new baseline, and isn't credited to the session.
- **Data statistics**, a dashboard pane that shows a project in numbers. Its **Writing sessions** tab opens with the day's goal, the focus timer and today's summary. Further down, it looks back over time. There's a recent trend over 7 to 180 days, a year of shaded days and a calendar. There are also weekly and monthly goals, which scale with the number of days in each period. You can see the hours of the day your writing actually happened in. You can also see how the time was split between planning, drafting, revision and proofreading. Every figure covers one project, in the scope you choose: the whole project or the manuscript alone. The daily goal keeps a scope of its own, so changing what the charts show never moves the goalposts.
- **Open writing statistics** shows a sidebar with the day's goal, timer and summary. It keeps the numbers beside your writing instead of under it. Eight more commands start a session with any of the three timers, pause or stop the one that's running, and switch the scope the figures cover.
- Eleven settings under **Writing sessions**. They range from the count rule and the timer a new session starts with, to how long a silence lasts before focus turns to idle. They also cover a daily goal for the project and another for the manuscript, the day a week begins on, and how dates are written.
- Sessions are stored in the project itself, in one JSON file per month for each device, under `70_Tool/71_Data_Statistics/711_Writing_Session`. Two installations never write the same file, so sync has nothing to merge. A session cut short by a crash or by quitting is finished and filed the next time the plugin loads.

### Changed

- The length hint under the one-sentence summary now follows the **Word count rule**, and says whether it's counting words or characters. The number under the field and the number in the status bar are worked out the same way.

## [0.10.0]

### Added

- Projects can be archived. **Archive project** in the project manager's row menu moves the whole folder into `Snowflake Archive`. That folder is next to your projects, not inside one of them. The manager gets an **Archive** section at the bottom of its list, showing what's in that folder. Nothing in your notes changes and no link is left broken, because everything a project refers to moves inside its own folder. Restore brings a project back where it came from. If its old name has been taken since, it gets a free one. Moving a folder in or out with the file explorer does the same thing. So the archive is just a place, not a special mechanism.
- Worldbuilding and the vocabularies now work from the command palette. **Add worldbuilding note** and **Open worldbuilding base** first ask which kind you mean. Then they do for that kind what the character and scene commands have always done for those two, custom kinds included. **Create worldbuilding kind** opens the dialog that adds a kind. **Add category**, **Add world status** and **Add relationship** each ask which kind the entry belongs to, then add it there. The commands ask for the kind instead of using a fixed one. That's because a project's kinds are its own, and you can create and delete them while it's open.
- Freeform mode, as a setting and as the command **Toggle freeform mode**. When it's on, the dashboard puts away the ten steps and their progress, and keeps the places you write in. Characters and scenes join the worldbuilding list in the rail, each with its own icon and count. Their panes drop the step number, the status and the hints, and read as plain lists of notes. Turning it off brings the method back exactly as it was, because the mode only changes what's drawn. While the steps are put away, the **Open manuscript stream** command still opens the manuscript stream.

### Changed

- A long member form keeps its title and its buttons within reach. The dialog no longer scrolls as a whole. The title row and the progress status stay at the top, and the Cancel and Create buttons stay at the bottom. Only the fields between them move. The scrollbar runs in the dialog's own margin, so the fields still end at the same edge as the title above and the buttons below.
- The definition tree and the custom field tables now call their menu action **Open** instead of Open note, as every member row already did.

### Fixed

- A form dialog too tall for the window can be scrolled again. The project and rename dialogs had kept a style rule that stopped their fields from shrinking. In a short window, that left the last fields and the buttons under them out of reach, with no scrollbar to be found.
- A focused field shows its full focus ring. The dialog's scrolling area used to clip the side of the ring nearest the fields' own edge.
- Changing the project root while the manager is open now reloads the archive too. It used to keep showing the previous root's archived projects. Restoring one of those rows would have moved that project into the new root.
- The plugin now notices a project you drag into or out of `Snowflake Archive` by hand. Dragging one out used to leave it missing from every list until something unrelated woke the plugin up. Dragging one in left an open manuscript tab writing into a project that was no longer there.
- Archiving or restoring from the manager no longer redraws the lists from a reading of the vault taken before the folder moved. That could show a project as both archived and active at once.
- In the vocabulary trees and the custom field tables, the count above a list of rows now lines up with the row menus below it.

## [0.9.0]

### Added

- Custom fields on any member note. A field is a title plus whatever you write under it. You add and reorder fields as cards in the member's form, and they're kept in their own section of the note. The plugin never writes into them and doesn't read them for anything else. That leaves them free to hold whatever your story needs that the built-in fields don't cover.
- Worldbuilding kinds of your own. Every project starts with three: time, location and item. From the rail you can add up to thirty-two more. A kind could be a faction, a language, a piece of technology, or whatever else your story keeps track of. Each kind you add gets its own folder, rail pane, table, Bases view and three vocabularies. It also gets a Lucide icon you choose by name, and a sentence saying what it's for. Renaming one moves its folder and rewrites every link into it. Deleting one tells you what it will cost before anything is removed.
- Custom field templates, one folder per kind. A template is a note that holds a set of fields. It's kept in a fourth folder beside the kind's three vocabularies. The new **Custom field** pane in the rail lists the templates for each kind, so you can add, edit and delete them. Any member form can export the fields you just typed as a template. If that would replace a template with the same name, it tells you first. The template you choose in a form becomes that kind's default. A new note of that kind then opens with those fields already in place. A note that already has fields keeps them, and only gains the ones it was missing.

### Changed

- Notes now use schema 3. The blue **Older project format** notice and its **Update** button bring earlier notes up to date in one pass, as they always have.
- A relationship record now names the note it's with. The form won't save one without a target. It marks the card in question, so you can find it in a long form. Records written before this rule are read and shown exactly as they were. The form asks for the missing target the next time that note is saved.
- You now write a record's value in a field that wraps and can be dragged taller. It's the same field a custom field's content uses. A record is one line in the note, so any line breaks you type are read back as spaces when it's saved.

## [0.8.1]

### Changed

- After a search that found nothing, a line closes off the vocabulary browser. That line now takes its style from a class the plugin puts on the browser. It no longer uses a selector that checks what the browser contains. Nothing looks or behaves differently. The `:has()` selector this replaces is the kind the plugin review warns about, because the browser re-checks it broadly as the page changes.

## [0.8.0]

### Added

- Worldbuilding notes: time, location and item join characters and scenes as members of a project. Each kind has its own folder, its own table in the dashboard's new rail group and its own Bases view. The form is the same one every other member uses. An entity has aliases, categories, a progress status and a description. Its note reads like any other: properties at the top, a generated overview in the body, and your prose below.
- World status and relationships, written as record lines on any member. Each line has a label from a vocabulary, linked terms for who, where and when, and free text after them. You edit them as cards in the member form. The pickers there create anything that doesn't exist yet. The lines are stored as ordinary Markdown callouts, which read the same with the plugin off.
- Three vocabularies for every kind, built up as folder trees: categories, world statuses and relationships. Every entry is a folder holding a note named after it. So links to entries resolve like any other link, and the graph shows each entry under its own name. Three rail panes let you browse the vocabularies across all five kinds. You can fold and search the trees, and read one entry beside them along with everything that uses it. You can also add children, rename an entry with every reference rewritten, and delete one after being told what it will cost.
- A character's role is now one of its categories. Major, Supporting and Minor are set up for you in the project's language. Deeper entries are yours to shape, so elves can go under Race/Elf and houses under Houses/Major. An entry deeper in the tree that only shares a role's name is never read as the role. The character base groups by the role link.
- A scene's time and place are now notes instead of plain words. You pick them the way you pick its cast, and you can create them from the field when they don't exist yet.
- The health check follows every note a project refers to. It reports a vocabulary entry whose note is gone, and a link to an entry that isn't there. It also reports display text that a rename left behind, and a record line that points at nothing. Each repair fixes exactly what its report counted, nothing more.
- One blue notice, **Older project format**, appears next to the newer format warning whenever any note was written by an older release. That covers characters, scenes, entities, summaries, synopses, manuscript notes, materials and archives. Its **Update** button brings all of them up to date in one pass, and tells you what it skipped. The command **Update notes in older format** does the same from the command palette. Running either one again changes nothing.
- The plugin's own files look after themselves. As soon as a dashboard shows the project, missing system templates are created and outdated ones are replaced. This happens silently, because those files are generated. The set now includes 061, the worldbuilding template it had been missing. Your notes only ever change when you press the **Update** button.
- Tables can show a progress status and an actions column, each with its own setting and command. Another setting chooses whether a note created from a picker field opens its form first or is created directly.

### Changed

- Notes now use schema 2. A character's role moved from the old type key into its category links. Member properties appear in one standard order for each kind. The overview ends with the progress status, and record sections come right below it as titled callouts.
- **Write field overviews into character and scene notes** is now **Update notes in older format**. It's still the same command, so any hotkey bound to it keeps working.
- While nothing in the project has changed, repeated project loads are served from one snapshot. With three hundred characters and three thousand scenes, every form, pane and refresh used to cost a third of a second. Now each costs about a millisecond, and only a real change costs one rebuild.
- Each member row's actions are gathered into one menu, and you choose what a table's rows show.

### Fixed

- A record line the plugin can't read is kept exactly as written and reported as informational. It's never rewritten. Half-linked spans, plain-text terms and connector words inside values all stay as you wrote them.
- Renaming a vocabulary entry rewrites every reference to it, in properties and record lines alike. Both the link targets and the displayed names are updated. Unrelated notes that just share a name are left alone, because a bare name only matches where its kind agrees.
- The migration reads exactly what 0.7.0 wrote. The base role sheets are converted from their 0.7.0 forms, and every note the migration passes through is stamped. Nothing depends on formats that only development builds ever produced.
- Repairs report what they did, not what they tried. A repair that changed nothing says so, and the health check's counts hold up when you look again.

## [0.7.0]

### Added

- Character and scene notes show their fields in the note body, as an overview above your writing. The labels and values are in the project's language, and the point of view and the cast are links. The whole block is generated from the note's own properties. It's ordinary Markdown, so it reads the same in reading view, live preview and source mode. It also stays readable with the plugin turned off. The Properties panel cuts long key names short and shows them in English whatever the project's language. The overview is the answer to that.
- The overview keeps itself up to date. Editing a field in the dashboard or in the Properties panel rewrites it. Text typed into the block is changed back to match the properties. The editor refuses edits inside the block, and tells you where to make them instead.
- Existing notes get their overview when you ask for it. A line above the character and scene tables counts the notes written before this release. It can add the overview to all of them at once. The command **Write field overviews into character and scene notes** does the same for the current project. Until then, those notes keep working from their properties, and none of them is reported as damaged.
- The generated base views grow. Opening one adds a column for any property the notes have that the base doesn't list yet. That includes a property you add yourself. The columns and views you arranged stay as they were.
- **Restore base**, in the menu next to **Open base**, rewrites a base from the current template. It asks first, because the views and arrangements added in that file are replaced.

### Changed

- A scene's conflict is now stored as a property instead of a section of prose. That's what lets the scene table, the search, the base views and the overview all show the same thing. A scene written before this keeps reading its conflict from where it was, until the overview is added to it.
- The scene base lists the conflict, and translates the two points of view that don't name a character. The character base's **All Characters** view lists every field of the sheet, not just four of them. A base made before this gets all of it through **Restore base**.
- New character notes give their step 3 section the heading **One-Paragraph Storyline**, since that's what the step writes there. Notes you already have keep their current heading.
- Opening a step note from a table highlights the overview beside the prose that step fills in.

### Fixed

- You can repair a note that's open in an editor without turning boundary protection off first. The protection is meant for what a person types, but it used to refuse the plugin's own writes as well. That left the editor showing the old text, which it could save back over the repair.
- Opening a step note from the dashboard brings its section to the middle of the page. Obsidian restores a note's own scroll position just after it opens. The centering used to happen before that, and was then undone by it.

## [0.6.0]

### Added

- The character and scene tables scroll through the whole list, drawing only the rows in view. That way, three hundred characters or three thousand scenes cost the dashboard nothing. Steps that share a table also share its scroll position. Moving between steps 3, 5 and 7, or between 8 and 9, keeps the same rows on screen.
- A search box and a filter above each table. You can search characters by name, type and storyline. You can search scenes by name, point of view, time, location, conflict and cast. The filter narrows the characters to one type, or the scenes to one point of view. A count shows how much of the list is left. Dragging is paused while the list is filtered, because the rows in between are hidden.
- Every row's menu can move it exactly. The options are **Move up**, **Move down**, **Move to position…** by number, and **Move after…**, which finds the destination by name. **Insert character after** and **Insert scene after** put a new entry right below the row instead of at the end of the list. All of these work over any distance, and keep working while a filter is on.
- The character table now numbers its rows, as the scene table always has.

### Changed

- Both tables use the same columns and reach the bottom of the window. They show storylines and conflicts in full instead of cutting them to one line. The scrollbar runs beside the table, under its header, not over the rows.
- Opening a project reuses the notes it has already read, as long as their files haven't changed. It also lets go of whatever a rename or a delete leaves behind. With three thousand scenes, a dashboard that took a second to open now opens in a tenth of a second.

### Fixed

- When the arrow keys take you into a long chapter, the divider you cross now holds still until the chapter has finished measuring itself. A chapter that has only just loaded adjusts its line heights for a moment. Where you landed used to drift along with them.

## [0.5.1]

### Changed

- Focus mode fades and hides parts of the app. The styles that do this now follow classes the plugin puts on each pane, not selectors that check what a pane contains. Nothing looks or behaves differently. The `:has()` selectors this replaces are the kind the plugin review warns about, because the browser re-checks them broadly as the page changes.

## [0.5.0]

### Added

- Typewriter scrolling: the line you're writing stays in the middle of the page, and the page moves under it. A mouse click still leaves the words you clicked under the pointer, and centering takes over at your first keystroke. It's on by default, with a button in every chapter's header and a command to turn it off and on.
- Focus mode: while you write, everything except the paragraph you're writing fades. That covers the rest of the note, the neighboring notes and the rest of the app. It has four levels, and each one reaches further than the last. With **on**, the dashboard stays bright. With **deep**, it fades with everything else. With **solo**, you see nothing but the manuscript, in full screen. Note paths and order numbers are hidden, and the side panes are folded away. The button in every chapter's header steps through the levels, and four commands in the command palette set each one directly. The slider under **Manuscript stream** explains each level as you choose it. Leaving the stream restores the app, and coming back restores the mode.
- The arrow keys move from one note into the next. Press up or down on a note's first or last line, or left or right at its first or last character. The caret then crosses the divider into the neighboring note. The divider you cross stays exactly where it was on screen.

### Fixed

- If the caret has scrolled off the page, pressing an arrow key brings the page back to it in one measured move. The editor used to respond with its own scrolling, worked out against a page the sliding window had already changed. A single press could throw you across several notes.
- Scrolling far enough to slide the window no longer takes the keyboard away from the note you're writing. Only the notes that actually changed places move now, so the editor holding your caret is never lifted out of the page while you write.

### Changed

- The settings under **Manuscript stream** have shorter names and one-line descriptions, and the two sliders now look alike.

## [0.4.1]

### Fixed

- Clicking a word in the manuscript puts the caret in that word, even when there's Markdown syntax between the words you clicked. The page shows prose without its emphasis marks, heading marks, link targets or the newline of a soft break. So any passage that crossed one of them couldn't be found in the file. The caret was then placed by the height of the click instead. The longer the chapter, the further from the word it landed, and it was worst at the end of a chapter. Now the words are matched against the file with its syntax set aside. That puts the caret on the character you clicked.
- Clicking beside a short stretch of bold, or a link, no longer sends the page to the top of the note. The words used for the search stopped at the edge of whatever you clicked. A stretch too short to search for left nothing to go on.
- In a chapter that repeats a sentence, the caret goes to the copy you clicked, not the first one in the note.
- The line between two notes offers what the manuscript allows now, not what it allowed when that line was first drawn. A one-note project that had gained a second note kept saying there was nothing to merge. That lasted until the stream was closed and opened again. And the name a merge offered stayed the name that note had when the line was drawn.
- The line above the first note now offers to insert one, just like the line below every other note. It was the only line in a manuscript that offered nothing.
- The last seven tooltips drawn by the browser are now the plugin's own. They cover a note's path in the manuscript and the note offered on step 10. They also cover a character's name and one-sentence storyline, a scene's name and conflict, and the tags in a picker.

### Changed

- The type checker now holds the source to the language version the plugin states. A Node type declaration had been letting it use a method newer than that version. Code using that method would have compiled and shipped without any warning. Nothing behaves differently.

## [0.4.0]

### Added

- The manuscript stream: read and write a whole draft as one continuous page, while every chapter stays its own Markdown note. Click a chapter and it becomes an editor, with the caret in the word you clicked. Move to another, and the first one is typeset prose again. The line naming the chapter you're in stays at the top of the page until the next chapter reaches it.
- A project's manuscript is made up of the notes it has, not one note called Draft. Each note records its place in `snowflake-manuscript-sequence`, so moving or renaming a note never changes where it's read. An existing project needs nothing done to it: a single draft note is a manuscript of one.
- Insert a note before or after the one you're reading, split the one you're writing in at the caret, or merge the next one into it. Merging asks first, because it's the only one of the three that removes a note.
- Ways in from wherever you are. **Open manuscript stream** on step 10 takes you back to the note you last wrote in. You can also use the command palette, or the right-click menu of any manuscript note in the file explorer.
- Ten commands for the manuscript. They open and close the stream, move to the next or previous note, and return to where the stream was opened. They also insert a note on either side, split at the cursor, and toggle what each note's line shows. Seven of them are offered only while a manuscript stream is the current view. The command that opens the stream is available once a project has been opened, and the two toggles are always available.
- Three settings under **Manuscript stream**. One sets how many notes are kept on each side of the one you're reading. The other two choose whether a note shows its file path and its stored order number.
- The health check reports manuscript positions that are missing, unreadable or shared by two notes. It fixes all three the same way. It keeps the order the manuscript reads in now, and writes that order down properly. Nothing below the frontmatter is touched.

### Changed

- Tooltips are now Obsidian's own throughout, instead of the browser's.

### Fixed

- One tooltip where two used to appear. Seventeen controls had both an accessible label and a browser title, so Obsidian's tooltip and the browser's were drawn on top of each other. These were the project switcher, the step buttons, the health check, the table markers and warnings, the toolbar buttons, the project manager's controls, and the dashboard's own tab.

## [0.3.2]

### Fixed

- Renaming a project no longer breaks its links. When Obsidian renames a folder, it rewrites every link inside it, shortening each one and dropping the `.md`. But the plugin was still reading the stored text as a file path. So the draft was reported missing, even though it was right where the link said. Opening a scene cleared its point of view and emptied its cast, and both were lost on save. Links are now followed the way Obsidian follows them.
- A scene now names characters from its own project. A second project with a character of the same name used to capture the first project's scenes. That's because a shortened link stops being unique the moment the name is used again.
- A project folder renamed outside the plugin is now reported instead of going unnoticed. A repair brings the folder back to the project's name. To keep the new folder name, rename the project itself.
- When a character's or scene's file name or heading no longer matches its stored name, you're told which of the two it is. Its row in the table is marked too.
- The draft's heading no longer includes the project name. Nothing kept that name up to date when the project was renamed.

### Added

- The health check names each way a stored link can be wrong, and fixes each one differently. It catches a path typed as plain text where a wikilink belongs, and a link shortened until it depends on a name staying unique. It also catches a link that opens a note in another project, and a link to a note that no longer exists. A link that still has a file extension is caught too.

### Changed

- Links are written the way Obsidian writes them, without the `.md` it never shows. The draft link uses the note's name as its display text, like every other link. Existing projects keep their stored links, and both forms are read.
- Because the draft template changed, existing projects report that template as out of date once. Repairing it takes a click and changes nothing you wrote.

## [0.3.1]

### Fixed

- Removed a use of a JavaScript method newer than the language version this plugin targets. The value it returned had no resolved type. Nothing behaves differently. The source now type-checks against the target it states.

## [0.3.0]

### Added

- Type-to-filter pickers for a scene's point of view and its cast. Typing narrows the characters on offer. If the project doesn't have a character yet, you can create it straight from the field without leaving the scene form.
- An add row at the end of the character and scene tables. You can add the next one right where you stopped reading, instead of using the button above a long list.
- Duplicate names are refused. A character, a scene or a project can't take a name that another of its kind already has. The form tells you so under the field as you type the name. Names that differ only in capitalization or spacing count as the same, because the note file names do too.

### Changed

- When Obsidian starts or the plugin reloads, the dashboard opens on the first step that isn't finished. Within a session, it stays on whichever step you last chose.
- **Rename project** now uses the **Create project** dialog without its language field, instead of a layout of its own.
- The project root folder is now the same field on the settings page and in the project manager.

### Fixed

- Scroll position and expanded sections are kept after a refresh. The dashboard no longer jumps back to the top when a project changes underneath it.
- Deleting a character that scenes still refer to now lists those scenes first. It also takes the character out of their casts, instead of leaving links that lead nowhere.
- Every panel that scrolls keeps space for the scrollbar, whether or not one is showing. So adding the character that first fills a panel no longer narrows everything already in it.
- A table cell has room for the paragraph it can hold.
- A narrow dashboard no longer shows a horizontal scrollbar a few pixels wide.
- Opening another project's dashboard no longer shows the previous project for a moment first.
- Suggestion lists show every match instead of stopping at fifty. They take the width of the field they belong to. They close when the window or a pane is resized, instead of staying where the field used to be.

## [0.2.0]

### Added

- Bases views for characters and scenes. Every project sets up `Characters.base` and `Scenes.base` in its character and scene folders. They're filtered to that project and sorted in the order the dashboard keeps. Existing projects get them at their next health check.
- **Open base** on the character and scene panels, next to **Add character** and **Add scene**. If a base has been deleted, it's written again when you open it.
- **Open character base** and **Open scene base** commands.
- A health check for a missing base, which you can repair from the health checker.

### Changed

- The character type column is shown in the project's language. The stored value stays in one standard form, so notes remain portable.

## [0.1.1]

### Fixed

- Renaming a character or scene now renames its note file and updates the note heading, so the dashboard, the file explorer, and the note itself agree.
- Renaming a character now refreshes the links to it in scenes. A point-of-view or cast entry then shows the new name instead of the old one.

### Added

- A health check for a note whose file name or heading no longer matches the name stored in it. You can repair it from the health checker.

## [0.1.0]

- Initial public release.

<a id="简体中文"></a>

# 更新日志

**[English](#english)** · **简体中文**

本文件记录本项目的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [0.23.0]

### 新增

- **导出为 Obsidian 白板。** 自由画布、时间线与节拍表的工具栏末尾各多了一个按钮，会把当前视图导出为 Obsidian 白板文件，放在工作区自己的文件旁边：`732_自由画布/<视图名称>.canvas`、`733_时间线/<视图名称>.canvas` 或 `734_节拍表/<节拍表名称>.canvas`。笔记会变成文件卡片，并保留各自的颜色。分组、时间线与幕会变成白板的分组。画布上输入的文字、子描述与节拍则变成文本卡片。工具栏上隐藏子描述、堆叠场景与倒序这几个开关只改变屏幕上的显示。白板里始终写出子描述，把场景放在它们旁边，并保持原本的顺序。任务、伏笔与修订不是笔记，所以各自变成一张写着名称的文本卡片，卡片之间的连线连同箭头与标签都会保留。写入后白板会立即打开。如果同名文件已经存在且内容不同，会先征求你的同意再替换。内容相同时不会重复写入，只会直接打开白板。插件不会读取这个文件，你可以在白板里随意编辑或删除它，工作区不受影响。

### 变更

- 自由画布工具栏的**添加视图**按钮改用网格图标，旁边的白板导出按钮则用 Obsidian 白板自己的图标。

### 修复

- 以点开头的名称在变成文件名时会去掉开头的点。Obsidian 不会显示这样命名的文件，之前这样的笔记或白板写入后就再也找不到了。

## [0.22.1]

### 修复

- 在 Obsidian 自己绘制的菜单里，例如 Windows 和 Linux 上，自由画布的每个菜单项现在都会显示图标。节点菜单中的**自动**、**紧凑**、**标准**与**扩展**原本没有图标，文字前面空着一块。设置菜单和右键菜单里的**对齐网格**，用的是 Obsidian 没有的图标，所以什么也不显示。现在**对齐网格**与**对齐对象**使用和 Obsidian 白板相同的图标。
- 卡片上的进度下拉列表，现在每个状态都显示自己的颜色。在 Windows 和 Linux 上，展开的列表以前会把所有选项都显示成当前所选状态的颜色。可视化工作区所有标签页里的卡片都是如此，不只是自由画布。

## [0.22.0]

### 新增

- **自由画布**是可视化工作区四个视图中的最后一个，也是唯一没有网格的视图。每个**视图**都是一块空白画布，一个项目想建几个都可以。在工具栏开头的选择框里切换视图，用**添加视图**创建，用铅笔按钮重命名或删除。也可以在命令面板中用**打开自由画布工作区**打开它。项目一开始有一个名为**主视图**的视图，等你第一次往上面放东西时，它才会写入文件。
- **项目里的任何东西都能摆成卡片。** 角色、场景、时间、地点、物品与自定义种类，还有任务、伏笔、修订与便签，都能放上画布。它们在画布上的卡片，和在各自工作区里的一样，底部标着种类与颜色。双击卡片，就会打开它背后的笔记或记录。画布上还能放就地输入的**文本**和项目里的**任意文件**，图片、视频与音频会按原样显示。**网页链接**也能放，但只显示网址，不会抓取任何内容。**添加节点**按种类和名称挑选要放的东西。底部的快速添加栏里，每一种都有自己的添加按钮。在表单里输入一个还没有笔记的名称，就能当场建出这篇笔记。
- **连线与分组。** 从一张卡片拉到另一张，就连上了一条线。箭头可以两端都没有，也可以只在一端，或者两端都有。线型有实线、虚线、点线与点划线，线上还能写标签。**分组**会把放进去的卡片收在一起，移动分组时，里面的卡片也跟着走。分组可以着色、加标题。**贴合内容**会让分组重新围住里面的卡片。
- **应用本身的手势。** 拖动就能移动和调整大小。滚轮平移画布，按住 Ctrl 或 Cmd 再滚动则是缩放。用空格或中键也能平移。在空白处拖动可以框选。卡片会吸附到点阵，也会吸附到其他卡片。角落的控制按钮可以缩放、总览与重置，还能撤销与重做每一步。小地图让你随时看到全局。搜索可以按文字找到卡片。复制、剪切、粘贴与创建副本，对卡片同样有效。每个手势都有不用手势的做法。移动和调整大小可以用方向键或**大小与位置**。连线可以用**连接到**、**更改起点**与**更改终点**，分组可以用**移入分组**。其余操作都在菜单里。
- **视图各自保存在自己的文件里**，位于 `732_自由画布` 之下，每个视图一个 `freeform-view-<id>.json`。文件记录每样东西摆在哪里，以及你在画布上输入的文字，从不保存笔记的内容。读取方式与时间线文件相同：读不懂的条目会放在一旁，不会丢弃。更新版本插件写入的文件会原样保留。损坏的文件会另存一份，再从头开始。删除最后一个视图后，`freeform.json` 仍会留在原处。这样再打开项目时，就不会又出现一个全新的主视图。
- **时间线与节拍表上的搜索**，位于各自工具栏的中间。用法和场景看板一样：会显示匹配的数量，按 Enter 逐个跳转，其余内容会淡去。
- **角色与世界观笔记的颜色**，保存在笔记里，和场景的颜色用同一个键。颜色可以在画布上卡片的色板中选择。

### 变更

- 工作区的标签条已经齐全：**自由画布**位于场景看板与时间线之间，此前那里写着「规划阶段…」。
- 每个工作区的工具栏都采用同一种布局：视图选择框在开头，搜索在中间，工具在末尾。工具栏放不下时会横向滚动，不会隐藏任何东西。
- 新项目会建出 `732_自由画布` 文件夹。健康检查也会像对待其他工具文件夹那样，提议把它补回来。

## [0.21.0]

### 新增

- **节拍表**是可视化工作区中做好的第三个视图，关注的是每个场景在故事结构中起什么作用。一张节拍表由**幕**组成，幕按次序自动编号，也可以再加一个标签。幕下面是**节拍**。节拍背后没有笔记，所以它的名称与描述都保存在节拍表里。一个项目可以保存任意多张节拍表，每次显示一张，在工具栏开头的选择框中切换。用工具栏上的**添加节拍表**与**添加幕**来创建它们，用铅笔按钮重命名或删除当前的节拍表。命令面板中的**打开节拍表工作区**可以直接打开这个标签页。
- 创建节拍表时可以选择**模板**。内置的有**空白**、**三幕式**、**起承转合**、**故事圈**、**救猫咪**、**英雄之旅**和**言情节拍**。每个模板都带着幕和节拍，还有一句说明，讲每个节拍用来做什么。这些内容以项目自身的语言写入。在你选定之前，表单会显示所选模板包含多少幕、多少节拍。工具栏上的**导出为模板**会把当前节拍表保存为你自己的模板。模板会保留幕、节拍及其描述，不包含子描述和场景。与已有模板同名时，会替换旧的模板。自定义模板可以在同一个表单中删除。
- **每个节拍之下都可以写子描述、放入场景**，和时间线上某个时间之下完全一样。子描述在节拍末尾逐行添加，可以就地编辑。旁边的**场景池**里，是这张节拍表还没有放入的场景。同一个场景在一张节拍表中只占一个位置。平铺或堆叠场景、隐藏子描述的眼睛按钮，以及两个角落的折叠按钮，都和时间线相同。节拍表还有一个自己的开关，可以让最后一幕排在前面，而且不改变任何编号。
- **每一种拖动都有对应的菜单操作。** 幕可以拖动手柄来移动，也可以用上移、下移和**在后面插入幕**。节拍可以拖到任意一幕的任意位置，空的幕也可以。节拍还可以用上移、下移（可以跨过幕的边界）、**移动到幕**和**在后面插入节拍**。子描述可以在节拍内移动，也可以用**移动到节拍**移到别的节拍下。场景可以用**移动到子描述**移动，或者用**从此节拍表移除**放回场景池。凡是会丢失文字或场景位置的操作，都会先询问你，并说明会一并移除什么。
- **节拍表保存在一个文件里**，位于项目的可视化文件夹下：`734_节拍表/beat-sheet.json`。项目自己的模板也保存在这个文件里。文件只保存场景的 ID，不保存场景的名称。读取方式与时间线文件相同：无法读取的条目会单独保留，不会丢弃。由更新版本插件写下的文件会保持原样。损坏的文件会另存一份，然后重新开始。

### 变更

- 工作区的标签条上，**节拍表**已经和场景看板、时间线一样可以使用，只剩自由画布仍写着「规划阶段…」。
- 场景池为空时，时间线和节拍表都显示**所有场景都已放入**，不再提到时间线。
- 健康检查现在对 `70_工具` 下的所有文件夹一视同仁。以前，三个数据统计文件夹缺失时会被报告为损坏。比它们更早创建的项目因此显示为需要修复，步骤状态也不再同步。而旁边的六个文件夹缺失时，只是一条提示。这九个文件夹都会随新项目一起创建，有内容写入时也会自动重建。所以现在它们全部只作为提示，并附带修复按钮，不会再把项目标记为损坏。条目的文字改为**该项目文件夹不存在**。无论文件夹是被删除了，还是从未创建过，这句话都成立。以前的说法是文件夹尚未创建。

### 修复

- 在时间线上某个时间的末尾输入文字时，如果这个时间已被移出时间线，不会再提示项目拒绝写入。现在的提示会说明该时间已不在时间线中，输入的文字也会保留下来，供你复制。
- 插件卸载过程中，如果时间线上场景卡片的写入被拒绝，文字会写到控制台，和场景看板上的卡片一样。不会再弹出一个无人管理的对话框。
- 如果第一次读取时无法访问时间线文件，时间线不会再一直空着，非要重新打开标签页才恢复。失败的那次读取会被丢弃，下一次会重新读取。

## [0.20.3]

### 修复

- 场景池的工具栏不再显示筛选结果的数量。一张卡片宽的工具栏，放不下「1 / 5」这样的两个数字。它们会上下堆叠，把工具栏撑高，和旁边的工具栏错开。场景池标题右侧的计数，仍会显示池中还没放入时间线的场景数量。
- 分组标题过长时会被截断，并以省略号结尾。把指针停在标题上，可以看到完整的标题。以前标题不会截断。按关联正文分组时，章节名比场景池还宽，会盖住卡片，并超出场景池的边界。

## [0.20.2]

### 修复

- 场景池收窄到一张场景卡片的宽度。池中的卡片和时间线上的场景卡片一样宽，拖动时大小不再变化。搜索框、「场景池」标题、右侧的计数，以及拖回场景时出现的高亮框，现在左右两端都对齐了。0.20.1 为了给高亮框留出空隙而加宽了场景池，结果搜索框和下方的标题错开了。工作区自动收起时间列与场景池时的窗口宽度，也恢复为 0.20.1 之前的数值。
- 场景池的搜索框里不再显示提示文字，因为一张卡片宽的工具栏已经放不下这几个字。把指针停在搜索框上，仍会说明它的用途，屏幕阅读器也仍会读出来。

## [0.20.1]

### 修复

- 单元格底部那个添加子描述的输入框，现在只在指针停在该单元格上，或焦点落入该单元格时才显示。拖动进行时它也会显示，因为子描述行和场景都可以放到它上面。以前只要单元格里还没有子描述，这个输入框就一直显示着。只有一条时间线时，这句提示是有用的。但多条时间线并排时，每个空单元格都会显示同一句提示，反而成了干扰。现在不论上方有没有子描述，显示规则都一样。输入框里的提示文字，仍会随上方是否已有子描述而变化。在触摸屏上，这些输入框始终显示，和那里的其他控件一致。
- 把场景拖回场景池时出现的高亮框，现在是带圆角的虚线框，四周留有空隙，还有一层同色的淡淡底色。它用的是时间线各列和单元格已有的强调色。以前它是直角的内阴影，而且被卡片遮住。卡片正好紧贴面板两侧，所以左右两边只能从卡片之间的缝隙里看到它。场景池相应加宽了，加宽的幅度正好是让出的这部分空隙，所以卡片宽度不变。场景池变宽后，工作区自动收起时间列与场景池时的窗口宽度，也相应提高了 1rem。
- 时间线各列之间的间距改用 gap 简写属性来写，不再单独使用 column-gap。社区审核的浏览器兼容性检查会把 column-gap 判定为多栏布局。两种写法设定的间距完全相同，行与行之间原本也没有间距，所以显示效果没有任何变化。

## [0.20.0]

### 新增

- **时间线**是可视化工作区中做好的第二个视图。它关注的不是场景的阅读顺序，而是场景发生的时间。每条**时间线**自成一列，有自己的名称，也可以绑定到某个角色或世界观笔记。**视图**决定显示哪几条时间线，以及它们的排列顺序。一个项目可以建立任意多个视图。在工具栏上，用**添加时间线**和**添加视图**来添加它们。在视图的表单里，可以重命名视图，用拖动手柄调整其中时间线的顺序，添加或移除时间线，也可以删除视图本身。命令面板中的**打开时间线工作区**可以直接打开这个标签页。
- 左侧是所有时间线**共用的时间列**，内容来自项目中已有的时间笔记。主描述保存在笔记里，不会复制到时间线中。每条时间线都和这些时间按行对齐，所以可以直接横向比较。轴线上的节点，标出每条时间线实际涉及的时间。时间可以从时间线的表头添加，也可以点击空单元格中的加号添加。时间还可以插入到另一个时间之前或之后，并用拖动或菜单调整顺序。移除某个时间时，它在这条时间线上的子描述会一并移除。点击描述，会打开该时间笔记的表单，并定位到描述字段。笔记已被删除的时间会显示为「时间笔记已缺失」，只能移除。
- **子描述**在单元格中逐行书写，记录某条时间线在某个时间发生了什么。在末尾的输入框中输入并确认，就能添加一行。焦点会留在原处，方便你接着写下一行。已有的行可以就地编辑。行的菜单可以上移、下移、移动到其他时间，也可以移除这一行。如果行中已放入场景，移除前会再确认一次。子描述无法写入时，原本会丢失的文字会保留下来。该行还在的话，文字会保留到下次编辑。该行已经不在的话，文字会显示出来，供你自己复制。
- 右侧的**场景池**是单列的场景看板，里面是当前时间线还没有放置的全部场景。它的搜索、筛选、显示与排序都和看板相同。把卡片从池中拖到某条子描述上就能放置，拖回池中就能收回。一个场景在同一条时间线上只占一个位置，所以再次放置是移动，而不是复制。这些操作都不必依赖拖动，**移动到子描述**、**移动到时间**、**移动到位置**等菜单项也能做到。
- 场景的展示方式可以按视图设为**平铺**或**堆叠**。平铺会把每张卡片依次排开。堆叠只显示最前面的一张，并配有计数和左右箭头，可以逐张查看。视图中只有一条时间线时默认平铺，有多条时默认堆叠，手动设置之后以设置为准。在工具栏上，还可以隐藏子描述，只看卡片。也可以让最晚的时间排在最前，或者收起时间列与场景池。窗口宽度容不下两者时，它们会自动收起。
- 时间线**保存在一个文件中**，位于项目的可视化文件夹下。文件里只记录标识，也就是场景与实体的 id。它们的名称与描述不会记进来，仍保存在各自的笔记里。这个文件的读取规则和任务、伏笔、修订的文件一致：无法读取的条目会原样保留，不会丢弃。由更新版本的插件写入的文件会保持原样。已损坏的文件会另存备份，然后重新开始记录。

### 变更

- 工作区的标签条现在依次是**场景看板**、**自由画布**、**时间线**与**节拍表**。时间线已经做好，所以排到了节拍表之前。**情节线**已从标签条中移除。
- 每张场景卡片的顶部中央都有一个**拖动手柄**。指针移到卡片上，或者正在拖动卡片时，它就会显示。卡片不能拖动时则不显示。场景看板中的卡片也是如此，因为场景看板、时间线的各列和场景池现在共用同一种卡片。

### 修复

- 插件正在卸载时，如果场景的文字写入失败，这些文字会输出到控制台。不会再弹出一个在工作区关闭后仍留在屏幕上的对话框。如果只是关闭工作区，仍会像以前一样弹出对话框。
- 未保存的文字不会再被写回已经不存在的卡片。写入过程中被移除的卡片，以及所属场景已被删除的卡片，都会被跳过。它们不会再被当成你当初正在编辑的那张卡片。

## [0.19.0]

### 新增

- **可视化工作区**在自己的标签页中打开。里面是一组视图，看的都是同一批场景，也就是你在第八步与第九步规划的那些场景。**场景看板**是其中第一个做好的视图。**自由画布**、**节拍表**、**时间线**与**情节线**排在标签条上，轮到它们之前都写着「规划阶段…」。入口有三处：工作台创作工具一组末尾的链接行、功能区中的行星图标，以及命令面板中的**打开可视化工作区**与**打开场景看板工作区**。它和数据统计、便签一样，跟随当前项目。按住 Cmd 或 Ctrl 点击标签条上的标签，会在旁边另开一个，而不是替换当前这个。
- **场景看板**把每个场景摆成一张卡片，按叙事顺序编号。你直接在卡片上操作，不必再点进表单。名称可以就地编辑，空名称和已被其他场景占用的名称都会被拒绝。视点人物与进度是下拉框。如果某个视点人物的笔记已经不在，它会作为一个单独的选项保留，不会悄悄消失。冲突写在一个文本框里，移开焦点或按 Mod+Enter 即可保存。色板可以给卡片涂上便签所用的八种马卡龙颜色之一，也可以不着色。所有写入都走同一条队列，所以接连做的两次修改都会保存下来。每次写入后，卡片会采用这次写入返回的版本号，而不是绘制这一帧时的版本号。
- **看板就是用来排次序的。** 看板按普通顺序排列时，拖动卡片就能移动场景，只会重写它周围的排序值。两张卡片之间的 **+** 会恰好在那个位置插入场景，**添加场景**则加在末尾。卡片自己的菜单里还有上移、下移、**移动到位置**与**移动到某项之后**，不用鼠标也能做同样的事。方向按钮可以把整块看板切换为**倒序**，这时上移会让场景在故事中更靠后。一旦开始搜索、筛选或分组，依赖相邻关系的操作就会收起，只留下明确指定目标的那些。
- **搜索、筛选与分组。** 搜索框按名称筛选，漏斗按进度、类别、视点人物、时间、地点、人物、颜色或关联正文筛选。**显示**可以把卡片设为紧凑、标准或扩展，也可以按上述八项中的任意一项分组。每组上方会显示标题，每张卡片仍保留自己的叙事编号。卡片大小、分组与方向按项目分别记住，重启后依然有效。只有视野之内的卡片才会被绘制，所以三千个场景的看板和五个场景的一样流畅。
- **每个场景新增两个字段**：**颜色**存为 `snowflake-color`，**关联正文**存为 `snowflake-linked-manuscript`。关联的正文笔记按你写的原样保存，子路径与别名都会保留。两个字段都排在场景表单的事件之后，也都可以在漏斗中筛选场景表格与看板。卡片会列出该场景所属的章节，点击即可打开对应的那一章。当链接指向值得一去的地方时，表单的按钮会提供**保存场景并打开{name}**。
- **漏斗中新增场景范围**，可以填写最小与最大场景序号，把表格与看板收窄到故事的某一段。这不会影响依赖相邻关系的操作。新增的**在其前插入场景**，与原有的向后插入并列。
- **未保存的场景文字会被保留**：卡片的写入被拒绝时，这些文字会汇总到一个窗口里供你复制，不会随看板一同消失。
- 两条侧边栏命令现在会说明打开的是哪个侧边栏：**打开便签侧边栏**与**打开写作时段侧边栏**。

### 修复

- 编辑成员时，改动会保存到打开对话框的那个工作台所属的项目。对话框开着时，无论哪个项目成了当前项目，都不影响这一点。重命名或删除类别、添加类别路径、保存自定义字段模板的对话框，现在都会记住打开它们时的项目。编辑角色、场景或世界观笔记的对话框，以及移动到位置与移动到某项之后背后的对话框，也是如此。以前对话框开着时点进另一个项目，写入就会落到那个项目上。如果那里恰好有同名笔记，这次写入还不会有任何提示。
- 托管区段标记受损的笔记，插件现在会拒绝写入，而不是覆盖它。角色、场景与世界观笔记都是如此。以前保存这类笔记时，会在旧标记下方另写一份标题与标记，把你的正文留在所有托管区段之外。那条健康问题也随之被抹去，于是检查器接着报告项目一切正常。健康报告也不再为这类笔记提供**编辑**，改为提供**打开**。
- 筛选答案所依据的笔记被重命名或删除时，场景表格的时间、地点与类别筛选会被清除，和视点人物、人物筛选一样。以前留下的失效答案会让表格空无一物，而那一行漏斗看上去却像什么都没筛选。
- 项目切换器上的受损标记，现在与健康检查器的结论一致。检查器视为提示的记录行，不再点亮这个标记。受损的世界观笔记以前被这个标记完全忽略，现在会点亮它。

## [0.18.1]

### 新增

- 工作台的导航栏可以用栏首的按钮收起，分栏多宽都可以。分栏窄到放不下步骤名称时，导航栏本来就会自动收成一列图标。现在任何宽度下，你都可以主动把它收起：文字隐去，图标与数目留下。再点一次按钮，即可重新展开。每个工作台各自记住自己的选择，重启之后依然有效。命令面板中的**切换工作台导航栏**也能做同样的事。这条命令只在有空间重新显示文字时才会出现。
- 便签的悬浮按钮现在既能让面板浮起，也能把它收起。便签已经在本窗口悬浮时，点击工作台卡片或侧栏紧凑卡片上的这个按钮，就会关掉那个面板。显示这张便签的每一张卡片都会随之更新。

### 修复

- 四位数的计数现在会留在圆圈之内，不再溢出。每一处画着圆圈的地方都是如此，包括导航栏中的种类与词表、实体追踪的折叠区，以及任务看板的列、派生卡片与归档。便签的归档和项目管理器中的归档也一样。以前只有导航栏中的计数会缩小，而缩小后的尺寸连三位数都已经装不下。
- 写作阶段圆环正中的读数，现在始终留在圆环中间的空当里。专注时长累计到一百小时以上时，读数会长到九个甚至十个字符。这时字号会恰好缩小一点，不再压到圆环上。

## [0.18.0]

### 新增

- **任务**是任务管理四个标签页中的最后一个。它是一块看板，共有六列：待处理、进行中、阻塞中、待检查、已完成与已取消。你自己的任务是一张张卡片，写着标题、描述、从低到紧急的优先级和截止日期，标题不能与其他任务重名。卡片还记着任务涉及的角色、场景与世界观笔记。这些笔记按各自的身份而不是标题来识别，所以重命名笔记不会丢掉关联。标签页上的**添加任务**和命令面板中的**新建任务**都会打开表单。卡片可以在同一列中拖动排序，也可以拖到另一列来改变状态。卡片的菜单里有**编辑**、**归档**与**删除**，不方便拖动时，也可以用菜单移到其他任意一列。紧急的任务，卡片左侧会多一道竖条。已经过期的截止日期会变红，但这只是外观，不是状态。已完成或已取消的任务从不算作过期。看板的另一半由插件自己填上，每次读取时都重新算出，从不写进文件。其中有每日、每周与每月的写作目标，它们会随着你写下的字数，从待处理经进行中走到已完成。还有仍在进行的伏笔线索，以及所在章节已对不上的落点。还有尚待处理的修订，以及底下文字已被改动的修订。另外还有无法归到某一个实体名下的提及、你列出的敏感词，以及等着查看的便签。这些卡片会放在各自数目所对应的那一列。点击一张，就会打开它所统计的那个标签页，并按它统计的内容筛选好。数目归零时，卡片会自动消失。命令面板中的**切换任务看板中的派生任务**可以把它们全部收起。看板上方的搜索会搜遍每一张卡片，也可以按类型、优先级与截止日期筛选。**已归档**折叠在看板下方，有自己的搜索与筛选。其中每张卡片都带着**恢复**与**删除**，确认一次之后，也可以清空整个折叠区。你自己的任务存放在项目任务管理文件夹下的一个文件里，和修订、伏笔放在一起，读写规则也相同。看板也跟得上正在进行的写作。记下一笔字数、回收一处伏笔、接受一处修订、归档一张便签，或是过了午夜换了一天，都会自动反映在看板上，无需手动刷新。
- **修订**标签页的搜索旁多了一个筛选。你可以只看某一种修订：替换、插入或删除，也可以只看有冲突的修订。有冲突的那一行，章节名现在也和正常行一样是链接。那段文字已经无处可跳，所以点击后会打开文字所在的那一章，并高亮页边顶端固定的那张卡片。

### 变更

- 中文界面不再用「未解决」或「待定」来称呼本可以说清楚的事情。可能对应多个实体的提及，现在称为**有歧义的提及**。所标文字已经不在的伏笔落点，称为**锚点失效**，可以通过**重新锚定锚点失效的伏笔落点**接回。底下文字已被改动过的修订，原本就叫**冲突**，保持不变。两张表格的筛选行都改称**锚点**。英文表述不变。

## [0.17.0]

### 新增

- **伏笔**，顺着一条线索，从埋设一路跟到回收。在正文流中点进一章，选中埋下线索的文字，在右键菜单里选择**新建伏笔**。所选文字就成为这条线索的第一处落点。之后的段落可以用**加入已有伏笔**并入同一条线索。每一处落点标为埋设、强化或回收，线索本身则处于计划中、进行中、已回收或已放弃。每条线索有一个名称和一段描述，名称不能与其他线索重名。线索还记着它写到的角色、场景与世界观笔记。这些笔记按各自的身份而不是标题来识别，所以重命名笔记不会丢掉关联。每一处落点都会在正文原处标出，并在页边留下一张卡片，和修订用的是同一片页边。卡片上写着环节、伏笔的状态、名称与描述、所标的文字，以及你自己的备注。卡片底部有**打开**、**编辑**与**删除**。卡片上的箭头可以在整部正文的落点之间逐一跳转。落点会跟着它所标的文字走。你在它前后继续写作，甚至拆分或合并章节，它都不会走失。如果你直接改写了那段文字，落点只会变为未解决，不会丢失。用**重新锚定未解决的落点**，就能把它接到替换后的段落上。在任务管理的**伏笔**标签页中，每一处落点各占一行。可以按名称搜索，也可以按状态、环节筛选，或者只看未解决的落点。定位一栏可以跳到文字所在的地方。所有线索都存放在项目任务管理文件夹下的一个共享文件里，和修订放在一起，读写规则也相同。命令面板中的**添加伏笔**可以直接打开表单。
- **便签**，一篇短短的 Markdown 文件，用来放不必写进记录的东西：一个想法、一句提醒，或者一个稍后再回来想的问题。命令面板中的**新建便签**、功能区的便签图标，以及工作台上的**添加便签**，都会新建一张便签并立刻打开。你可以直接书写。每张便签都有两面。点击正文，就能用插件自带的编辑器书写，按 Escape 则回到渲染后的 Markdown。同一个文件会同时以三种样子出现：任务管理**便签**标签页中的卡片、独立侧栏中的紧凑卡片，以及浮在工作区上方的面板。同一时刻只有一处可以书写。在别处开始书写时，会先保存已写的内容，再把便签交接过去。悬浮面板可以拖动标题栏来移动，可以从任意边缘缩放，也可以固定位置。面板还可以调淡，让底下的页面透出来。面板停在哪里、多大、是否固定、多透明、显示哪一面，都按设备记住，不会写进笔记。专注模式从不淡化悬浮面板，仅正文一档也是如此。切换到另一个项目时，会收起原项目的面板，并取回新项目的面板。八种颜色方便你一眼分辨便签。每块面板都可以搜索便签的文字、按颜色筛选、按新旧排序。**归档**会把便签收进工作台面板下方的折叠区，同时关闭它的所有悬浮面板。在折叠区里可以阅读、恢复或删除便签，确认一次之后，也可以清空整个折叠区。每张便签都是一个独立的文件，存放在项目的任务管理文件夹下。健康检查会像检查其他受管理的笔记一样检查它。命令面板中的**打开便签**可以打开侧栏。

### 变更

- 任务管理的**伏笔**与**便签**标签页，现在有了 0.15.0 为它们预留的内容。只剩**任务**仍处于规划阶段。

### 修复

- 修订卡片的表单打开时，页边每次刷新都会保留你已经输入的内容。即使章节已对不上它所指的文字，卡片也仍会为这条修订留在原处。保存完成的那一刻，卡片就会显示新的文字，不必等到下一次读取。卡片在两面之间切换时也会重新排布，下方的卡片不会再被变高的那一张盖住。
- 拆分章节时，会先把要迁往新笔记的修订带走，再校准留下的修订。如果先校准，只要同一段话在前后两半中都出现过，后半部分的修订就会错误地锚定到前半部分的同一段文字上。
- 一个实体的名称包含在另一个名称之中时，标记顺序不再出错，外层的名称会先标出。以前同一行中较早的一处无关提及，可能占去外层名称所需的位置，里面的名称就被画到了外层名称上面。
- 点进一章开始书写时，你点击的那一行会回到原处。位置按这一行的顶端计算，而不是按指针在行内的高度。
- 工作台刷新时，不再把光标从你正在输入的地方带走。无论刷新是因为写入了一条写作记录，还是健康检查的结论有了变化，都是如此。原先拥有焦点、且仍在页面上的元素，会重新获得焦点。
- 从表格跳转到的卡片，在指针停在它上面时仍会保持高亮。以前处于冲突状态的修订，自身的样式规则更具体，会把颜色抢回去。

## [0.16.0]

### 新增

- **字数里程碑**，在页边标出累计字数。字数每达到一个间隔，那一行旁边就会出现一个小标签，写着到这里为止的字数。默认每五百字一处，计数规则与状态栏相同。**里程碑模式**可以在整部正文中按阅读顺序连续累计，也可以每章重新计数。标签会跟着写作移动：一章变长，它的里程碑也随之移动。在整部正文模式下，后面每一章的里程碑也会一起移动。用**显示字数里程碑**开启。窗格太窄、放不下标签时，标签会收起来，不会画在正文上面。
- **自动章节编号**，新章节会接着前一章编号。**编号样式**提供中文数字（第一章）、中文加阿拉伯数字（第 1 章）和英文（Chapter 1）。你也可以写自己的规则，用简化格式（如`第{nnnn}章`或`Chapter {n}:`）或正则表达式书写，同一时间只有一条规则生效。开启样式后，命名表单有两个字段：编号已经填好，名称由你来写。如果后面还有带编号的章节，还会有一个开关，把它们各顺延一号。把带编号的一章并入前一章时，会给出相反的选项：把后面的章节各减一号，让编号重新连续。所有重命名都会在写入之前先核对，只要有名称被占用，就整批拒绝。标题被你改写过的章节，会保留你的标题。规则读不出编号的章节，则保持不变。编号沿用标题原有的写法：`第十章`到`第十一章`，`Chapter 0009`到`Chapter 0010`。
- **纯文本导出**，把正文去掉所有 Markdown 与 Obsidian 标记后导出。标题只留文字，链接只留显示文本，注释与块 ID 一并去除，HTML 实体还原成它所代表的字符。正文流工具栏的导出按钮会导出整部正文。可以合成一个文件，章节之间用空行、一行短横线或三个星号分隔。也可以每章一个文件，放在按阅读顺序编号的文件夹里。每一章的标题栏都有一个按钮，只导出这一章。还有一个按钮，把同样的文本复制到剪贴板。每一行文字都是一个段落。中文项目用两个全角空格缩进，其他项目用两个 em 空格缩进。你自己打了缩进的话会保留，也可以一律去掉缩进。段落之间的空行保留还是去掉，按**导出**设置来定。文件默认保存到项目旁边的 `Snowflake Export`。你也可以在**导出文件夹**里另外指定，但不能放在项目里面。扩展名为 `.txt` 或 `.md`，两者内容相同。目标位置已有文件时，只有你同意后才会覆盖。未保存的输入会先保存。命令面板里也有对应的三条命令。

### 变更

- 专注模式的滑块和其他滑块一样，有了复位按钮。设置页面的控件也统一了宽度：数字框与文件夹框一样宽，过长的说明会换行，不会挤压控件。只有名称的一行，会与它的控件对齐。

## [0.15.0]

### 新增

- **修订**，先在正文旁提出改动，再决定要不要落笔。点进一章，选中要改的文字，在右键菜单里选择**新建修订**。所选文字会成为一处替换，建议文本留空则成为一处删除。如果只放一个光标，就会在那里插入。将被改掉的文字会在原处划去，插入的位置用一道竖线标出。但这一章本身不会改变，在接受之前也不计入字数、分析与追踪。每一处修订都是章节右侧页边上的一张卡片，写着类型、原文、建议文本与备注。**接受**会把改动作为你自己的编辑写进这一章，所以可以撤销，也计入写作字数。**拒绝**会移除修订，正文保持原样。**编辑**可以修改建议文本与备注。一处删除填上文字后，又会变回替换。卡片上的箭头可以在整部正文的修订之间逐一跳转。修订会跟着它所指的文字走，你在它前后继续写作，或者拆分、合并章节，它都不会走失。如果你直接改动了它所指的文字，它会被标为冲突，只能丢弃，不能应用。两处修订不能覆盖同一段文字。所有修订都保存在项目任务管理文件夹下的同一个共享文件里，跟着 Vault 走。文件无法解析时，会被另存起来，而不会被读取。由更新版本的插件写入的文件，则会原样保留。
- **任务管理**，工作台新增的一个面板，用来打理写作之外的事务。其中的**修订**标签页列出每一处未处理的修订，包括类型、原文、建议文本、备注与位置。你可以按其中任何一项搜索。点击位置，就会跳到这处修订在正文中的所在之处。发生冲突的修订会在这里标出冲突，并附有丢弃按钮。**任务**、**伏笔**与**便签**三个标签页先占好了位置，等着放进各自的内容。
- 有些文件夹，插件只在第一次有东西要放进去时才会创建，比如本版本之前创建的项目里的修订文件夹。健康检查现在认得这类文件夹，会以提示而不是受损的方式，提供立即创建的选项。

### 变更

- 实体追踪时写下的忽略规则，现在放在实体追踪文件夹里。正文统计缓存放在正文分析文件夹里。这样每个文件都和显示它的标签页放在一起。旧版本留在原处的文件，仍会在原处读取，第一次写入时再搬回自己的位置。健康检查也可以替你搬过去。

### 修复

- 打开编辑的一章，从第一帧起就会完整排版。CodeMirror 只排版可见的部分，其余部分的高度按拉丁字母的行来估算。所以一章中文会先缩成实际高度的一小部分，再随着阅读一波波长回来。而读者从没滚动到附近的那些行，会一直保持错误的高度。
- 关闭正文流时，会把每一个编辑器一并拆除。以前拆除时漏掉的编辑器会一直监听窗口，每次调整窗口大小都会记录一次排版错误，直到窗口关闭。
- 正文分析中一章的篇幅，现在和状态栏按同样的规则计数，按词或按字来算。标题是否计入，也遵从你的设置。所以一章的长度无论在哪里引用，都是同一个数。对话占比也以这个长度为分母。
- 中间隔着叙述的两句对话，现在会算作两段对话，不再在间隙处并成一个词。以前对话占比因此偏低。现在占比也不会再超过整体。

## [0.14.0]

### 新增

- **实体追踪**，从头到尾追踪书中出场的人与物。正文写到的每一个角色、场景、时间、地点、物品以及你自建的种类，都会在原处被找出来，写成链接还是纯文本都一样。数据统计中的**实体追踪**标签页为它们各列一行。每一行显示被提及的次数、其中已经是链接的次数，以及首次与末次提及的章节。还有一条分布线，把整本书显示成一行。展开一行，就能看到每一处提及，按章节归在一起，并附上前后的句子。点击其中一处，就会跳到正文里的那个位置。在正文中，提及会在原处标出。右键可以把纯文本的名字转成链接，也可以只在此处、在本章或在所有出现的地方忽略它。**高亮提及**决定标出哪些提及：每位成员的首次提及、还没写成链接的提及，或者全部。实体的标记默认关闭，你选定一种之后才会出现。
- **正文分析**，把草稿当作正文来读。标签页的最上方列出总阅读时间、每章阅读时间、每章句数、每句字数，以及对话在全部文字中的占比。下面每一章各占一行，可以按标题搜索，也可以按篇幅筛选。**词频**会统计词语并排出名次，还有一片由你最常用的词组成的词云。停用词与你自己的成员名称默认不计入，需要时再勾选。中文按词来统计，而不是逐字来数。阅读时间按什么速度估算，由两项设置决定：**阅读速度（词/分钟）**，以及**阅读速度（字/分钟）**。**自定义停用词**可以在内置词表之外，加上你自己的停用词。
- **敏感词**，那些你希望早点发现的词。在**自定义敏感词**中每行写一个，它们就会在正文中标出，并在实体追踪里和成员一起计数。用拉丁字母写的词，小写、首字母大写和全大写的写法都能找到。
- **对话**，靠包裹它的引号与叙述区分开来。弯引号、直引号、直角引号与双直角引号各有各的开关。对话会按章和全书分别计数。**对话呈现**可以标出引号里的段落，也可以把对话周围的一切淡去。
- **自定义高亮规则**，用你自己的样式标记正文。一条规则可以是文本，也可以是正则表达式，可以带任意多个模式，并用你选定的颜色与装饰显示。这些规则只管外观，从不计数，也从不写进你的笔记。在命令面板中用**切换自定义高亮**，可以一次开关整组规则。

### 变更

- 设置页分成了一张张可折叠的卡片式分区，每个分区展开后是它自己的设置。四类高亮也集中到一个菜单里一起设置，不再散落在整页各处。
- 自定义字段面板有了自己的边框，内容在框内滚动，最下方有一条尾线，和侧栏其他面板一致。

### 修复

- 点击含有链接的正文时，光标会落在你点的那几个字上。以前查找位置时用的是写下的原文。所以点击处之前的每一个链接，都会把光标往后推，推远的距离正是链接所藏地址的长度。
- 系统在浅色与深色模式之间切换后，表头依然与表身对齐。以前版面为滚动条预留的宽度只测量过一次，之后再也没有重新测量。
- 被其他标签页遮住的正文流或工作台，重新露出时会刷新，不再显示它被遮住时的内容。

## [0.13.1]

### 变更

- 段落的首行缩进，现在由一个与缩进等宽的空盒子撑出来，不再使用以缩进命名的那个 CSS 属性。社区审查的浏览器兼容检查会因为几个关键字报告这个属性，而正文从不使用这些关键字。在正文自己的设置下与该属性逐项比对，两种做法让每个字都落在同一位置。它们在同样的地方换行，右端也同样对齐。缩进保持为零时，也不会挪动任何一行。
- 双链浮层里的分组标题，现在由插件自己绘制，不再去修饰底下的 CodeMirror 恰好画出的那个元素。标题的样子和以前完全一样，以后那个元素再有变化，样子也不会变。

## [0.13.0]

### 新增

- **正文排版**，版面由你来定。字体、字号、行高、正文宽度、段间距、首行缩进、文本对齐与自动连字符，都可以自己选。浅色与深色模式各有自己的背景底色，还有可以照着写的网格线。阅读与写作用的是同一套排版，所以无论你是在读一章还是在写一章，版面都一样。凡是你留给主题的项，仍旧由主题决定。正文工具栏里的**排版**按钮，会直接在正文上方打开同样的这些控件。改动在哪里生效，你就在哪里看到，不必去别的设置窗口。版面重新排布时，阅读位置也会稳住。每种模式各有四种底色和一个自定义颜色。浅色模式下是鼠尾草绿、羊皮纸黄、薄雾蓝与薄雾粉，深色模式下是午夜蓝、石板灰、梅紫与靛蓝。
- **在正文里写作**，配齐散文需要的工具。正文流上方的工具栏提供撤销与重做、一到六级标题、加粗、斜体、删除线、下划线和高亮。其中加粗和斜体也能用键盘完成，按 Cmd 或 Ctrl 加 B、I 即可。输入 `[[` 会列出本项目自己的成员：角色、场景、时间、地点、物品，以及你自建的每一个种类。它们各自归在所属分组的标题下面。别名列在它所属的名字下面，所以两个成员即使共用一个别名，也分辨得清。括号、引号和 Markdown 强调标记在输入时会自动补全另一半，全角和半角都一样。回车会补上 Markdown 段落需要的空行，Shift+回车则保留普通换行。这只在散文中生效，列表、引用、表格和代码里的回车照旧按各自的方式工作。**自动配对括号与引号**、**自动配对 Markdown 语法**与**回车开始新段落**各管其中一部分，可以分别关掉。

### 变更

- 段落之间的间距现在以行为单位，默认是一行。编辑器里没有变化，因为那里的空行本来就是一行高。阅读视图的间距则随之加大，对沿用主题间距的正文来说，这个间隙比以前更宽。**段间距**可以设在四分之一行到三行之间，页面和编辑器保持一致。
- 正文默认两端对齐，**文本对齐**里也可以选左对齐。**自动连字符**默认关闭，开启后会按项目语言，用浏览器的词典在行末断开长单词。升级之后，从未设过对齐方式的已有正文，会显示为两端对齐。

### 修复

- 在表格下方的空行上按回车，现在开始的是新段落，而不是段内换行。那一行本是结束表格的空行，此前却被当成了表格的一行。于是写在那里的文字，会和下方的段落粘在一起。
- 在格式命令放下的一对标记中间输入空格，不会再把收尾的标记一起带走。此前在没有选中文字时开启的加粗或斜体，只能撑到下一次按键，接着一个空格就会把它拆散。
- 一章打开时，就已经是排好版的样子。此前点进一篇长章节的深处，会先画出几行没有对齐、没有缩进的文字，过一会儿页面自己的排版才跟上来。
- 保存冲突后保留下来的文字，现在会真正写入。一篇笔记在别处被改动时，提示会说这里的文字将被保留，但此前真正的写入交给了一个计时器。如果这一章先离开了已载入的范围，这个计时器就永远不会触发。
- 一章回到阅读状态时，以及排版发生变化时，阅读位置都能稳住。此前从一章的中途离开编辑器，会把你带到很远的地方，因为当时稳住的是这一章的顶端，而不是你眼前的文字。
- Cmd 或 Ctrl 加 B、I、E，只在光标位于正文中时才对正文起作用。此前焦点落在排版浮层的滑块或输入框上时，这些按键会越过面板，作用到后面的章节上。
- 表格的表头与表体重新对齐，对话框的字段也和它的页眉、页脚对齐了。版面会为滚动条预留宽度。此前这个宽度是在还没有窗口可量时量的，之后再也没有重量过，所以一直是零。
- 从命令面板打开的角色与场景表单，现在就是工作台用的那一份，字段一个不少。它也不会再把页面带到你没打算去的步骤。
- 选择器的列表一打开，方向键就能在其中移动。新建行的样式与列表其余部分一致。本机无法使用的字体会被标为缺失，而不是照常列出供你选择。
- 双链浮层的分组标题，样式与其他列表的标题一致。链接的种类与名称之间，用一个名称里不可能出现的字符隔开。
- 同一时间只会打开一个编辑器，它的内容来自页面真正在显示的那个项目。
- 拖动排版滑块时，版面会即时变化，等滑块停稳后才写入文件，不再在拖动的每一步都写一次。
- 无论电脑使用哪种区域设置，名称的折叠方式都一样。
- 围栏代码、表格，以及嵌套在其他区块里的区块，现在都按页面理解它们的方式来处理。计入写作字数时是这样，回车的行为也是这样。

## [0.12.0]

### 新增

- 没有计时，字数照样算。没有写作时段在进行时，你写下的字数会记在写下的那一天。所以在正文里写了一个早上，不管有没有为它开启时段，都算在那一天。每一天按项目和设备各存一份记录，放在时段记录旁边。这些字数会汇入今日字数、近期趋势、年度贡献、日历，以及每日、每周和每月目标。专注、摸鱼、总时长、时段数、写作速度、一天中的时辰分布和写作阶段，仍然只来自时段。毕竟没有计时的一天，本来就没有时间可报。**在写作时段之外记录字数**决定这些记不记，另有一条同名命令。关闭它只会停止记录，已有的档案不受影响，已经记下的日子照常可读。
- 写作时段暂停期间，以及番茄钟休息期间写下的字数，也会这样记下来。计时仍然冻结，这些字数也不会算进时段的时长。所以停下来想一想，或者让休息多持续一会儿，其间写下的字都不会再漏记。

### 变更

- 一处改动算不算写作，现在看它从哪里来，而不是看它落在笔记的哪个部分。在表单、工作台面板或渲染出的字段区块里输入的文字，会在保存时计入。所以角色的动机和正文里的一段话分量相同。由插件自身、迁移、修复或同步重写的笔记，只会重设基准，不计给任何人。正是这一点，让别的设备上的写作不会算进这台设备的当天字数。界面上显示的笔记字数不变，仍然不计插件写入的区块。

## [0.11.0]

### 新增

- 状态栏会统计你眼前的文字：正在写的笔记、你选中的一段，或者光标所在的标记区段。它统计的是页面上显示的内容，而不是底下的 Markdown。所以语法、插件写入的区块和笔记自己的标题都不计入。悬停提示会把总数拆成字数、含空格与不含空格的字符数、非亚洲语言单词数和亚洲语言字符数。**字数统计规则**决定按哪一种算法计数：微软 Word、晋江或起点。**标题计入字数**决定标题行算不算写作。**统计项目字数**会给出两个数字，一个是整个项目的，一个是仅正文稿的。
- 写作时段有三种计时方式：正计时、倒计时，或者工作与休息交替的番茄钟。你可以从状态栏或命令面板开启时段，也可以让它在进入专注模式时自动开始。时段把自己的时间分为专注、摸鱼和暂停。所有数字都由时间戳算出，而不是数计时器跳了多少下。所以合上电脑的两小时，和逐秒盯着的两小时，判定结果完全一样。字数按笔记逐篇计入，以每篇笔记在时段开始时的字数为基准。暂停期间发生的改动只会重设基准，不计入这个时段的成绩。
- **数据统计**是工作台里的一个面板，用数据回看你的项目。其中的**写作时段**标签页，开头是当天的目标、专注计时和今日总结。往下依次是最近 7 到 180 天的趋势、整年的贡献格和日历。接着是每周与每月目标，它们会随各自周期的天数伸缩。你还能看到写作真正发生在一天中的哪些时辰，以及时间在构思、初稿、修改与校对之间怎样分配。每份读数都只针对一个项目，范围由你选择：整个项目，或者仅正文稿。每日目标则有自己的范围，所以改变图表显示的内容，不会挪动目标本身。
- **打开写作统计**会把当天的目标、计时和总结放进一个独立的侧栏，让数据就在正文旁边，而不是压在下面。另外还有八条命令。它们可以用三种计时中的任意一种开始时段，暂停或停止正在进行的时段，以及切换读数所用的统计范围。
- **写作时段**分组下有十一项设置。其中有字数统计规则、新时段默认的计时方式，以及多久没有编辑就从专注转为摸鱼。还有整个项目与仅正文稿各自的每日目标，以及每周从哪一天开始、日期如何书写。
- 时段记录保存在项目自己的目录里，位于 `70_工具/71_数据统计/711_写作时段` 之下，每台设备每月一个 JSON 文件。两处安装永远不会写入同一个文件，所以同步时没有什么需要合并。被崩溃或退出打断的时段，会在插件下次载入时补完并归档。

### 变更

- 一句话概述下方的长度提示，现在遵循**字数统计规则**。它得出数字的方式，和状态栏里的数字相同。

## [0.10.0]

### 新增

- 项目可以归档了。在项目管理器的行内菜单中选择**归档项目**，整个文件夹就会移入 `Snowflake Archive`。这个文件夹与各个项目并列，而不在任何项目之内。管理器列表底部也新增了**归档**分区，用来存放归档的项目。笔记本身没有任何改动，也不会留下断链，因为项目引用的一切都在它自己的文件夹里。恢复会把项目送回原处，如果原来的名称已被占用，会为它另取一个未被使用的名称。用文件管理器手动移入或移出，效果完全相同。归档只是一个位置，而不是一套机制。
- 世界观和词表现在也能从命令面板使用了。**添加世界观笔记**和**打开世界观数据库**会先问你要哪个种类。然后对你选的那一类，做角色与场景那两条命令一直在做的事，自建种类同样适用。**创建世界观种类**会打开添加种类的对话框。**添加类别**、**添加世界状态**和**添加关系**会先问清条目属于哪一类，再把它添加到那里。这些命令会先问种类，而不是写死某一类，因为每个项目都有自己的种类，打开期间也可以随时增删。
- 自由模式，有一项设置和**切换自由模式**命令。开启后，工作台会收起十个步骤和进度，只保留你真正写入的内容。角色和场景会并入侧栏的世界观列表，各有自己的图标和计数。它们的面板也去掉了步骤编号、状态和提示，读起来就是两份普通的笔记清单。关闭后，这套方法会原样回来，因为这个模式只改变呈现方式。步骤收起期间，正文流仍可以用**打开正文流**命令打开。

### 变更

- 较长的成员表单，标题和按钮始终触手可及。对话框不再整体滚动：标题行和进度状态固定在顶部，取消和创建按钮固定在底部，只有中间的字段会移动。滚动条位于对话框自己的留白里，所以字段的右边界仍与上方的标题、下方的按钮对齐。
- 词表树和自定义字段表格里的菜单项改为**打开**，不再叫打开笔记，与各成员行的说法一致。

### 修复

- 高度超出窗口的表单对话框，又可以滚动了。项目对话框和重命名对话框此前保留了一条规则，让字段无法收缩。窗口较矮时，最后几个字段和下方的按钮都够不着，也找不到滚动条。
- 获得焦点的字段，现在能画出完整的边框光晕。此前对话框的滚动区，会裁掉光晕靠近字段边界的那一侧。
- 管理器打开时更改项目根目录，归档列表也会一起重新载入。此前列表仍显示上一个根目录里的归档项目，恢复其中一项，还会把项目移进新的根目录。
- 手动把项目拖入或拖出 `Snowflake Archive`，插件都能察觉。此前把项目拖出后，它会从各处的列表中消失，直到别的操作唤醒插件。而拖入时，已打开的正文标签页还会继续写入一个已经不在原处的项目。
- 在管理器中归档或恢复后，不会再用移动之前读到的项目列表来重绘。此前这可能让同一个项目同时出现在归档和活动两处。
- 列表上方的计数与下方各行的菜单按钮，现在对齐在同一条竖线上，词表树和自定义字段表格都是如此。

## [0.9.0]

### 新增

- 任何成员笔记都可以带上自定义字段。每个字段由一个标题和你写在下面的内容组成。字段在成员表单里以卡片的形式添加和排序，存放在笔记自己的区段里。插件不会往里面写任何东西，也不会拿它们做别的事。所以这个故事需要、而内置字段没有的一切，都可以放在这里。
- 世界观种类可以自己建了。每个项目自带时间、地点和物品三类，侧栏里还可以再添加最多三十二类。门派、语言、某项技术，凡是这个故事还要记住的，都可以。每个自建种类都有自己的文件夹、侧栏面板、表格、数据库视图和三份词表。它的图标按名称从 Lucide 中挑选，另有一句话说明它的用途。重命名种类会移动它的文件夹，并改写指向它的所有链接。删除前会先说明这样做的代价。
- 自定义字段模板，每类成员各有一个文件夹。模板是一篇存放一组字段的笔记，放在该种类三份词表旁边的第四个文件夹里。侧栏新增的**自定义字段**面板按种类列出模板，可以在这里添加、编辑和删除。任何成员表单都能把刚刚填好的字段导出为模板，如果会替换同名模板，会先告诉你。在表单中选定的模板会记为该种类的默认值，之后新建这类笔记时，字段就已经就位。已有字段的笔记则保留原有内容，只补上缺少的那些。

### 变更

- 笔记升至 schema 3。蓝色的**较旧的项目格式**提示和它的**更新**按钮，仍会一次把早先的笔记更新到当前版本。
- 关系记录现在必须写明它指向的笔记。缺少对象时，表单不会保存，并会标出缺少对象的那张卡片，方便你在长表单里找到。此前写下的记录，读取和显示都和从前一样。只有在下次保存那篇笔记时，表单才会要求补上缺少的对象。
- 记录的值现在写在一个可以换行、可以拉高的字段里，和自定义字段的内容用的是同一种字段。记录在笔记中只占一行，所以你输入的换行，保存时会读作空格。

## [0.8.1]

### 变更

- 词表搜索没有结果时，分隔线会收起。控制这一点的样式，现在依据插件给浏览区加上的类，不再用检查浏览区内容的选择器。外观和行为都没有任何变化。被替换的 `:has()` 选择器，正是插件审查会警告的那一类，因为页面一有变化，浏览器就要大范围地重新检查它。

## [0.8.0]

### 新增

- 世界观笔记：时间、地点和物品加入角色与场景的行列，成为项目的成员。每一类都有自己的文件夹、数据库视图，以及工作台侧栏新分组里的一张表格。表单则和其他成员一样。条目可以有别名、类别、进度状态和描述。它的笔记也和其他笔记一样：属性在上，生成的概览在正文里，你的文字在其后。
- 任何成员都可以书写状态与关系记录行。每一行以词表中的标签开头，用链接写出对象、地点、时间和起止，后面是自由的文字。记录行在表单里以卡片编辑，选择器可以当场创建还不存在的对象。它们保存为普通的 Markdown 标注块，停用插件后读起来也一模一样。
- 每一类成员都有三份词表：类别、状态和关系，以文件夹树的形式逐层扩展。每个词条都是一个文件夹，里面有一篇与它同名的笔记。因此指向词条的链接和其他链接一样可以解析，关系图里的词条也以自己的名字出现。侧栏的三个词表面板，可以跨全部五类成员浏览词表。你可以折叠和搜索，在树旁完整阅读一个词条，并看到用到它的一切。你还可以添加子项，重命名时会改写所有引用，删除前会先说明代价。
- 角色的定位现在是它的一个类别。主角、配角和次要角色会按项目语言预置，更深层的词条由你自己决定。把精灵放进「种族／精灵」，把家族放进「家族／主角」，都不会被当作定位来读取。角色数据库按定位链接分组。
- 场景的时间和地点现在是笔记，不再是文字。选择方式和出场角色一样，还不存在的可以就地创建。
- 健康检查会顺着项目提到的每一篇笔记查下去。词条的笔记不见了、链接指向不存在的词条、重命名后留下的旧显示名、指向空处的记录行，都会分别报告。每一项修复只修补报告里数出的那些问题，不多也不少。
- 蓝色提示「较旧的项目格式」位于较新格式警告的旁边。只要有任何笔记出自旧版本，它就会出现，无论是角色、场景、世界观条目、概述与大纲、正文笔记，还是素材与存档。它的「更新」按钮会一次把这些笔记全部更新到当前版本，并说明跳过了什么。命令「更新旧格式的笔记」在命令面板中做同样的事，重复运行也不会改变任何东西。
- 插件自己的文件，由插件自己维护。工作台显示项目的那一刻，缺失的系统模板会静默补建，过期的会静默替换，因为它们本来就是生成的。整套模板现在也包含了此前缺失的 061 世界观模板。只有在你点了「更新」按钮之后，你的笔记才会改变。
- 表格可以显示进度状态和操作列，两者各有一项设置和一条命令。另有一项设置，决定从字段新建笔记时，是先打开表单还是直接创建。

### 变更

- 笔记使用架构 2。角色定位从旧的类型键移入了类别链接，成员属性按每类固定的顺序排列。概览以进度状态结尾，记录区段作为带标题的标注块，紧跟在概览下方。
- 「将字段概览写入角色与场景笔记」更名为「更新旧格式的笔记」。命令的标识没有变，所以绑定过的快捷键照常可用。
- 项目没有变化时，重复的项目加载会直接使用同一份快照。在三百个角色、三千个场景的规模下，以前表单、面板和刷新每次都要花三分之一秒，现在只需约一毫秒。只有真正发生变化时，才需要重建一次。
- 成员行的操作收进了一个菜单，表格每一行显示什么，由你来选择。

### 修复

- 插件读不懂的记录行会原样保留，作为提示性报告列出，绝不改写。只有一端是链接的起止、纯文字的词项、值里出现的连接词，都保持你写下的样子。
- 重命名词条时，会改写每一处引用，包括属性和记录行里的目标与显示名。只是同名的无关笔记不会受到波及，因为不带路径的名称只在种类相符的地方匹配。
- 迁移只读取 0.7.0 写下的内容。数据库里的定位表，按它在 0.7.0 中的拼写来改写。迁移经过的每篇笔记都会盖上版本戳。任何逻辑都不依赖只有开发版本才产生过的格式。
- 修复报告的就是它实际做了的事。一项修复如果什么都没做成，会如实说明。健康检查的计数也经得起复查。

## [0.7.0]

### 新增

- 角色笔记和场景笔记会在正文中显示自己的字段，作为写作区上方的一份概览。标签和取值都使用项目语言，视点人物和出场角色是链接。整块内容由笔记自己的属性生成。它是普通的 Markdown，在阅读视图、实时预览和源码模式下看起来都一样，停用插件后也依然可读。属性面板会截断过长的键名，而且不论项目用什么语言，都只显示英文。这份概览正是为了解决这个问题。
- 概览会自动保持最新。在工作台或属性面板里修改字段，都会重写概览。直接在块内输入的文字，会按属性中的内容还原。编辑器会拒绝块内的编辑，并提示你应该去哪里修改。
- 已有的笔记可以按需加上概览。角色表和场景表上方会出现一行提示，统计此前写下的笔记有多少篇，并能一次为它们全部加上概览。命令「将字段概览写入角色与场景笔记」也能为当前项目做同样的事。在此之前，这些笔记照常依据属性工作，也不会被报告为损坏。
- 生成的数据库视图会自动扩充。打开数据库时，笔记里有而数据库还没列出的属性，都会新增一列，你自己添加的属性也一样。你排好的列和视图会保持原样。
- 「打开数据库」旁的菜单里新增了「重置数据库」，它会按当前模板重写这个数据库。重写前会先询问，因为文件中新增的视图和排列会被替换。

### 变更

- 场景的冲突改为存放在属性里，不再是正文中的一个区段。这样，场景表、搜索、数据库视图和概览显示的才是同一份内容。在此之前写下的场景，仍从原处读取冲突，直到为它添加概览为止。
- 场景数据库新增了冲突列，并翻译了两种不指向具体角色的视点。角色数据库的「全部角色」视图会列出角色表的全部字段，不再只有四项。此前建好的数据库，可以通过「重置数据库」获得这些改动。
- 新建角色笔记的第三步区段，标题改为「第三步 · 一段式故事梗概」，与这一步写入的内容一致。已经写下的笔记保留原有标题。
- 从表格打开步骤笔记时，除了这一步所填的正文，概览也会一并高亮。

### 修复

- 修复正在编辑器中打开的笔记时，不必先关闭边界保护。这项保护针对的是手动输入，此前却连插件自己的写入也一起拒绝。结果编辑器仍显示旧内容，还可能把旧内容写回去，盖过修复的结果。
- 从工作台打开步骤笔记时，对应的区段会移到页面中部。Obsidian 会在笔记打开后，随即恢复它自己的滚动位置。此前的居中发生在这之前，所以被这次滚动带走了。

## [0.6.0]

### 新增

- 角色表和场景表可以滚动整份列表，只绘制视野内的行。即使有三百个角色或三千个场景，工作台也毫无负担。共用同一张表的步骤，也共用同一个滚动位置。在第 3、5、7 步之间，或第 8、9 步之间切换，屏幕上仍是同样的那几行。
- 每张表上方新增了搜索框和筛选器。角色可以按姓名、类型和一句话故事概述查找，场景可以按名称、视点、时间、地点、冲突和出场角色查找。筛选器可以把角色限定为某一类型，或把场景限定为某一视点。右侧的计数会显示列表还剩多少条。筛选生效时，拖动会暂停，因为中间的行都被隐藏了。
- 每一行的菜单都能精确地移动这一行。菜单里有「上移」「下移」、按序号移动的「移动到位置…」，以及按名称查找目标的「移动到某项之后…」。「在其后插入角色」和「在其后插入场景」会把新条目放在这一行下方，而不是列表末尾。这些操作不受距离限制，筛选时也照常可用。
- 角色表也有了顺序列，与场景表一致。

### 变更

- 两张表使用同一套列宽，并占满窗口剩余的高度。一句话故事概述和冲突会完整显示，不再截成一行。滚动条位于表格旁边、表头下方，不再压在行上。
- 打开项目时，文件没有变化的笔记会沿用已解析的结果。笔记被重命名或删除后，旧的结果也会随之丢弃。在三千个场景的规模下，原本要一秒才能打开的工作台，现在只要十分之一秒。

### 修复

- 用方向键走进较长的章节时，你跨过的那条线会保持不动，直到这一章完成自身的测量。刚载入的章节会在片刻间修正各行的高度，此前落点会随之漂移。

## [0.5.1]

### 变更

- 专注模式会淡化或隐藏应用的部分界面。实现这些效果的样式，现在依据插件给每个窗格加上的类，不再用检查窗格内容的选择器。外观和行为都没有任何变化。被替换的 `:has()` 选择器，正是插件审查会警告的那一类，因为页面一有变化，浏览器就要大范围地重新检查它们。

## [0.5.0]

### 新增

- 打字机滚动：你正在写的那一行始终停在页面中部，移动的是页面。用鼠标点击时，你点的词仍会留在指针下方，从第一次按键起才开始居中。它默认开启，每一章的标题栏里都有它的按钮，也可以用命令开关。
- 专注模式：写作时，除了你正在写的段落，其余一切都会淡化。淡化的范围包括这篇笔记的其余部分、相邻的笔记，以及应用的其余界面。四档逐级加深：「开」让工作台保持明亮，「深度」让工作台也一起淡化。「仅正文」会全屏只显示正文，隐藏笔记路径和顺序编号，并收起两侧面板。每一章标题栏里的按钮可以逐档切换，四条命令可以直接设为某一档。**正文流**设置中的滑杆，会在你选择时说明每一档的含义。离开正文流时，应用会恢复原样，回来时专注模式也随之恢复。
- 方向键可以从一篇笔记走进下一篇。在第一行或最后一行按上下键，或在第一个或最后一个字符处按左右键，光标就会越过分隔线，进入相邻的笔记。你跨过的那条线，在屏幕上保持不动。

### 修复

- 光标被滚出页面后再按方向键，页面会量好距离，一次回到光标处。此前编辑器按自己的推算滚动，可滑动窗口早已改变了页面。结果按一下键，就可能把你甩过好几篇笔记。
- 即使滚动到让窗口滑动的程度，键盘也不会再脱离你正在写的笔记。现在只有真正换了位置的笔记才会移动，光标所在的编辑器不会在写作途中被移出页面。

### 变更

- **正文流**下的设置更简洁了：名称更短，每条描述一句话、占一行，两个滑杆的样式也一致了。

## [0.4.1]

### 修复

- 点击正文中的某个词，光标会落在这个词上，即使所点的词之间夹着 Markdown 语法也一样。正文显示在页面上时，不带强调标记、标题标记和链接地址，也不带软换行的换行符。所以凡是跨过这些内容的片段，都无法在文件中找到，只能改按点击的高度来放置光标。章节越长，落点离那个词就越远，在一章的结尾处最为明显。现在会先撇开语法，再把这些词与原文比对，光标就落在被点中的那个字上。
- 在一小段加粗文字或链接旁边点击，不会再把页面甩到笔记顶端。此前用于查找的词，只截取到所点内容的边界，而一小段内容太短，便无从查起。
- 如果一章中有重复出现的句子，会取你点中的那一处，而不是笔记中的第一处。
- 两篇笔记之间的那条线，现在提供的是此刻正文允许的操作，而不是画线时允许的操作。此前，如果项目原本只有一篇笔记，后来又新增了第二篇，那条线仍会提示没有可合并的内容。要关掉正文流再重新打开，它才会更新。合并时给出的名称，也停留在画线那一刻那篇笔记的名字。
- 第一篇笔记上方的那条线也可以插入笔记了，和其他每篇笔记下方的线一样。此前，它是正文中唯一什么都不提供的线。
- 最后七处由浏览器绘制的悬浮提示，改用了插件自己的提示。它们是正文中笔记的路径、第十步给出的那篇笔记、角色的名称与一句话故事线、场景的名称与冲突，以及选择器中的标签。

### 变更

- 类型检查现在会让源码守住插件所声明的语言版本。此前，一处 Node 类型声明让源码用上了高于该版本的方法。这类用法本会毫无提示地通过编译，并随插件发布。行为没有任何变化。

## [0.4.0]

### 新增

- 正文流：你可以把整部初稿当作连续的一页来读写，而每一章仍是独立的 Markdown 笔记。点击某一章，它就会就地变成编辑器，光标落在你点的那个词上。转到另一章时，前一章又变回排版后的正文。写着当前章名的那一行会一直停在页首，直到下一章把它顶走。
- 项目的正文由它实际拥有的笔记组成，不再是一篇名为「初稿」的笔记。每篇笔记用 `snowflake-manuscript-sequence` 记录自己的位置，因此移动或重命名笔记，都不会改变它的阅读顺序。已有项目无需任何改动：只有一篇初稿的项目，就是由一篇笔记构成的正文。
- 你可以在正在读的这一章前后插入新的一章，也可以在光标处把正在写的一章拆成两章，或者把下一章并入这一章。合并前会先询问，因为三者之中只有它会让一篇笔记消失。
- 随处都能打开：第十步的**打开正文流**会带你回到上次写作的那篇笔记。也可以从命令面板打开，或在文件列表中右键任意一篇正文笔记。
- 十条正文命令。它们可以打开与关闭正文流、前往下一篇或上一篇，或回到正文流打开时所在的笔记。还可以在前后插入笔记、在光标处拆分，以及切换每篇笔记那一行显示的内容。其中七条只在当前视图是正文流时提供。打开正文流的命令在打开过项目之后即可使用，两条切换命令则随时可用。
- **正文流**下的三项设置：正在读的那一篇每侧各保留多少篇笔记，是否显示笔记的文件路径，以及是否显示它所存的顺序编号。
- 健康检查会报告缺失、无法读取或被两篇笔记共用的正文位置。这三种问题的修复方式相同：保留正文当前的阅读顺序，并把它妥善写下来。frontmatter 以下的内容不会被改动。

### 变更

- 整个插件的悬浮提示，都改用 Obsidian 自己的提示，不再用浏览器的。

### 修复

- 原本会同时出现两个悬浮提示，现在只剩一个。此前有十七处控件同时设置了无障碍标签和浏览器 title，导致 Obsidian 的提示和浏览器的提示叠在一起。这些控件是项目切换器、各步骤按钮、健康检查、表格中的标记与警告，以及工具栏按钮。另外还有项目管理器中的控件，和工作台自身的标签页。

## [0.3.2]

### 修复

- 重命名项目后，它的链接不会再失效。Obsidian 会重写被重命名文件夹里的所有链接，把链接缩短，并去掉 `.md`。但插件仍把所存的文本当作文件路径来读。于是初稿明明就在链接所指的位置，却被报告为缺失。打开场景时，视点人物和人物列表都会被清空，保存后两者一并丢失。现在链接会按 Obsidian 的方式解析。
- 场景只会指向本项目中的角色。此前，只要另一个项目用了同名角色，它就会「抢走」原项目场景中的链接。这是因为名称一旦被重复使用，缩短形式的链接就不再唯一了。
- 在插件之外重命名项目文件夹，不会再悄无声息。这种情况会被报告出来，并可以一键把文件夹改回项目名称。如果想保留新的文件夹名称，请改为重命名项目本身。
- 角色或场景的文件名或标题与所存名称不一致时，会明确指出是文件名还是标题，并在表格中标出对应的行。
- 初稿标题不再包含项目名称，因为项目重命名时，并没有任何机制会同步更新它。

### 新增

- 健康检查会分别指出所存链接可能出现的每一种问题，并分别修复。有的路径本应是 wiki 链接，却写成了纯文本。有的链接被缩短到要依赖名称的唯一性。有的链接会打开其他项目的笔记，有的指向已不存在的笔记，还有的仍带有文件扩展名。

### 变更

- 链接按 Obsidian 的写法写入，不再带有它从不显示的 `.md`。初稿链接也和其他链接一样，用笔记名称作为显示文本。已有项目中所存的链接保持原样，两种写法都能读取。
- 由于初稿模板有了变化，已有项目会提示一次「模板已过期」。修复只需点一下，也不会改动你写下的任何内容。

## [0.3.1]

### 修复

- 移除了一处 JavaScript 方法调用。这个方法高于本插件的目标语言版本，会让调用的返回值无法解析出类型。行为没有任何变化。源码现在可以在所声明的目标版本下通过类型检查。

## [0.3.0]

### 新增

- 场景的视点人物和人物字段，改为输入即筛选的选择器。输入时，候选角色的范围会随之缩小。如果项目中还没有这个角色，也可以直接在字段里创建，不用离开场景表单。
- 角色表和场景表的末尾新增了添加行。读到列表末尾时，可以直接在那里继续添加，不必回到长列表上方的按钮。
- 拒绝重名。角色、场景和项目都不能使用同类中已有的名称，输入时，字段下方就会给出说明。仅在大小写或空格上不同的名称，会被视为同一个名称，因为笔记文件名也是如此。

### 变更

- 启动 Obsidian 或重新加载插件后，工作台会定位到第一个尚未完成的步骤。同一次使用期间，它会停留在你最后选择的步骤。
- **重命名项目**与**创建项目**使用同一套对话框，只是少了语言字段，不再另用一套布局。
- 设置页与项目管理器中的项目根目录使用同一个字段。

### 修复

- 刷新后，滚动位置和展开的区段都会保留。项目在后台发生变化时，工作台不再跳回顶部。
- 删除仍被场景引用的角色时，会先列出这些场景，再把该角色从它们的人物列表中移除，不再留下无法解析的链接。
- 每个可滚动的面板都会预留滚动条的宽度，无论滚动条是否显示。所以添加第一个撑满面板的角色时，面板里已有的内容不会再被压窄。
- 表格单元格会为它能容纳的段落留出空间。
- 窄工作台不再出现只有几像素宽的横向滚动条。
- 打开其他项目的工作台时，不再先短暂显示上一个项目。
- 建议列表会列出全部匹配项，不再止于五十条。列表的宽度与所属字段一致。窗口或分栏调整大小时，列表会关闭，而不是停留在字段原来的位置。

## [0.2.0]

### 新增

- 角色与场景的 Bases 视图。每个项目都会在角色和场景文件夹中生成 `角色总览.base` 与 `场景总览.base`。它们只筛选本项目的笔记，并按工作台维护的顺序排序。已有项目会在下次健康检查时补齐。
- 角色和场景面板中新增了**打开数据库**按钮，就在**添加角色**与**添加场景**旁边。如果数据库文件已被删除，打开时会重新生成。
- 新增**打开角色数据库**与**打开场景数据库**命令。
- 新增缺少数据库的健康检查项，可以在健康检查器中修复。

### 变更

- 角色类型列按项目语言显示。笔记中保存的仍是统一的取值，所以笔记依然可以移植。

## [0.1.1]

### 修复

- 重命名角色或场景时，笔记文件会一起重命名，笔记标题也会更新。这样工作台、文件列表和笔记本身就能保持一致。
- 重命名角色时，场景中保存的相关链接会一并刷新。视点人物和人物条目会显示新名称，而不是旧名称。

### 新增

- 新增一个健康检查项：笔记的文件名或标题与笔记中保存的名称不一致时，可以在健康检查器中修复。

## [0.1.0]

- 首个公开发布版本。
