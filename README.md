# Projex

> All-in-one project execution hub — centralized task database · workboard · OKR tracking · AI integration

**中文**：Projex 是一款 Obsidian 全能项目执行中枢插件，提供基于 SQLite 的集中式任务管理、内联任务代码块、OKR 目标管理、日历工作看板、多项目支持，以及 MCP Server + Claude Code Skill 的 AI 集成能力，支持中英双语。

---

## Features

| Feature | Description |
|---------|-------------|
| 📋 **Task Management** | Centralized SQLite task database with full CRUD, status toggling, and priority filtering |
| 📝 **Task Blocks** | ```` ```tasklist ```` inline code blocks referencing tasks by ID from the database |
| 🎯 **OKR Tracking** | ```` ```okr ```` code blocks embedding KR progress cards with inline progress updates |
| 📊 **Workboard** | `.workboard` calendar view + dashboard + OKR progress overview |
| 🗂️ **Multi-Project** | Per-directory database isolation with automatic active project detection |
| 🤖 **AI Integration** | MCP Server (6 semantic tools) + Claude Code Skill for weekly/monthly report generation |
| 🌐 **Internationalization** | Chinese / English bilingual UI |

---

## Quick Start

### 1. Installation

Copy the plugin files to your Obsidian plugins directory:

```
main.js  manifest.json  styles.css  sql-wasm.wasm
  → .obsidian/plugins/tasklist/
```

Enable the plugin in Obsidian's Community Plugins settings.

### 2. Initialize a Project

Open Settings (`Ctrl+,`) → **Projex** → **AI & Projects** tab:

1. Click **Add Project**
2. Enter a project name (e.g., "Work")
3. Set the root directory (where your Markdown daily notes, weeklies, and OKR files live)
4. The database file is auto-generated (e.g., `Work.db`)

### 3. Create Your First Task

- **Sidebar**: Click the ribbon icon → **Add** button
- **Command Palette**: `Ctrl+P` → "Quick add task"
- **Context Menu**: Select text in a Markdown file → right-click → "Create task from selection"

---

## Detailed Guide

### 📋 Task Management

#### Sidebar View

Click the ribbon icon or run "Open task list" to open the task panel in the right sidebar:

- **Filter**: By status (Not Started / In Progress / Done) and priority (High / Medium / Low)
- **Create**: Click "Add" to open the task form (title, description, priority, status)
- **Edit**: Click the edit icon on any task card
- **Toggle Status**: Cycle through Not Started → In Progress → Done
- **Delete**: Click delete with confirmation dialog

#### Quick Create

| Method | Action |
|--------|--------|
| Command Palette | `Ctrl+P` → "Quick add task" |
| Context Menu | Select text → right-click → "Create task from selection" |
| File Menu | Right-click `.md` file → "Add to task list" |

### 📝 Task Blocks (`tasklist`)

Insert a `tasklist` code block in any Markdown file to reference tasks by their database ID:

````markdown
```tasklist
a1b2c3d4-...
e5f6g7h8-...
```
````

**Actions**:
- **Add task**: Click "Add" in the code block toolbar → "Create new" or "Select from database"
- **Edit/Remove**: Hover over a task row to reveal edit/remove buttons
- **Remove**: Only removes the reference from the code block, not from the database

**Insert block**: Right-click in editor → "Insert task list"

### 🎯 OKR Blocks (`okr`)

OKR code blocks embed Key Result progress cards in your documents:

````markdown
```okr
//blockId:a1b2c3d4
{
  "objectiveId": "obj-uuid",
  "title": "Q2 Objective",
  "krIds": ["kr-uuid-1", "kr-uuid-2"]
}
```
````

