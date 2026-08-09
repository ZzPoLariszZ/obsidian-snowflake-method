<a id="english"></a>

# Changelog

**English** · **[简体中文](#简体中文)**

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
