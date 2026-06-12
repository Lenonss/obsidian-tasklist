# TaskList Plugin — Development Documentation

> Updated 2026-06-12 | Version 1.1.0

📖 **用户手册**: 参见 [[README|README.md]]

## Overview

TaskList 是一个 Obsidian 任务管理插件，提供全局 SQLite 数据库 + 文件内联代码块 + 工作看板 + OKR 管理 + AI 集成。任务数据以 SQLite 格式集中存储在 `.tasklist/databases/` 中，通过代码块 (` ```tasklist``` `) 按 ID 引用子集，通过 `.workboard` 文件展示日历看板和仪表盘。

---

## Files

```
Dev/Plugins/TaskList/
├── README.md             # User manual (中文)
├── DEVDOC.md             # This file — developer documentation
├── main.ts               # Plugin entry: register views, commands, context menus, code block processors
├── types.ts              # TypeScript types, constants, default settings (v2: workboard + OKR types)
├── utils.ts              # UUID generation, ISO date formatting, date calculation utilities (no moment.js)
├── i18n.ts               # Internationalization engine: dynamic locale loading, t() lookup with dot-path
├── TaskDatabase.ts       # SQLite data layer (sql.js WASM): crud, schema v2, auto-migration
├── TaskListView.ts       # Sidebar ItemView: global task list panel
├── TaskModal.ts          # Modal form: create/edit task (supports custom save handler)
├── TaskAddPanel.ts       # Modal: enhanced Add panel with DB picker + filters
├── TaskListBlock.ts      # Code block processor (MarkdownRenderChild): ```tasklist``` file-local task refs
├── MigrationTool.ts      # Data migration: scan OKR files → upsert SQLite
├── OkrBlock.ts           # Code block processor: ```okr``` KR ID references, progress cards, update modal
├── WorkboardView.ts      # Custom view for .workboard files: calendar board + dashboard + OKR progress
├── settings.ts           # PluginSettingTab: 3-tab UI (基本/看板/AI & 项目), project CRUD, MCP/Skill management
├── styles.css            # All plugin styles (sidebar, code blocks, calendar, dashboard, OKR cards)
├── manifest.json         # Obsidian plugin manifest
├── package.json          # npm dependencies (sql.js, esbuild, typescript)
├── tsconfig.json         # TypeScript config
├── esbuild.config.mjs    # Build script (bundles + copies WASM)
├── version-bump.mjs      # Version bump helper
├── mcp/                  # MCP Server (standalone Node.js process)
│   ├── server.ts / server.js
│   ├── tools/            # 6 semantic tools
│   ├── types.ts
│   ├── build.mjs
│   └── package.json
└── locales/              # Language packs
    ├── zh.json           # 中文 (all UI strings)
    └── en.json           # English
```

---

## Architecture

### Data Storage

```
┌──────────────────────────────────────────────────────────────┐
│                 SQLite Databases (v2, Multi-Project)         │
│  .tasklist/databases/ (centralized, configurable path)       │
│                                                               │
│  ┌── 工作项目.db ──────────────────────────────────────────┐  │
│  │  tasks (id, title, content, status, priority, created_at, │  │
│  │    updated_at, date, type, source_file)                   │  │
│  │  objectives (id, year, quarter, text, progress...)        │  │
│  │  key_results (id, objective_id, text, target, progress,   │  │
│  │    today, owner...)                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌── 个人项目.db ──────────────────────────────────────────┐  │
│  │  (same schema, independent data)                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                               │
│  ← Read/Write via vault.adapter.readBinary/writeBinary       │
└──────────────────────┬───────────────────────────────────────┘
                       │
          ┌────────────┼────────────┬──────────────┐
          ▼            ▼            ▼              ▼
   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
   │ Sidebar  │  │ Code     │  │ OKR      │  │ Workboard│
   │ Panel    │  │ Block    │  │ Block    │  │ View     │
   │(ItemView)│  │(```task  │  │(```okr)  │  │(.work-   │
   │          │  │ list```) │  │          │  │ board)   │
   └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

