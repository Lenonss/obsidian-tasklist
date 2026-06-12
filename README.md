# TaskList — Obsidian 任务管理插件

> 集中式任务数据库 · 日报看板 · OKR 管理 · AI 集成

**English**: TaskList is an Obsidian plugin for centralized task management with SQLite database. It provides inline task list code blocks, OKR (Objectives and Key Results) management, a calendar workboard view with dashboard, multi-project support, and AI integration via MCP Server and Claude Code Skill. Supports Chinese and English.

---

## 功能概览

| 功能 | 说明 |
|------|------|
| 📋 **任务管理** | SQLite 集中式任务数据库，支持 CRUD、状态切换、优先级筛选 |
| 📝 **任务代码块** | `` ```tasklist ``` 内联任务引用，按 ID 关联数据库 |
| 🎯 **OKR 管理** | `` ```okr ``` 代码块嵌入 KR 进度卡片，支持进度更新 |
| 📊 **工作看板** | `.workboard` 日历看板 + 仪表盘 + OKR 进度总览 |
| 🗂️ **多项目管理** | 按目录/项目隔离数据库，自动检测活跃项目 |
| 🤖 **AI 集成** | MCP Server（6 个语义工具）+ Claude Code Skill（周报/月报生成） |
| 🌐 **国际化** | 中文 / English 双语言支持 |

---

## 快速开始

### 1. 安装

将插件文件复制到 Obsidian 插件目录：

```
main.js  manifest.json  styles.css  sql-wasm.wasm
  → .obsidian/plugins/tasklist/
```

在 Obsidian 中启用插件。

### 2. 初始化项目

打开设置（`Ctrl+,`）→ **TaskList** → **AI & 项目** 标签页：

1. 点击 **添加项目**
2. 填写项目名称（如「工作项目」）
3. 设置根目录（Markdown 日报/周报/OKR 文件所在目录）
4. 数据库文件自动生成（如 `工作项目.db`）

### 3. 创建第一个任务

- **侧边栏**：点击左侧功能区图标 → **添加** 按钮
- **命令面板**：`Ctrl+P` → 「快速添加任务」
- **右键菜单**：在 Markdown 文件中选中文字 → 右键 → 「从选中文字创建任务」

---

## 详细使用指南

### 📋 任务管理

#### 侧边栏视图

点击功能区图标或执行「打开任务列表」命令，在右侧边栏打开任务面板：

- **筛选**：按状态（未开始/进行中/已完成）和优先级（高/中/低）过滤
- **新建**：点击「添加」按钮，弹出表单填写标题、内容、优先级、状态
- **编辑**：点击任务卡片上的编辑按钮
- **切换状态**：点击状态切换按钮（未开始 → 进行中 → 已完成 → 循环）
- **删除**：点击删除按钮，二次确认后删除

#### 快捷创建

| 方式 | 操作 |
|------|------|
| 命令面板 | `Ctrl+P` → 「快速添加任务」 |
| 右键菜单 | 选中 Markdown 文字 → 右键 → 「从选中文字创建任务」 |
| 文件菜单 | 右键点击 `.md` 文件 → 「添加到任务列表」 |

### 📝 任务代码块（`tasklist`）

在 Markdown 文件中插入 `tasklist` 代码块，按 ID 引用数据库中的任务：

````markdown
```tasklist
a1b2c3d4-...
e5f6g7h8-...
```
````

**操作方式**：
- **添加任务**：点击代码块右上角「添加」→ 可选「创建新任务」或「从数据库选择」
- **编辑/删除**：悬停任务行，点击编辑/移除按钮
- **移除**：仅从代码块中移除引用，不删除数据库记录

**插入代码块**：在编辑器中右键 → 「插入任务列表」

### 🎯 OKR 代码块（`okr`）

OKR 代码块用于在文档中嵌入关键结果进度卡片：

````markdown
```okr
//blockId:a1b2c3d4
{
  "objectiveId": "obj-uuid",
  "title": "Q2 目标",
  "krIds": ["kr-uuid-1", "kr-uuid-2"]
}
```
````

**操作方式**：
- **添加 KR**：点击「添加 KR」从数据库中选择或创建新 KR
- **更新进度**：点击进度条或编辑按钮，弹出进度更新面板（进度 %、今日更新、评分、权重）
- **配置目标**：点击配置按钮，选择或创建目标

### 📊 工作看板（Workboard）

工作看板提供日历视图 + 仪表盘 + OKR 进度总览。

**创建看板**：
1. 命令面板 → 「新建工作看板」
2. 或右键点击文件夹 → 「在此创建看板」

**看板功能**：
- 🔄 **日历视图**：周/月/季度/年视图切换，显示每日任务卡片
- 📈 **仪表盘**：今日完成、进行中、总任务数统计；完成趋势 SVG 图表；任务分布图
- 🎯 **OKR 进度**：折叠面板，展示所有 KR 进度条和今日更新

**导航**：
- 点击「← 上一周/月/季度/年」「下一周/月/季度/年 →」切换时间范围
- 点击「📅 今天」回到当前时间

### 🗂️ 多项目管理

支持在一个 Vault 中管理多个工作项目，每个项目拥有独立的数据库和 Markdown 目录。

**配置**：设置 → **AI & 项目** → 项目管理表格

| 字段 | 说明 |
|------|------|
| 名称 | 项目显示名称 |
| 根目录 | Markdown 文件所在目录（用于自动匹配和数据同步） |
| 数据库文件 | `.tasklist/databases/` 下的 `.db` 文件名 |

**自动切换**：打开某项目根目录下的文件时，自动切换到对应项目。

**路径验证**：创建/编辑项目时自动检测路径冲突（完全一致 或 包含关系）。

