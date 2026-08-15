<a id="english"></a>

# Changelog

**English** · **[简体中文](#简体中文)**

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0]

### Added

- Custom fields on any member note. A field is a title and whatever you write under it, added and reordered as cards in the member's form, and kept in a section of the note's own. The plugin writes nothing into them and reads them for nothing else, so they hold whatever this story needs that the built-in fields do not.
- Worldbuilding kinds of your own. Time, location and item are the three every project starts with, and the rail can add up to thirty-two more: a faction, a language, a piece of technology, whatever else this story keeps track of. Each authored kind gets its own folder, rail pane, table, Bases view and three vocabularies, a Lucide icon you choose by name, and a sentence saying what it is for. Renaming one moves its folder and rewrites every link into it. Deleting one names what that will cost before anything goes.
- Custom field templates, one folder per kind. A template is a note holding a set of fields, kept in a fourth folder beside the kind's three vocabularies, and the new **Custom field** pane in the rail lists them per kind to add, edit and delete. Any member form can export the fields you just typed as a template, saying first when a namesake will be replaced. Choosing a template in a form remembers it as that kind's default, so a new note of that kind opens with those fields already in place, while a note that already has fields keeps them and gains only the ones it was missing.

### Changed

- Notes carry schema 3. The blue **Older project format** notice and its **Update** button bring earlier notes current in one pass, as they always have.
- A relationship record now names the note it is with. The form will not save one without a target, and it marks the card it means so you can find it in a long form. Records written before this rule are read and shown exactly as they were, and the form asks for the missing target the next time that note is saved.
- A record's value is written in a field that wraps and can be dragged taller, the same field a custom field's content uses. A record is one line in the note, so any line breaks you type are read back as spaces when it is saved.

## [0.8.1]

### Changed

- The line that closes off the vocabulary browser after a search that found nothing now follows a class the plugin puts on the browser, rather than a selector that asks what the browser contains. Nothing looks or behaves differently. The `:has()` selector this replaces is the kind the plugin review warns about, because the browser re-checks it broadly as the page changes.

## [0.8.0]

### Added

- Worldbuilding notes: time, location and item join characters and scenes as members of a project. Each kind has its own folder, its own table in the dashboard's new rail group, its own Bases view, and the same form as everyone else. An entity carries aliases, categories, a progress status and a description, and its note reads like any other: properties above, a generated overview in the body, your prose below.
- World status and relationships, written as record lines on any member: a label from a vocabulary, linked terms for who, where and when, and free text after them. They are edited as cards in the member form, with pickers that create what does not exist yet, and stored as ordinary Markdown callouts that read the same with the plugin off.
- Three vocabularies for every kind, grown as folder trees: categories, world statuses and relationships. Every entry is a folder holding a note named after it, so links to entries resolve like any others and the graph shows each entry under its own name. Three rail panes browse the vocabularies across all five kinds: fold and search the trees, read one entry beside them together with everything that uses it, add children, rename with every reference rewritten, and delete with the cost named first.
- A character's role is one of its categories now. Major, Supporting and Minor are seeded in the project's language, deeper entries are yours to shape, so elves can live under Race/Elf and houses under Houses/Major. An entry that merely shares a role's name deeper in the tree is never read as the role. The character base groups by the role link.
- A scene's time and place are notes rather than words, picked the way its cast is picked, and created from the field when they do not exist yet.
- The health check follows every note a project names: a vocabulary entry whose note is gone, a link naming an entry that is not there, a display a rename left behind, and a record line pointing at nothing are each reported. Each repair mends exactly what its report counted, nothing more.
- One blue notice, **Older project format**, stands beside the newer format warning whenever any note was written by an older release, whether a character, a scene, an entity, a summary, a synopsis, a manuscript note, a material or an archive. Its **Update** button brings all of them current in one pass and says what it skipped. The command **Update notes in older format** does the same from the palette, and running either again changes nothing.
- The plugin's own files look after themselves. The system templates are created when missing and replaced when outdated the moment a dashboard shows the project, silently, because they are generated. The set now includes 061, the worldbuilding template it had been missing. Your notes only ever change behind the **Update** button.
- Tables can show a progress status and an actions column, each with a setting and a command, and a setting chooses whether a note created from a picker field opens its form first or is created directly.

### Changed

- Notes carry schema 2. A character's role moved from the old type key into its category links, member properties read in one canonical order per kind, and the overview ends with the progress status while record sections sit directly beneath it as titled callouts.
- **Write field overviews into character and scene notes** is now **Update notes in older format**. The command's identity is unchanged, so a hotkey bound to it keeps working.
- Repeated project loads are answered from one snapshot while nothing in the project has moved. At three hundred characters and three thousand scenes, the third of a second that every form, pane and refresh used to pay is now about a millisecond, and only a real change pays for one rebuild.
- Each member row's actions fold into one menu, and what a table's rows show is the author's to choose.