### Component Tree

```
TaskListPlugin (main.ts)
├── i18n                          # Dynamic locale system (initI18n, setLocale, t())
├── TaskDatabase                  # Singleton SQLite layer (v2: tasks + objectives + key_results)
├── TaskListView                  # Sidebar panel (ItemView)
│   └── TaskModal                 #   Create/edit via modal
├── TaskListBlock                 # Code block processor: ```tasklist```
│   ├── TaskAddPanel              #   Enhanced Add modal
│   │   └── TaskModal             #     Nested: create new task
│   └── TaskModal                 #   Edit existing task
├── OkrBlock                      # Code block processor: ```okr```
│   ├── OkrAddPanel               #   KR picker modal
│   └── OkrProgressModal          #   Progress update modal
├── WorkboardView                 # .workboard custom view
│   └── Calendar + Dashboard + OKR section (pure SVG charts)
├── MigrationTool                 # OKR files → SQLite sync (scoped to active project rootPath)
├── TaskListSettingTab            # 3-tab settings (基本 / 看板 / AI & 项目)
│   ├── Project CRUD table        #   Add/edit/delete/enable projects with validation
│   ├── MCP management            #   Install, test connection, register to mcp.json
│   └── Skill management          #   Install/update Claude Code Skill
└── Context menus                 #   Editor + file explorer + folder
```

### Data Flow: Code Block Add

```
User clicks Add in code block
  → TaskAddPanel opens
  ├── "Create new task"
  │   → TaskModal opens (nested)
  │   → Save to SQLite → returns Task with UUID
  │   → UUID appended to code block via regex-based file write
  │   → Vault.process() triggers markdown re-render
  │   → New TaskListBlock instance renders task cards from DB
  └── "Pick from database"
      → Filter/search DB tasks (excluding already-referenced)
      → Multi-select checkboxes
      → "Add selected" → batch append UUIDs to code block
      → Vault.process() triggers re-render
```

### Key Design: writeBlock

Code block content is written via **regex-based file modification** (NOT section line numbers):

