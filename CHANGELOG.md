<a id="english"></a>

# Changelog

**English** · **[简体中文](#简体中文)**

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