### Fixed

- A record line the plugin cannot read is kept exactly as written and reported as informational, never rewritten: half-linked spans, plain-text terms and connector words inside values all stay the author's.
- Renaming a vocabulary entry rewrites every reference, in properties and record lines alike, targets and displayed names both. Unrelated notes that merely share a name are left alone, because a bare name is matched only where its kind agrees.
- The migration reads exactly what 0.7.0 wrote. The base role sheets are respelled from their 0.7.0 forms, every note it crosses is stamped, and nothing depends on shapes only development builds ever produced.
- Repairs report what they did rather than what they tried: a repair that made nothing says so, and the health check's counts survive a second look.

## [0.7.0]

### Added

- Character and scene notes show their fields in the note body, as an overview above the writing. The labels and the values are in the project's language, the point of view and the cast are links, and the whole block is generated from the note's own properties. It is ordinary Markdown, so it reads the same in reading view, live preview and source mode, and it stays readable with the plugin turned off. The Properties panel cuts long key names short and shows them in English whatever the project language, which is what this answers.
- The overview keeps itself current. Editing a field in the dashboard or in the Properties panel rewrites it, and text typed into the block is put back the way the properties have it. The editor refuses edits inside the block and says where to make them instead.
- Existing notes gain their overview when you ask for it. A line above the character and scene tables counts the notes written before this and adds the overview to all of them at once, and the command **Write field overviews into character and scene notes** does the same for the current project. Until then those notes keep working from their properties, and none of them is reported as damaged.
- The generated base views grow. Opening one adds a column for any property the notes carry that the base does not list yet, including a property you add yourself, and leaves the columns and views you arranged as they were.
- **Restore base**, in the menu beside **Open base**, rewrites a base from the current template. It asks first, because the views and the arrangements added in that file are replaced.

### Changed

- A scene's conflict is stored as a property rather than as a section of prose, which is what lets the scene table, the search, the base views and the overview all show the same thing. A scene written before this keeps reading its conflict from where it was, until the overview is added to it.
- The scene base lists the conflict, and translates the two points of view that name no character. The character base's **All Characters** view lists every field of the sheet rather than four of them. A base made before this picks all of it up through **Restore base**.
- New character notes head their step 3 section **One-Paragraph Storyline**, which is what the step writes there. Notes already written keep the heading they have.
- Opening a step note from a table lights up the overview beside the prose that step fills.

### Fixed

- Repairing a note that is open in an editor works without turning boundary protection off first. The protection is meant for what a person types, and it used to refuse the plugin's own writes as well, which left the editor showing the old text and could save it back over the repair.
- Opening a step note from the dashboard brings its section to the middle of the page. Obsidian restores a note's own scroll position just after it opens, and the centring used to land before that and be carried away by it.

## [0.6.0]

### Added

- The character and scene tables scroll the whole list, drawing only the rows in view, so three hundred characters or three thousand scenes cost the dashboard nothing. The steps that share a table share its position: moving between steps 3, 5 and 7, or between 8 and 9, keeps the same rows on screen.
- A search box and a filter above each table. Characters answer to their name, type and storyline, scenes to their name, point of view, time, location, conflict and cast. The filter narrows the characters to one type, or the scenes to one point of view, and a count says how much of the list remains. Dragging pauses while anything is filtering, because the rows between are hidden.
- Every row's menu moves it exactly: **Move up**, **Move down**, **Move to position…** by number, and **Move after…**, which finds the destination by name. **Insert character after** and **Insert scene after** put a new entry directly below the row instead of at the end of the list. All of these carry over any distance, and keep working while a filter is on.
- The character table numbers its rows the way the scene table always has.

### Changed

- Both tables stand on the same columns, reach the bottom of the window, and show storylines and conflicts in full rather than cut to one line. The scrollbar runs beside the table, under its header, rather than over the rows.
- Opening a project reuses the notes already parsed while their files stand unchanged, and lets go of what a rename or a delete leaves behind. A dashboard that took a second to open at three thousand scenes now opens in a tenth of one.

### Fixed

- Walking into a long chapter with the arrow keys holds the crossed rule still until the chapter has finished measuring itself. A chapter only just mounted revises its line heights for a moment, and the landing used to drift with them.

## [0.5.1]

### Changed

- The fading and hiding that focus mode lays over the app now follow classes the plugin puts on each pane, rather than selectors that ask what a pane contains. Nothing looks or behaves differently. The `:has()` selectors this replaces are the kind the plugin review warns about, because the browser re-checks them broadly as the page changes.

## [0.5.0]

### Added