```typescript
// TaskListBlock.writeBlock()
// 1. Locate ```tasklist marker in raw file content
// 2. Find closing ``` marker
// 3. Replace everything between them with new content
// 4. Preserve code fence markers
```

This approach avoids Obsidian `getSectionInfo()` line-number inconsistencies across versions.

### Key Design: TaskModal saveHandler

`TaskModal` supports an optional `saveHandler` callback. When provided:
- New tasks are saved via the handler instead of `taskDatabase.addTask()`
- This allows code block to intercept the save and also append the UUID

Relevant type:
```typescript
export interface TaskSubmitData {
  title: string;
  content: string;
  priority: TaskPriority;
  status: TaskStatus;
}
```

### Key Design: i18n System

The plugin uses a dynamic locale system. Language packs are JSON files in `locales/` with dot-path keys:

```typescript
// i18n.ts
// initI18n(lang) → sets locale dictionary
// t('status.pending') → looks up { status: { pending: "未开始" } }
// setLocale(json) → replaces active dictionary at runtime
```

All UI strings use `t()` — no hardcoded Chinese/English strings in component files. The settings UI re-renders on language switch. Opened views need manual re-open to pick up new locale (limitation noted in settings hint).

### Key Design: Multi-Project System

The plugin supports multiple independent projects in one vault:

```
settings.projects: ProjectConfig[]
settings.activeProjectId: string
```

**Database lifecycle**:
- `getProjectDatabase(id)` lazily creates/caches `TaskDatabase` instances per project
- Databases stored centrally at `dataDir/{dbFileName}.db` (default: `.tasklist/databases/`)
- `TaskDatabase` constructor takes `(dbPath, vaultAdapter)` — no plugin dependency

**Auto-detection**:
- `detectProjectFromActiveFile()` matches active file path against project `rootPath`s
- Longest prefix match wins (handles nested project paths correctly)

**Migration**:
- On first load after upgrade from single-DB setup, `ensureProjectsInitialized()`:
  1. Infers project name/rootPath from old `databaseFilePath`
  2. Moves old DB to `.tasklist/databases/{name}.db`
  3. Creates default project config

### Key Design: MCP & Skill Management

MCP Server and Skill are managed directly from the plugin settings UI:

**MCP Server** (`mcp/` directory):
- Standalone Node.js process using `@modelcontextprotocol/sdk`
- Communicates via stdio (JSON-RPC 2.0)
- Uses sql.js for direct DB access (no Obsidian dependency)
- Settings UI: install (npm install + build), test connection (spawn + JSON-RPC handshake), register to mcp.json

**Claude Code Skill** (`.claude/skills/tasklist-summary/SKILL.md`):
- Referenced documentation + report generation workflows
- Settings UI: install/update detection

Both are managed via `main.ts` methods that use Node.js `child_process` and `fs` modules.

---

## Public Entries

| Entry | Access | Description |
|-------|--------|-------------|
| Sidebar panel | Ribbon icon / `Ctrl+P` "Open task list" | Global task management (CRUD) |
| Code block `tasklist` | ` ```tasklist``` ` in any `.md` | File-local task references |
| Code block `okr` | ` ```okr``` ` in any `.md` | Embedded KR progress cards |
| `.workboard` file | Double-click or command | Calendar board + dashboard view |
| Sync command | `Ctrl+P` "Sync daily reports" | Migrate frontmatter → SQLite |
| Right-click | File / Folder | Create task from file, create workboard |
| Settings | `Ctrl+,` → TaskList | DB path, defaults, workboard defaults |

---

## Build & Deploy

```bash
cd Dev/Plugins/TaskList
npm run dev            # Watch mode: auto-rebuild on changes
npm run build          # TypeScript check + esbuild bundle + copy WASM