### 🤖 AI 集成

#### MCP Server

独立的 Node.js 进程，提供 6 个语义工具，可被 Claude Code 调用：

| 工具 | 功能 |
|------|------|
| `get_tasks_by_date_range` | 按日期范围查询任务 |
| `get_task_stats` | 任务统计 + 趋势分析 |
| `get_okr_progress` | OKR 进度查询（按年份/季度） |
| `get_kr_history` | 单个 KR 历史记录 |
| `get_daily_reports` | 日报记录查询 |
| `get_project_info` | 项目概览信息 |

**安装**：设置 → **AI & 项目** → MCP Server → 「安装 MCP Server」

**测试连接**：安装后点击「测试连接」验证 MCP 是否正常响应。

**注册**：点击「重新注册到 mcp.json」，自动为每个启用项目生成 MCP 配置条目。

#### Claude Code Skill

`tasklist-summary` Skill 提供：
- MCP 工具使用参考文档
- 周报 / 月报 / 年报 / OKR 总结生成工作流
- 模板文件位置和最佳实践

**安装**：设置 → **AI & 项目** → Skill → 「安装 Skill」

---

## 设置参考

### 基本设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 语言 | 中文 | 界面显示语言（切换后需重新打开视图） |
| 默认优先级 | 中 | 新建任务的默认优先级 |
| 默认状态 | 未开始 | 新建任务的默认状态 |

### 看板设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 默认年份 | 当前年份 | 新建看板和同步操作的默认年份 |
| 默认季度 | 当前季度 | 新建 OKR 和同步操作的默认季度 |
| 默认时间范围 | 周 | 新建看板的默认视图（周/月/季度/年） |
| 显示仪表盘 | 开 | 新建看板默认显示仪表盘面板 |
| 每日最多卡片数 | 20 | 日历视图每天可见的任务卡片上限 |

### AI & 项目设置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 数据库存储目录 | `.tasklist/databases` | 所有项目数据库集中存储位置 |
| 活跃项目 | 首个启用项目 | 当前使用的项目 |
| 项目管理 | — | 添加/编辑/删除/启用项目 |

---

## 命令面板

| 命令 | 快捷键 | 说明 |
|------|--------|------|
| 打开任务列表 | — | 打开/聚焦右侧任务面板 |
| 快速添加任务 | — | 直接弹出新建任务表单 |
| 同步 OKR 到数据库 | — | 扫描 Markdown OKR 文件同步到 SQLite |
| 新建工作看板 | — | 创建新的 `.workboard` 看板文件 |

---

## 数据存储

### 数据库位置

所有数据库文件集中存储在 `.tasklist/databases/` 目录（可配置）。

```
vault/
├── .tasklist/
│   └── databases/
│       ├── 工作项目.db       # 项目1 的 SQLite 数据库
│       └── 个人项目.db       # 项目2 的 SQLite 数据库
├── .obsidian/
│   └── plugins/
│       └── tasklist/
│           ├── main.js
│           ├── styles.css
│           ├── manifest.json
│           └── sql-wasm.wasm    # SQLite WebAssembly (645KB)
└── .claude/
    ├── mcp.json                 # MCP Server 注册配置
    └── skills/
        └── tasklist-summary/
            └── SKILL.md         # Claude Code Skill
```

### 数据库表结构

| 表 | 用途 |
|----|------|
| `tasks` | 任务数据（id, title, content, status, priority, date, type, source_file） |
| `objectives` | OKR 目标（id, year, quarter, text, progress, score, weight） |
| `key_results` | 关键结果（id, objective_id, text, target, progress, today, owner） |

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| 代码块显示「无法加载任务」 | 确保 `sql-wasm.wasm` 在 `.obsidian/plugins/tasklist/` 目录下 |
| 新建任务后代码块为空 | 已使用正则匹配方案修复，升级到最新版本即可 |
| 数据库错误 | 检查设置中的项目配置和数据库路径是否正确 |
| MCP 连接失败 | 先在设置中「安装 MCP Server」，再「测试连接」确认 |
| 切换项目后数据不更新 | 重新打开侧边栏或重新加载 Markdown 文件 |
| 语言切换不生效 | 已打开的视图需重新打开才能应用新语言 |

---

## 技术栈

- **Obsidian API** — 视图、命令、代码块处理、文件适配器
- **sql.js (SQLite WASM)** — 离线数据库引擎
- **esbuild** — TypeScript 编译打包
- **MCP SDK** — AI 集成标准协议
- **纯 SVG** — 看板图表（无外部图表库依赖）

## 文件结构

```
Dev/Plugins/TaskList/
├── main.ts              # 插件入口
├── types.ts             # 类型定义 & 默认设置
├── utils.ts             # 工具函数（UUID、日期）
├── i18n.ts              # 国际化引擎
├── TaskDatabase.ts      # SQLite 数据层
├── TaskListView.ts      # 侧边栏任务面板
├── TaskModal.ts         # 任务编辑弹窗
├── TaskAddPanel.ts      # 增强添加面板（筛选+多选）
├── TaskListBlock.ts     # ```tasklist 代码块
├── OkrBlock.ts          # ```okr 代码块
├── WorkboardView.ts     # .workboard 看板视图
├── MigrationTool.ts     # Markdown → SQLite 同步
├── settings.ts          # 设置面板
├── styles.css           # 全部样式
├── mcp/                 # MCP Server（独立进程）
│   ├── server.ts        # 入口
│   ├── tools/           # 6 个工具实现
│   └── build.mjs        # 构建脚本
└── locales/             # 语言包
    ├── zh.json          # 中文
    └── en.json          # English
```