- Typewriter scrolling: the line being written stays at the middle of the page, and the page moves under it. A mouse click still leaves the clicked words under the pointer, and the centring takes over at the first keystroke. On by default, with a button in every chapter's header and a command to turn it off and on.
- Focus mode: while writing, everything except the paragraph being written fades. That covers the rest of the note, the neighbouring notes, and the rest of the app. Its four levels each reach further than the last: **on** keeps the dashboard bright, **deep** fades it with everything else, and **solo** shows nothing but the manuscript in full screen, with note paths and order numbers hidden and the side panes folded away. The button in every chapter's header walks the levels, four palette commands name them directly, and the slider under **Manuscript stream** explains each level as it is chosen. Leaving the stream restores the app, and coming back restores the mode.
- The arrow keys walk from one note into the next. Up or down on a note's first or last row, or left or right at its first or last character, carries the caret over the rule into the neighbouring note, and the rule being crossed stays exactly where it was on screen.

### Fixed

- An arrow pressed while the caret is scrolled off the page brings the page back to the caret in one measured move. The editor used to answer with its own scrolling, reckoned against a page the sliding window had already changed, and a single press could throw the reader across several notes.
- Scrolling far enough to slide the window no longer drops the keyboard out of the note being written. Only the notes that actually changed places move now, so the editor holding the caret is never lifted out of the page mid-write.

### Changed

- The settings under **Manuscript stream** have shorter names and one-line descriptions, and the two sliders are drawn alike.

## [0.4.1]

### Fixed

- Clicking a word in the manuscript puts the caret in that word even where Markdown syntax sits between the words clicked. Prose reaches the page without its emphasis marks, heading marks, link targets or the newline of a soft break, so any passage crossing one of them could not be found in the file, and the caret was placed by the height of the click instead — landing further from the word the longer the chapter, and worst at the end of one. The words are now matched against the file with its syntax set aside, which lands the caret on the character that was clicked.
- Clicking beside a short stretch of bold, or a link, no longer sends the page to the top of the note. The words looked for stopped at the edge of whatever was clicked, and a stretch too short to search for left nothing to go on.
- A chapter that repeats a sentence takes the copy that was clicked rather than the first one in the note.
- The line between two notes offers what the manuscript allows now, rather than what it allowed when that line was first drawn. A project of one note that had grown a second kept saying there was nothing to merge until the stream was closed and opened again, and the name a merge offered stayed the name that note had when the line was drawn.
- The line above the first note offers to insert one, the way the line below every other note does. It was the only line in a manuscript that offered nothing.
- The last seven tooltips drawn by the browser are the plugin's own: a note's path in the manuscript, the note offered on step 10, a character's name and one-sentence storyline, a scene's name and conflict, and the tags in a picker.

### Changed

- The type checker now holds the source to the language version the plugin states. A Node type declaration was lending it a method newer than that version, which would have compiled and shipped without anything saying so. Nothing behaves differently.

## [0.4.0]

### Added

- The manuscript stream: read and write a whole draft as one continuous page while every chapter stays its own Markdown note. Click a chapter and it becomes an editor with the caret in the word you clicked; move to another and the first is typeset prose again. The line naming the chapter you are in stays at the top of the page until the next chapter reaches it.
- A project's manuscript is the notes it has rather than one note called Draft. Each note records its place in `snowflake-manuscript-sequence`, so moving or renaming one never changes where it is read. An existing project needs nothing done to it: a single draft note is a manuscript of one.
- Insert a note before or after the one being read, cut the one being written in at the caret, or merge it into the next. Merging asks first, because it is the only one of the three that takes a note away.
- Ways in from wherever you are: **Open manuscript stream** on step 10, which returns to the note last written in, the command palette, and the right-click menu of any manuscript note in the file explorer.
- Ten commands for the manuscript: opening and closing the stream, moving to the next or previous note, returning to where the stream was opened, inserting a note on either side, splitting at the cursor, and toggling what each note's line shows. They are offered only while a manuscript stream is the current view.
- Three settings under **Manuscript stream**: how many notes are held on each side of the one being read, whether a note shows its file path, and whether it shows its stored order number.
- The health check reports manuscript positions that are missing, unreadable, or shared by two notes, and mends all three the same way: it keeps the order the manuscript reads in now and writes it down properly. Nothing below the frontmatter is touched.

### Changed

- Tooltips are Obsidian's own throughout, rather than the browser's.

### Fixed

- One tooltip where two used to appear. Seventeen controls carried an accessible label and a browser title at once, so Obsidian's tooltip and the browser's were drawn over each other: the project switcher, the step buttons, the health check, the table markers and warnings, the toolbar buttons, the project manager's controls, and the dashboard's own tab.

## [0.3.2]

### Fixed

- Renaming a project no longer costs it its links. Obsidian rewrites every link inside a folder it renames, shortening it and dropping the `.md`, and the plugin was still reading the stored text as a file path. The draft was reported missing while sitting where the link said it was, and opening a scene cleared its point of view and emptied its cast, losing both on save. Links are now followed the way Obsidian follows them.
- A scene names characters from its own project. A second project with a character of the same name used to capture the first project's scenes, because a shortened link stops being unique the moment the name is reused.
- A project folder renamed outside the plugin is reported instead of passing unnoticed, with a repair that brings the folder back to the project's name. To keep the new folder name, rename the project itself.
- A character or scene whose file name or heading drifted from its stored name says which of the two it is, and the row for it is marked in the table.
- The draft's heading no longer carries the project name, which nothing kept up to date when the project was renamed.