# After build, the output files need to be in the Obsidian plugins directory:
# main.js  manifest.json  styles.css  sql-wasm.wasm
#   → ../../../.obsidian/plugins/tasklist/
```

**Dependencies:**
- `obsidian` — Obsidian API (external, not bundled)
- `sql.js` — SQLite WebAssembly (bundled into main.js, ~57KB + 645KB WASM)
- `esbuild` — build tool (dev dependency)

**Note:** The `.tasklist/databases/` directory (database storage) and `.claude/` directory (MCP/Skill config) are in the vault root, not the plugin directory.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Code block shows "Failed to load tasks" | WASM not found | Ensure `sql-wasm.wasm` is in `.obsidian/plugins/tasklist/` |
| Code block empty after Add | Stale section info | `writeBlock` uses regex, not section lines — already fixed |
| Tasks appear as raw text above document | `getSectionInfo` line offset | `writeBlock` now uses regex — already fixed |
| DB error on startup | DB file at wrong path | Check Settings → AI & 项目 → database storage directory |
| Wrong project data shown | Active project mismatch | Open a file in the target project folder to auto-switch |
| MCP Server connection fails | Build not run or deps missing | Run `npm install` in `mcp/`, then click "Install MCP Server" in settings |
| Migration produces no data | rootPath doesn't match OKR files | Verify project rootPath points to the directory containing OKR `.md` files |

---

## Changes Log

| Date | Change |
|------|--------|
| 2026-06-10 | Initial implementation: YAML → SQLite migration |
| 2026-06-10 | Add code block processor (ID-reference pattern) |
| 2026-06-10 | Add right-click context menus |
| 2026-06-10 | Add TaskAddPanel with filter + multi-select |
| 2026-06-10 | Fix: replace section-line writeBlock with regex approach |
| 2026-06-10 | Fix: remove redundant onRefresh double-render |
| 2026-06-10 | Schema v2: extend tasks table, add objectives/key_results tables |
| 2026-06-10 | Add MigrationTool for daily report + OKR sync |
| 2026-06-10 | Add ```okr``` code block processor with KR progress cards |
| 2026-06-10 | Add .workboard file type with calendar board + dashboard view |
| 2026-06-10 | Add date utilities (no moment.js), SVG charts, OKR progress section |
| 2026-06-10 | Extend settings with workboard defaults, ribbon, context menus |
| 2026-06-11 | Add multi-project support: ProjectConfig, centralized DB (.tasklist/databases/), auto-detect, conflict detection |
| 2026-06-11 | Refactor TaskDatabase: constructor(dbPath, vaultAdapter) pattern, removed plugin dependency |
| 2026-06-11 | Add project management UI in settings (CRUD table, add/edit modal, validation) |
| 2026-06-11 | Add MigrationTool rootPath scoping for active project |
| 2026-06-11 | Add MCP Server module (mcp/): 6 semantic tools, sql.js direct access, stdio transport |
| 2026-06-11 | Add Claude Code Skill (tasklist-summary): MCP manual + report generation workflows |
| 2026-06-11 | Add MCP/Skill management UI in settings (install, test connection, register, status detection) |
| 2026-06-11 | Extend i18n with project/MCP/Skill management strings (zh/en) |
| 2026-06-12 | Add README.md user manual and update DEVDOC with i18n/multi-project/MCP architecture details |

---

## Multi-Project Architecture (v1.1.0)

### Project Model

```typescript
interface ProjectConfig {
  id: string;        // UUID
  name: string;      // Display name
  rootPath: string;  // Markdown root directory
  dbFileName: string; // SQLite DB filename (stored in dataDir)
  enabled: boolean;
}
```

### Database Storage

All project databases are stored centrally at `.tasklist/databases/` (configurable via `dataDir` setting). Each project gets its own `.db` file.

### Auto-Detection

When a file is opened, the plugin matches its path against configured project `rootPath`s. The longest prefix match wins. Falls back to manually selected active project if no match.

### Migration

On first load after upgrade, if `projects` is empty:
1. Infers project name and rootPath from old `databaseFilePath`
2. Moves old DB to `.tasklist/databases/{name}.db`
3. Creates default project config

---

## MCP Server

### Location

`Dev/Plugins/TaskList/mcp/` - standalone Node.js process, independent of Obsidian.

### Architecture

```
mcp/
├── server.ts             # StdioServerTransport entry
├── tools/
│   ├── index.ts          # Tool registration (6 tools)
│   ├── query-tasks.ts    # get_tasks_by_date_range, get_task_stats
│   ├── query-okr.ts      # get_okr_progress, get_kr_history
│   └── query-reports.ts  # get_daily_reports, get_project_info
├── types.ts              # Shared types
├── package.json          # @modelcontextprotocol/sdk + sql.js
├── tsconfig.json         # Node.js target
└── build.mjs             # esbuild bundle
```

### Tools

| Tool | Parameters | Returns |
|------|-----------|---------|
| `get_tasks_by_date_range` | startDate, endDate, type? | TaskItem[] |
| `get_task_stats` | startDate, endDate | TaskStats + trend |
| `get_okr_progress` | year, quarter | Objective[] + KeyResult[] |
| `get_kr_history` | krId | KrHistoryEntry[] |
| `get_daily_reports` | startDate, endDate | DailyReport[] |
| `get_project_info` | — | ProjectInfo |

### Installation

1. `cd Dev/Plugins/TaskList/mcp && npm install`
2. `npm run build` (or via plugin settings UI)
3. Register in `.claude/mcp.json` (one entry per project)

---

## Claude Code Skill

Location: `.claude/skills/tasklist-summary/SKILL.md`

Provides:
- MCP tool reference (parameters, examples)
- Report generation workflows (weekly, monthly, annual, OKR summary)
- Template file locations
- Best practices (don't overwrite manual edits, semantic summarization)
