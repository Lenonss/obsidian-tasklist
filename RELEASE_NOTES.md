## What's Changed

### 🔧 Improvements
- **Refactored filter state management**: Replaced fragile DOM selector query (`parentElement.querySelectorAll('.tasklist-filter-select')`) with direct element references stored as class properties (`statusFilterEl`, `priorityFilterEl`)

### 🐛 Bug Fixes
- **Cache synchronization in TaskListBlock**: Fixed parent task list not refreshing after adding sub-tasks in-place
- **Filter state preservation**: TaskListView now correctly preserves current filter selection on refresh instead of resetting to 'all'

## Changed Files
- `TaskListView.ts` - Store filter element references as class properties
- `TaskListBlock.ts` - Cache invalidation and sync logic for parent-child task management

**Full Changelog**: https://github.com/Lenonss/obsidian-tasklist/compare/v1.3.2...v1.3.3