**Actions**:
- **Add KR**: Click "Add KR" to select from database or create new
- **Update Progress**: Click the progress bar or edit button for the progress panel (percentage, today's update, score, weight)
- **Configure Objective**: Click the settings button to select or create an objective

### 📊 Workboard

The workboard provides a calendar view + dashboard + OKR progress overview.

**Create a workboard**:
1. Command Palette → "New workboard"
2. Or right-click a folder → "Create workboard here"

**Features**:
- 🔄 **Calendar View**: Week / Month / Quarter / Year views with daily task cards
- 📈 **Dashboard**: Today's completed, in-progress, total task counts; completion trend SVG chart; task distribution chart
- 🎯 **OKR Progress**: Collapsible panel showing all KR progress bars and today's updates

**Navigation**:
- Click ← Previous / Next → to move through time periods
- Click "📅 Today" to return to the current date

### 🗂️ Multi-Project Support

Manage multiple projects within a single vault, each with its own database and Markdown directory.

**Configuration**: Settings → **AI & Projects** → Project management table

| Field | Description |
|-------|-------------|
| Name | Project display name |
| Root Directory | Markdown file directory (for auto-matching and data sync) |
| Database File | `.db` filename under `.tasklist/databases/` |

**Auto-switch**: Opening a file under a project's root directory automatically switches to that project.

**Path validation**: Conflict detection on create/edit (exact match or containment).

### 🤖 AI Integration

#### MCP Server

A standalone Node.js process providing 6 semantic tools callable by Claude Code:

| Tool | Function |
|------|----------|
| `get_tasks_by_date_range` | Query tasks by date range |
| `get_task_stats` | Task statistics + trend analysis |
| `get_okr_progress` | OKR progress by year/quarter |
| `get_kr_history` | Individual KR history |
| `get_daily_reports` | Daily report records |
| `get_project_info` | Project overview |

**Setup**: Settings → **AI & Projects** → MCP Server → "Install MCP Server"

**Test**: Click "Test Connection" after installation to verify.

**Register**: Click "Re-register to mcp.json" to auto-generate MCP config entries for each enabled project.

#### Claude Code Skill

The `tasklist-summary` Skill provides:
- MCP tool usage reference documentation
- Weekly / Monthly / Annual / OKR summary generation workflows
- Template file locations and best practices

**Setup**: Settings → **AI & Projects** → Skill → "Install Skill"

---

## Settings Reference

### General

| Setting | Default | Description |
|---------|---------|-------------|
| Language | Chinese | UI display language (reopen views after switching) |
| Default Priority | Medium | Default priority for new tasks |
| Default Status | Not Started | Default status for new tasks |

### Workboard

| Setting | Default | Description |
|---------|---------|-------------|
| Default Year | Current year | Default year for new workboards and sync |
| Default Quarter | Current quarter | Default quarter for new OKRs and sync |
| Default Time Range | Week | Default view for new workboards (Week/Month/Quarter/Year) |
| Show Dashboard | On | Show dashboard panel by default on new workboards |
| Max Cards Per Day | 20 | Visible task card limit per day in calendar view |

### AI & Projects

| Setting | Default | Description |
|---------|---------|-------------|
| Database Directory | `.tasklist/databases` | Centralized location for all project databases |
| Active Project | First enabled project | Currently active project |
| Project Management | — | Add / Edit / Delete / Enable projects |

---

## Commands

| Command | Hotkey | Description |
|---------|--------|-------------|
| Open task list | — | Open/focus the right sidebar task panel |
| Quick add task | — | Open the new task form directly |
| Sync OKR to database | — | Scan Markdown OKR files and sync to SQLite |
| New workboard | — | Create a new `.workboard` file |

---

## Data Storage

### Database Location

All database files are stored centrally in `.tasklist/databases/` (configurable).

```
vault/
├── .tasklist/
│   └── databases/
│       ├── Work.db              # Project 1 SQLite database
│       └── Personal.db           # Project 2 SQLite database
├── .obsidian/
│   └── plugins/
│       └── tasklist/
│           ├── main.js
│           ├── styles.css
│           ├── manifest.json
│           └── sql-wasm.wasm     # SQLite WebAssembly (645KB)
└── .claude/
    ├── mcp.json                  # MCP Server registration config
    └── skills/
        └── tasklist-summary/
            └── SKILL.md          # Claude Code Skill
```

### Database Schema

| Table | Purpose |
|-------|---------|
| `tasks` | Task data (id, title, content, status, priority, date, type, source_file) |
| `objectives` | OKR objectives (id, year, quarter, text, progress, score, weight) |
| `key_results` | Key results (id, objective_id, text, target, progress, today, owner) |

---

## FAQ

| Issue | Solution |
|-------|----------|
| Code block shows "Cannot load tasks" | Ensure `sql-wasm.wasm` is in `.obsidian/plugins/tasklist/` |
| New task not appearing in code block | Upgrade to the latest version (regex matching fix applied) |
| Database error | Check project configuration and database paths in settings |
| MCP connection failed | Run "Install MCP Server" in settings first, then "Test Connection" |
| Data not updating after switching projects | Reopen the sidebar or reload the Markdown file |
| Language switch not taking effect | Reopen views to apply the new language |

---

## Tech Stack

- **Obsidian API** — Views, commands, code block processing, file adapter
- **sql.js (SQLite WASM)** — Offline database engine
- **esbuild** — TypeScript bundling
- **MCP SDK** — AI integration protocol
- **Pure SVG** — Workboard charts (no external charting library)

## File Structure

```
TaskList/
├── main.ts              # Plugin entry point
├── types.ts             # Type definitions & default settings
├── utils.ts             # Utilities (UUID, date helpers)
├── i18n.ts              # Internationalization engine
├── TaskDatabase.ts      # SQLite data layer
├── TaskListView.ts      # Sidebar task panel
├── TaskModal.ts         # Task edit modal
├── TaskAddPanel.ts      # Enhanced add panel (filter + multi-select)
├── TaskListBlock.ts     # ```tasklist code block processor
├── OkrBlock.ts          # ```okr code block processor
├── WorkboardView.ts     # .workboard view
├── MigrationTool.ts     # Markdown → SQLite sync
├── settings.ts          # Settings tab
├── styles.css           # All styles
├── mcp/                 # MCP Server (standalone process)
│   ├── server.ts        # Entry point
│   ├── tools/           # 6 tool implementations
│   └── build.mjs        # Build script
└── locales/             # Language packs
    ├── zh.json          # Chinese
    └── en.json          # English
```