### Added

- The health check names each way a stored link can be wrong, and mends each one differently: a path typed as plain text where a wikilink belongs, a link shortened until it depends on a name staying unique, a link that opens a note in another project, a link to a note that no longer exists, and a link still carrying a file extension.

### Changed

- Links are written the way Obsidian writes them, without the `.md` it never shows, and the draft link carries the note's name as its display text like every other link. Existing projects keep their stored links; both forms are read.
- Because the draft template changed, existing projects report that template as out of date once. Repairing it takes a click and changes nothing an author wrote.

## [0.3.1]

### Fixed

- Removed a use of a JavaScript method newer than the language version this plugin targets, which left the value it returned without a resolved type. Nothing behaves differently; the source now type-checks against the target it states.

## [0.3.0]

### Added

- Type-to-filter pickers for a scene's point of view and its cast. Typing narrows the characters on offer, and a character the project does not have yet can be created straight from the field without leaving the scene form.
- An add row at the end of the character and scene tables, so the next one can be added from where the reading stopped rather than from the button above a long list.
- Duplicate names are refused. A character, a scene, and a project may each not take a name another of its kind already answers to, and the form says so under the field as the name is typed. Names differing only in capitalisation or spacing count as the same, because the note file names do too.

### Changed

- The dashboard opens on the first step that is not finished when Obsidian starts or the plugin reloads. Within a session it stays on whichever step was last chosen.
- **Rename project** is the **Create project** dialog without its language field, rather than a layout of its own.
- The project root folder is the same field on the settings page and in the project manager.

### Fixed

- Scroll position and expanded sections survive a refresh, so the dashboard no longer jumps back to the top when a project changes underneath it.
- Deleting a character that scenes still reference now names those scenes first and takes the character out of their casts, instead of leaving links that resolve to nothing.
- Every panel that scrolls holds the scrollbar's space whether or not a scrollbar is showing, so adding the character that first fills a panel no longer narrows everything already in it.
- A table cell has room for the paragraph it can hold.
- A narrow dashboard no longer carries a horizontal scrollbar a few pixels wide.
- Opening another project's dashboard no longer shows the previous project for a moment first.
- Suggestion lists offer every match rather than stopping at fifty, take the width of the field they belong to, and close when the window or a pane is resized instead of staying where the field used to be.

## [0.2.0]

### Added

- Bases views for characters and scenes. Every project scaffolds `Characters.base` and `Scenes.base` in its character and scene folders, filtered to that project and sorted by the order the dashboard maintains. Existing projects receive them on their next health check.
- **Open base** on the character and scene panels, beside **Add character** and **Add scene**. A base that has been deleted is written again when it is opened.
- **Open character base** and **Open scene base** commands.
- Health check for a missing base, repairable from the health checker.

### Changed

- The character type column reads in the project language. The stored value stays canonical, so notes remain portable.

## [0.1.1]

### Fixed

- Renaming a character or scene now renames its note file and updates the note heading, so the dashboard, the file explorer, and the note itself agree.
- Renaming a character now refreshes the links scenes store for it, so a point-of-view or cast entry shows the new name instead of the previous one.

### Added

- Health check for a note whose file name or heading no longer matches the name stored in the note, repairable from the health checker.

## [0.1.0]

- Initial public release.

<a id="简体中文"></a>

# 更新日志

**[English](#english)** · **简体中文**

本文件记录本项目的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

## [0.9.0]

### 新增

- 任何成员笔记都可以带上自定义字段。每个字段由一个标题和你写在其下的内容组成，在成员表单中以卡片添加与排序，存放在笔记自己的区段里。插件不会往里写任何东西，也不会拿它们做别的事，因此这个故事需要而内置字段没有的一切，都可以放在这里。
- 世界观种类可以自建。时间、地点与物品是每个项目自带的三类，侧栏还可以再添加至多三十二类：门派、语言、某项技术，凡是这个故事还要记住的都可以。每个自建种类都有自己的文件夹、侧栏面板、表格、数据库视图与三份词表，图标按名称从 Lucide 中挑选，另有一句话说明它的用途。重命名会移动它的文件夹并改写指向它的所有链接。删除前会先说明这样做的代价。
- 自定义字段模板，每类成员各有一个文件夹。模板是一篇存放一组字段的笔记，就放在该种类三份词表旁边的第四个文件夹里，侧栏新增的**自定义字段**面板按种类列出它们，可以添加、编辑与删除。任意成员表单都可以把刚刚填好的字段导出为模板，若会替换同名模板，会先行说明。在表单中选定模板即记为该种类的默认值，此后新建该类笔记时字段已经就位。已有字段的笔记则保留原有内容，只补上缺少的部分。

### 变更

- 笔记升至 schema 3。蓝色的**较旧的项目格式**提示与它的**更新**按钮，仍会一次把早先的笔记带到当前版本。
- 关系记录现在必须写明它指向的笔记。缺少对象时表单不会保存，并会标出它指的那张卡片，方便在长表单中找到。此前写下的记录，读取与显示都和从前一样，只有下次保存那篇笔记时，表单才会要求补上缺少的对象。
- 记录的值改在可换行、可拉高的字段中书写，与自定义字段的内容用的是同一种字段。记录在笔记中占一行，因此你输入的换行会在保存时读作空格。

## [0.8.1]

### 变更

- 词表搜索一无所获时收起分隔线的样式，现在依据插件为浏览区标注的类，而不再用询问其内容的选择器。外观与行为没有任何变化。被替换的 `:has()` 选择器正是插件审查所警告的一类，因为页面变化时浏览器需要大范围地重新检查它。

## [0.8.0]

### 新增

- 世界观笔记：时间、地点与物品加入角色与场景的行列，成为项目的成员。每一类都有自己的文件夹、工作台侧栏新分组中的表格、自己的数据库视图，以及与其他成员相同的表单。条目可以有别名、类别、进度状态与描述，笔记的样子也与其他笔记一致：属性在上，生成的概览在正文中，你的文字在其后。
- 任何成员都可以书写状态与关系记录行：以词表中的标签开头，用链接写出对象、地点、时间与起止，其后是自由的文字。它们在表单中以卡片编辑，选择器可以当场创建尚不存在的对象。存储形式是普通的 Markdown 标注块，停用插件后读起来一模一样。
- 每一类成员都有三份词表：类别、状态与关系，以文件夹树的形式生长。每个词条都是一个文件夹，其中有一篇与它同名的笔记，因此指向词条的链接与其他链接一样可以解析，关系图中的词条也以自己的名字出现。侧栏的三个词表面板可以跨全部五类浏览词表：折叠与搜索、在树旁完整阅读一个词条并看到使用它的一切、添加子项、重命名并改写所有引用、删除前先说明代价。
- 角色的定位改为它的一个类别。主角、配角与次要角色按项目语言预置，更深的词条由你自定，把精灵放进「种族／精灵」、把家族放进「家族／主角」，都不会被当作定位读取。角色数据库按定位链接分组。
- 场景的时间与地点是笔记而不再是文字，选择方式与出场角色相同，不存在的可以就地创建。
- 健康检查会追随项目提到的每一篇笔记：词条的笔记不见了、链接指向不存在的词条、重命名留下的旧显示名、指向空处的记录行，都会被分别报告。每一项修复只修补报告数出的那些，不多不少。
- 一条蓝色的提示「较旧的项目格式」立在较新格式警告的旁边：只要有任何笔记出自旧版本，无论是角色、场景、世界观条目、概述与大纲、正文笔记还是素材与存档，它就会出现。它的「更新」按钮一次把它们全部带到当前版本，并说明跳过了什么。命令「更新旧格式的笔记」在命令面板中做同样的事，重复运行不会改变任何东西。
- 插件自己的文件自行维护。系统模板会在工作台显示项目的那一刻静默补建缺失的、替换过期的，因为它们本就是生成的。整套模板如今包含此前缺失的 061 世界观模板。你的笔记只会在「更新」按钮之后改变。
- 表格可以显示进度状态与操作列，各有一项设置与一条命令。另有一项设置决定从字段新建笔记时是先打开表单还是直接创建。

### 变更

- 笔记使用架构 2。角色定位从旧的类型键移入类别链接，成员属性按每类固定的顺序排列，概览以进度状态收尾，记录区段作为带标题的标注块紧随其下。
- 「将字段概览写入角色与场景笔记」更名为「更新旧格式的笔记」。命令的标识未变，绑定过的快捷键照常工作。
- 项目未发生变化时，重复的项目加载由同一份快照直接作答。在三百个角色与三千个场景的规模下，此前每次表单、面板与刷新都要付出的三分之一秒，如今只需约一毫秒，只有真正的变化才需要一次重建。
- 成员行的操作折叠为一个菜单，表格的行显示什么由作者选择。

### 修复

- 插件读不懂的记录行会原样保留并作为提示性报告，绝不改写：只有一端成链的起止、纯文字的词项、值里出现的连接词，都仍是作者的。
- 重命名词条会改写每一处引用，包括属性与记录行中的目标与显示名，而不会波及只是同名的无关笔记：不带路径的名称只在类别相符处匹配。
- 迁移只读 0.7.0 写下的内容。数据库的定位表以其 0.7.0 的拼写为准得到改写，迁移经过的每篇笔记都会盖上版本戳，任何逻辑都不依赖只有开发版本才产生过的形态。
- 修复所报即所做：没有做成任何事的修复会如实说明，健康检查的计数经得起复查。

## [0.7.0]

### 新增

- 角色笔记与场景笔记会在正文中显示自身的字段，作为写作区上方的一份概览。标签与取值均使用项目语言，视点人物与出场角色为链接，整块内容由笔记自身的属性生成。它是普通的 Markdown，在阅读视图、实时预览与源码模式下呈现一致，停用插件后依然可读。属性面板会截断过长的键名，且无论项目语言都只显示英文，这正是此概览所要解决的。
- 概览会自动保持最新。在工作台或属性面板中修改字段都会重写它，直接在块内输入的文字则会按属性中的内容还原。编辑器会拒绝块内的编辑，并提示应该去哪里修改。
- 已有笔记可按需获得概览。角色表与场景表上方会出现一行提示，统计此前写下的笔记数量，并一次性为它们全部添加；命令「将字段概览写入角色与场景笔记」对当前项目做同样的事。在此之前，这些笔记照常依据属性工作，也不会被报告为损坏。
- 生成的数据库视图会自动扩充。打开数据库时，笔记中存在而数据库尚未列出的属性都会新增一列，包括你自行添加的属性，而你排布过的列与视图保持原样。
- 「打开数据库」旁的菜单中新增「重置数据库」，按当前模板重写该数据库。它会先询问，因为文件中新增的视图与排列会被替换。

### 变更

- 场景的冲突改为存放在属性中，而不再是一段正文区段，这样场景表、搜索、数据库视图与概览显示的才是同一份内容。在此之前写下的场景仍从原处读取冲突，直到为其添加概览为止。
- 场景数据库新增冲突列，并翻译两种不指向具体角色的视点。角色数据库的「全部角色」视图列出角色表的全部字段，而不再只有四项。此前建好的数据库可通过「重置数据库」获得这些改动。
- 新建角色笔记的第三步区段标题改为「第三步 · 一段式故事梗概」，与该步写入的内容一致。已写下的笔记保留原有标题。
- 从表格打开步骤笔记时，会在该步所填正文之外一并高亮概览。

### 修复

- 修复正在编辑器中打开的笔记时，无需先关闭边界保护即可完成修复。该保护针对的是人工输入，此前却也会拒绝插件自身的写入，导致编辑器仍显示旧内容，并可能把它覆盖回修复结果之上。
- 从工作台打开步骤笔记时，对应区段会被带到页面中部。Obsidian 会在笔记打开后随即恢复它自身的滚动位置，此前的居中发生在那之前，因而被其带走。

## [0.6.0]

### 新增

- 角色表与场景表滚动整份列表，只绘制视野内的行，三百个角色或三千个场景对工作台毫无负担。共用同一张表的步骤共享位置：在第 3、5、7 步之间或第 8、9 步之间切换，屏幕上仍是同样的那几行。
- 每张表上方新增搜索框与筛选器。角色可按姓名、类型与一句话故事概述查找，场景可按名称、视点、时间、地点、冲突与出场角色查找。筛选器可将角色限定为某一类型、场景限定为某一视点，右侧的计数显示列表还剩多少条。筛选生效时拖动暂停，因为中间的行都被隐藏了。
- 每一行的菜单都能精确移动它：「上移」「下移」、按序号「移动到位置…」，以及按名称查找目标的「移动到某项之后…」。「在其后插入角色」与「在其后插入场景」把新条目放在这一行下方，而不是列表末尾。这些操作可跨越任意距离，筛选时也照常可用。
- 角色表也有了顺序列，与场景表一致。

### 变更

- 两张表使用同一套列宽，占满窗口的剩余高度，一句话故事概述与冲突完整显示，不再截成一行。滚动条位于表格旁、表头之下，不再压在行上。
- 打开项目时，文件未变的笔记沿用已解析的结果，被重命名或删除的则随之释放。三千个场景下原本要一秒才能打开的工作台，如今十分之一秒即可。

### 修复

- 用方向键走进较长的章节时，被跨过的那条线会保持不动，直到该章完成自身的测量。刚装载的章节会在片刻间修正各行的高度，落点此前会随之漂移。

## [0.5.1]

### 变更

- 专注模式覆盖在应用上的淡化与隐藏，现在依据插件为每个窗格标注的类，而不再用询问窗格内容的选择器。外观与行为没有任何变化。被替换的 `:has()` 选择器正是插件审查所警告的一类，因为页面变化时浏览器需要大范围地重新检查它们。

## [0.5.0]

### 新增

- 打字机滚动：正在写的一行保持在页面中部，移动的是页面。鼠标点击仍会把所点的词留在指针下，从第一次按键起开始居中。默认开启，每一章的标题栏里都有它的按钮，也可用命令开关。
- 专注模式：写作时，除正在写的段落外，其余一切都会淡化，包括本篇的其余部分、相邻的笔记与应用的其余界面。四档逐级加深：「开」保持工作台明亮，「深度」让工作台一并淡化，「仅正文」则全屏只显示正文，并隐藏笔记路径与顺序编号、收起两侧面板。每一章标题栏中的按钮逐级切换，四条命令可直接设为某一档，**正文流**设置中的滑杆会在选择时说明每一档的含义。离开正文流时应用恢复原样，回来时模式随之恢复。
- 方向键可以从一篇笔记走进下一篇。在第一行或最后一行按上下键，或在第一个或最后一个字符处按左右键，光标便越过分隔线进入相邻的笔记，而被跨过的那条线在屏幕上保持不动。

### 修复

- 光标被滚出页面后按方向键，页面会以一次测量好的移动回到光标处。此前编辑器按自己的推算滚动，而滑动窗口早已改变页面，一次按键就可能把读者甩过好几篇笔记。
- 滚动到让窗口滑动的程度，不再使键盘脱离正在写的笔记。现在只有真正换了位置的笔记才会移动，承载光标的编辑器不会在写作途中被抬离页面。

### 变更

- **正文流**下的设置更为简洁：名称更短，描述一句一行，两个滑杆的样式一致。

## [0.4.1]

### 修复

- 点击正文中的某个词，即使所点的词之间夹着 Markdown 语法，光标也会落在那个词上。正文显示在页面上时不带强调标记、标题标记、链接地址，也不带软换行的换行符，因此凡是跨过它们的片段都无法在文件中找到，只能改按点击的高度放置光标——章节越长，落点离那个词越远，在一章的结尾处最为明显。现在会把这些词与撇开语法后的原文比对，光标就落在被点中的那个字上。
- 在一小段加粗或链接旁边点击，不会再把页面甩到笔记顶端。此前用于查找的词只截取到所点内容的边界，而一小段太短，便无从查起。
- 一章中重复出现的句子，取被点中的那一处，而不是笔记中的第一处。
- 两篇笔记之间的那条线，提供的是此刻正文允许的操作，而不是这条线画出来时允许的。原本只有一篇笔记、后来新增了第二篇的项目，那条线仍说没有可合并的内容，除非关掉正文流再打开；合并所给出的名称，也停留在画线那一刻那篇笔记的名字。
- 第一篇笔记上方的那条线也可以插入笔记了，与其他每篇笔记下方的线一样。此前它是正文中唯一什么都不提供的线。
- 最后七处由浏览器绘制的悬浮提示改用插件自己的提示：正文中笔记的路径、第十步给出的那篇笔记、角色的名称与一句话故事线、场景的名称与冲突，以及选择器中的标签。

### 变更

- 类型检查会让源码守住插件所声明的语言版本。此前一处 Node 类型声明让源码用上了高于该版本的方法，而这类用法本会毫无提示地通过编译并随插件发布。行为没有任何变化。

## [0.4.0]

### 新增

- 正文流：把整部初稿当作一页连续读写，而每一章仍是各自独立的 Markdown 笔记。点击某一章，它便就地变成编辑器，光标落在你点的那个词上；转到另一章时，前一章又变回排版后的正文。写着当前章名的那一行会一直停在页首，直到下一章把它顶走。
- 项目的正文由它实际拥有的笔记组成，而不再是一篇名为「初稿」的笔记。每篇笔记以 `snowflake-manuscript-sequence` 记录自己的位置，因此移动或重命名都不会改变它被阅读的顺序。已有项目无需任何改动：只有一篇初稿的项目，就是一篇笔记构成的正文。
- 可以在正在读的这一章前后插入新的一章、在光标处把正在写的一章拆成两章，或把它并入下一章。合并会先询问，因为三者之中只有它会让一篇笔记消失。
- 随处可进：第十步的**打开正文流**（会回到上次写作的那篇笔记）、命令面板，以及在文件列表中右键任意一篇正文笔记。
- 十条正文命令：打开与关闭正文流、前往下一篇或上一篇、回到正文流打开时所在的笔记、在前后插入笔记、在光标处拆分，以及切换每篇笔记那一行显示的内容。这些命令仅在当前视图是正文流时提供。
- **正文流**下的三项设置：正在读的那一篇每侧各保留多少篇笔记、是否显示笔记的文件路径，以及是否显示它所存的顺序编号。
- 健康检查会报告缺失、无法读取或被两篇笔记共用的正文位置，并以同一种方式修复：保留正文当前的阅读顺序，把它妥善写下。frontmatter 以下的内容不会被改动。

### 变更

- 全插件的悬浮提示改用 Obsidian 自己的提示，而不再是浏览器的。

### 修复

- 原本会同时出现两个悬浮提示，现在只剩一个。此前有十七处控件同时设置了无障碍标签与浏览器 title，于是 Obsidian 的提示与浏览器的提示彼此重叠：项目切换器、各步骤按钮、健康检查、表格中的标记与警告、工具栏按钮、项目管理器中的控件，以及仪表盘自身的标签页。

## [0.3.2]

### 修复

- 重命名项目不再让它失去自己的链接。Obsidian 会重写被重命名文件夹内的所有链接，将其缩短并去掉 `.md`，而插件仍把所存文本当作文件路径读取。于是初稿明明就在链接所指之处，却被报告为缺失；打开场景时，视点人物会被清空，人物列表也会被清空，保存后两者一并丢失。现在链接会按 Obsidian 的方式解析。
- 场景只会指向本项目中的角色。此前只要另一个项目使用了同名角色，它就会「抢走」原项目场景中的链接——因为名称一旦被重复使用，缩短形式的链接便不再唯一。
- 在插件之外重命名项目文件夹不再悄无声息，而是会被报告，并可一键将文件夹改回项目名称。若想保留新的文件夹名称，请改为重命名项目本身。
- 角色或场景的文件名或标题与所存名称不一致时，会明确指出是哪一种，并在表格中标出对应的行。
- 初稿标题不再包含项目名称——项目重命名时并没有任何机制会同步更新它。

### 新增

- 健康检查会分别指出所存链接可能出现的每一种问题，并分别修复：本应是 wiki 链接却写成纯文本的路径、缩短到依赖名称唯一性的链接、会打开其他项目笔记的链接、指向已不存在笔记的链接，以及仍带有文件扩展名的链接。

### 变更

- 链接按 Obsidian 的写法写入，不再包含它从不显示的 `.md`；初稿链接也与其他链接一样，以笔记名称作为显示文本。已有项目中所存的链接保持原样，两种写法都能读取。
- 由于初稿模板发生了变化，已有项目会有一次「模板已过期」的提示。修复只需一次点击，且不会改动作者写下的任何内容。

## [0.3.1]

### 修复

- 移除了一处高于本插件目标语言版本的 JavaScript 方法调用，该调用会使其返回值无法解析出类型。行为没有任何变化；源码现在可在所声明的目标版本下通过类型检查。

## [0.3.0]

### 新增

- 场景的视点人物与人物字段改为输入即筛选的选择器。输入即可缩小候选角色范围；若项目中尚无该角色，也可直接在字段中创建，无需离开场景表单。
- 角色表与场景表末尾新增添加行，可在读到列表末尾处继续添加，而不必回到长列表上方的按钮。
- 拒绝重名。角色、场景与项目均不能使用同类中已有的名称，输入时字段下方即会说明。仅大小写或空格不同的名称视为同一名称，因为笔记文件名同样如此。

### 变更

- 启动 Obsidian 或重新加载插件后，工作台会定位到第一个尚未完成的步骤；同一次使用期间则停留在最后选择的步骤。
- **重命名项目**与**创建项目**使用同一套对话框，只是少了语言字段，不再另用一套布局。
- 设置页与项目管理器中的项目根目录使用同一个字段。

### 修复

- 刷新后仍保留滚动位置与展开的区段，项目在后台发生变化时工作台不再跳回顶部。
- 删除仍被场景引用的角色时，会先列出这些场景，并将该角色从其人物列表中移除，不再留下无法解析的链接。
- 每个可滚动的面板都会预留滚动条的宽度，无论滚动条是否显示，因此添加第一个撑满面板的角色不再压窄其中已有的内容。
- 表格单元格为其可容纳的段落留出空间。
- 窄工作台不再出现只有几像素宽的横向滚动条。
- 打开其他项目的工作台时，不再先短暂显示上一个项目。
- 建议列表会列出全部匹配项而不再止于五十条，宽度与所属字段一致，并在窗口或分栏调整大小时关闭，而不是停留在字段原来的位置。

## [0.2.0]

### 新增

- 角色与场景的 Bases 视图。每个项目都会在角色与场景文件夹中生成 `角色总览.base` 与 `场景总览.base`，仅筛选该项目的笔记，并按工作台维护的顺序排序。已有项目会在下次健康检查时补齐。
- 角色与场景面板中新增**打开数据库**按钮，位于**添加角色**与**添加场景**旁边。若数据库文件已被删除，打开时会重新生成。
- 新增**打开角色数据库**与**打开场景数据库**命令。
- 新增缺少数据库的健康检查项，可在健康检查器中修复。

### 变更

- 角色类型列按项目语言显示。笔记中保存的值仍为统一取值，因此笔记依然可移植。

## [0.1.1]

### 修复

- 重命名角色或场景时会同时重命名笔记文件并更新笔记标题，使工作台、文件列表与笔记本身保持一致。
- 重命名角色时会刷新场景中保存的相关链接，视点人物与人物条目会显示新名称而非旧名称。

### 新增

- 新增文件名或标题与笔记中保存的名称不一致的健康检查项，可在健康检查器中修复。

## [0.1.0]

- 首个公开发布版本。
