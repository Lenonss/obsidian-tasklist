import {
  MarkdownRenderChild,
  MarkdownPostProcessorContext,
  TFile,
  setIcon,
  Notice,
} from 'obsidian';
import type TaskListPlugin from './main';
import { Task, getStatusLabel, getPriorityLabel, getTaskTypeLabel } from './types';
import { TaskModal, TaskSubmitData } from './TaskModal';
import { TaskAddPanel } from './TaskAddPanel';
import { t } from './i18n';

// UUID regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Block ID marker — uniquely identifies each ```tasklist block in a file
const BLOCK_ID_RE = /^:block-id:\s*([a-z0-9]+)$/i;

// Task ID list boundaries — UUIDs are only valid between these markers
const ID_LIST_START = ':task-idList-start:';
const ID_LIST_END = ':task-idList-end:';

function generateBlockId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export class TaskListBlock extends MarkdownRenderChild {
  private plugin: TaskListPlugin;
  private ctx: MarkdownPostProcessorContext;

  constructor(
    containerEl: HTMLElement,
    plugin: TaskListPlugin,
    ctx: MarkdownPostProcessorContext
  ) {
    super(containerEl);
    this.plugin = plugin;
    this.ctx = ctx;
  }

  private expandedTaskId: string | null = null;
  private childrenCache: Map<string, Task[]> = new Map();

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- MarkdownRenderChild onload must be async for data loading
  async onload() {
    await this.render();
  }

  // ───── Render ─────

  async render() {
    const el = this.containerEl;
    el.empty();
    el.addClass('tasklist-block');

    // Parse UUIDs from the code block
    const { ids, lines, blockId } = this.parseBlockSource();

    // Clean up stale IDs FIRST (before rendering anything visible)
    let allTasks: Task[] = [];
    try {
      allTasks = await this.plugin.taskDatabase.readTasks();
    } catch (err) {
      console.error('TaskList: DB read failed', err);
      el.createDiv({
        text: t('block.loadFailed'),
        cls: 'tasklist-block-error',
      });
      return;
    }

    const idSet = new Set(ids);
    const staleIds = ids.filter(
      (id) => !allTasks.some((t) => t.id === id)
    );
    if (staleIds.length > 0) {
      // lines are pure UUIDs — just filter out the stale ones
      const cleanedLines = lines.filter((line) => !staleIds.includes(line));
      await this.writeBlock(cleanedLines.join('\n'), blockId ?? undefined);
      return;
    }

    // Filter: only tasks whose ID appears in the code block
    const matched = allTasks.filter((t) => idSet.has(t.id));

    // Sort: by priority desc, then updated desc
    const priorityOrder: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    matched.sort((a, b) => {
      const p =
        (priorityOrder[a.priority] ?? 99) -
        (priorityOrder[b.priority] ?? 99);
      if (p !== 0) return p;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    // ── Header ──
    const header = el.createDiv({ cls: 'tasklist-block-header' });
    header.createSpan({
      text: t('block.title') + ' (' + matched.length + ')',
      cls: 'tasklist-block-title',
    });

    const addBtn = header.createEl('button', {
      cls: 'tasklist-block-add-btn mod-cta',
      attr: {
        'aria-label': t('block.addTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(addBtn, 'plus');
    addBtn.createSpan({ text: ' ' + t('block.add') });
    addBtn.addEventListener('click', () => this.openAddPanel());

    // ── Empty state ──
    if (matched.length === 0) {
      el.createDiv({
        text:
          ids.length === 0
            ? t('block.emptyNoRefs')
            : t('block.emptyDeleted'),
        cls: 'tasklist-block-empty',
      });
      return;
    }

    // ── Task rows ──
    const list = el.createDiv({ cls: 'tasklist-block-list' });
    for (const task of matched) {
      this.renderRow(list, task);
      if (task.id === this.expandedTaskId && (task.taskType || 'text') === 'parent') {
        this.renderBlockExpandedBody(list, task);
      }
    }
  }

  private renderRow(container: HTMLElement, task: Task) {
    const taskType = (task.taskType || 'text') as 'text' | 'progress' | 'parent';
    const isExpanded = task.id === this.expandedTaskId;

    const row = container.createDiv({ cls: 'tasklist-block-row' });

    if (taskType === 'parent') {
      row.addClass('tasklist-block-row-parent');
      row.setAttr('data-task-id', task.id);
      if (isExpanded) {
        row.addClass('tasklist-block-expanded');
      }
      row.addEventListener('click', (evt) => {
        const target = evt.target as HTMLElement;
        if (target.closest('button')) return;
        void this.toggleExpand(task);
      });
    }

    // Priority dot
    const colors: Record<string, string> = {
      high: 'var(--text-error)',
      medium: 'var(--text-warning)',
      low: 'var(--text-muted)',
    };
    const priorityDot = row.createDiv({
      cls: 'tasklist-priority-dot',
    });
    priorityDot.setCssProps({
      '--priority-color': colors[task.priority] || colors['medium'],
    });

    // Info
    const info = row.createDiv({ cls: 'tasklist-block-info' });
    info.createSpan({
      text: task.title,
      cls: 'tasklist-block-task-title',
    });

    // Type badge
    info.createSpan({
      text: getTaskTypeLabel(taskType),
      cls: `tasklist-type-badge tasklist-type-${taskType}`,
    });

    if (task.content && taskType !== 'progress') {
      info.createSpan({
        text: ' — ' + task.content.substring(0, 80),
        cls: 'tasklist-block-task-content',
      });
    }

    // Status badge
    row.createSpan({
      text: getStatusLabel(task.status),
      cls:
        'tasklist-status-badge tasklist-status-' +
        task.status +
        ' tasklist-block-status-badge',
    });

    // Priority
    row.createSpan({
      text: getPriorityLabel(task.priority),
      cls: 'tasklist-block-priority-label',
    });

    // Actions
    const actions = row.createDiv({ cls: 'tasklist-block-actions' });

    // Expand/Collapse button — only for parent type tasks
    if (taskType === 'parent') {
      const expandBtn = actions.createEl('button', {
        cls: 'tasklist-btn-small tasklist-block-expand-btn',
        attr: {
          'aria-label': isExpanded ? t('tasklist.collapseTooltip') : t('tasklist.expandTooltip'),
          'data-tooltip-position': 'top',
        },
      });
      setIcon(expandBtn, isExpanded ? 'chevron-up' : 'chevron-down');
      expandBtn.addEventListener('click', (evt) => {
        evt.stopPropagation();
        void this.toggleExpand(task);
      });
    }

    // Toggle status
    const toggleBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small',
      attr: {
        'aria-label': t('block.toggleTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(toggleBtn, 'arrow-right-circle');
    toggleBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      void (async () => {
        await this.plugin.taskDatabase.cycleTaskStatus(task.id);
        await this.render();
      })();
    });

    // Edit
    const editBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small',
      attr: {
        'aria-label': t('block.editTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      this.openEditModal(task);
    });

    // Delete
    const delBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small tasklist-btn-remove-small',
      attr: {
        'aria-label': t('block.deleteTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(delBtn, 'trash-2');
    delBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      void (async () => {
        await this.plugin.taskDatabase.deleteTask(task.id);
        // Invalidate cache if the deleted task was a parent
        this.childrenCache.delete(task.id);
        await this.render();
      })();
    });

    // Unlink
    const unlinkBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small',
      attr: {
        'aria-label': t('block.unlinkTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(unlinkBtn, 'link-2-off');
    unlinkBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      void (async () => {
        await this.removeIdFromBlock(task.id);
        await this.render();
      })();
    });
  }

  // ───── Expand/Collapse ─────

  private async toggleExpand(task: Task) {
    if (this.expandedTaskId === task.id) {
      this.expandedTaskId = null;
    } else {
      // Pre-load children for parent tasks
      if ((task.taskType || 'text') === 'parent') {
        try {
          const children = await this.plugin.taskDatabase.getChildren(task.id);
          this.childrenCache.set(task.id, children);
        } catch (err) {
          console.error('TaskList: Failed to load children', err);
          new Notice(t('tasklist.loadFailed'));
          return;
        }
      }
      this.expandedTaskId = task.id;
    }
    await this.render();
  }

  // ───── Expanded Block Body ─────

  private renderBlockExpandedBody(container: HTMLElement, task: Task) {
    const wrapper = container.createDiv({ cls: 'tasklist-block-expanded-body' });
    const children = this.childrenCache.get(task.id) || [];
    const doneCount = children.filter(c => c.status === 'done').length;
    const progress = children.length > 0
      ? Math.round((doneCount / children.length) * 100)
      : 0;

    // Progress bar
    const progressWrap = wrapper.createDiv({ cls: 'tasklist-block-progress-wrap' });
    const bar = progressWrap.createDiv({ cls: 'tasklist-block-progress-bar' });
    const fill = bar.createDiv({ cls: 'tasklist-block-progress-fill' });
    const pLabel = progressWrap.createSpan({ cls: 'tasklist-block-progress-label' });

    fill.setCssProps({
      '--progress-width': progress + '%',
      '--progress-color':
        progress >= 75 ? 'var(--color-green)' :
        progress >= 40 ? 'var(--color-blue)' :
        'var(--text-error)',
    });
    pLabel.setText(doneCount + '/' + children.length);

    // Child task list
    if (children.length > 0) {
      const list = wrapper.createDiv({ cls: 'tasklist-block-child-list' });
      for (const child of children) {
        this.renderBlockChildRow(list, child, task);
      }
    } else {
      wrapper.createDiv({
        text: t('tasklist.noChildren'),
        cls: 'tasklist-block-child-empty',
      });
    }

    // Add child button
    const addRow = wrapper.createDiv({ cls: 'tasklist-block-child-add-row' });
    const addBtn = addRow.createEl('button', {
      text: '  ' + t('tasklist.addChild'),
      cls: 'tasklist-btn-small tasklist-block-add-child-btn',
    });
    setIcon(addBtn, 'plus');
    addBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      this.showBlockAddChildInline(wrapper, task);
    });
  }

  // ───── Block Child Row ─────

  private renderBlockChildRow(
    container: HTMLElement,
    child: Task,
    _parent: Task,
  ) {
    const row = container.createDiv({ cls: 'tasklist-block-child-item' });

    // Status checkbox
    const checkbox = row.createEl('input', {
      type: 'checkbox',
    });
    if (child.status === 'done') {
      checkbox.checked = true;
    }
    checkbox.addEventListener('click', (evt) => evt.stopPropagation());
    checkbox.addEventListener('change', async () => {
      child.status = checkbox.checked ? 'done' : 'pending';
      await this.plugin.taskDatabase.updateTask(child);
      if (this.expandedTaskId) {
        await this.plugin.taskDatabase.calculateParentProgress(this.expandedTaskId);
        await this.render();
      }
    });

    // Type badge
    const cType = (child.taskType || 'text') as 'text' | 'progress' | 'parent';
    row.createSpan({
      text: getTaskTypeLabel(cType),
      cls: `tasklist-type-badge tasklist-type-${cType}`,
    });

    // Title
    row.createSpan({
      text: child.title,
      cls: 'tasklist-block-child-title',
    });

    // Status badge
    row.createSpan({
      text: getStatusLabel(child.status),
      cls: 'tasklist-status-badge tasklist-status-' + child.status,
    });

    // Hover actions
    const actions = row.createDiv({ cls: 'tasklist-block-child-actions' });

    const editBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small',
      attr: { 'aria-label': t('block.editTooltip') },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      new TaskModal(this.plugin.app, this.plugin, child, async () => {
        if (this.expandedTaskId) {
          await this.plugin.taskDatabase.calculateParentProgress(this.expandedTaskId);
        }
        await this.render();
      }).open();
    });

    const delBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small tasklist-btn-remove-small',
      attr: { 'aria-label': t('common.delete') },
    });
    setIcon(delBtn, 'trash-2');
    delBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      void (async () => {
        await this.plugin.taskDatabase.deleteTask(child.id);
        if (this.expandedTaskId) {
          await this.plugin.taskDatabase.calculateParentProgress(this.expandedTaskId);
          // Remove deleted child from parent's cache so refresh shows updated list
          const cachedChildren = this.childrenCache.get(this.expandedTaskId);
          if (cachedChildren) {
            const updated = cachedChildren.filter(c => c.id !== child.id);
            this.childrenCache.set(this.expandedTaskId, updated);
          }
        }
        await this.render();
      })();
    });
  }

  // ───── Block Inline Add Child ─────

  private showBlockAddChildInline(container: HTMLElement, parent: Task) {
    // Remove existing inline form if any
    const existing = container.querySelector('.tasklist-block-child-add-inline');
    if (existing) existing.remove();

    const addRow = container.createDiv({
      cls: 'tasklist-block-child-add-row tasklist-block-child-add-inline',
    });
    const input = addRow.createEl('input', {
      type: 'text',
      cls: 'tasklist-modal-title',
      placeholder: t('modal.taskTitle.placeholder'),
    });
    input.focus();

    const confirmBtn = addRow.createEl('button', {
      text: t('common.create'),
      cls: 'mod-cta',
    });
    confirmBtn.addEventListener('click', async () => {
      const title = input.value.trim();
      if (!title) {
        new Notice(t('modal.notices.titleRequired'));
        return;
      }
      try {
        const child = await this.plugin.taskDatabase.addTask({
          title,
          content: '',
          priority: parent.priority,
          status: 'pending',
          taskType: 'text',
          progressValue: 0,
        });
        const children = this.childrenCache.get(parent.id) || [];
        await this.plugin.taskDatabase.addRelation(parent.id, child.id, children.length);
        await this.plugin.taskDatabase.calculateParentProgress(parent.id);
        // Sync cache so renderBlockExpandedBody shows the new child immediately
        children.push(child);
        this.childrenCache.set(parent.id, children);
        await this.render();
      } catch (err) {
        console.error('TaskList: Failed to create child task', err);
        new Notice(t('tasklist.notices.saveFailed'));
      }
    });

    const cancelBtn = addRow.createEl('button', {
      text: t('common.cancel'),
    });
    cancelBtn.addEventListener('click', () => addRow.remove());
  }

  // ───── Code block source: parse / write ─────

  private parseBlockSource(): { ids: string[]; lines: string[]; blockId: string | null } {
    const section = this.ctx.getSectionInfo(this.containerEl);
    let raw = section ? section.text : '';

    // Extract just the inner content between fences
    const fenceMatch = raw.match(/```tasklist\n([\s\S]*?)\n```/);
    if (fenceMatch) {
      raw = fenceMatch[1];
    }

    const allLines = raw ? raw.split('\n') : [];

    let blockId: string | null = null;
    const ids: string[] = [];
    let inIdList = false;

    for (const line of allLines) {
      const trimmed = line.trim();

      // Extract block ID from any line
      const blockIdMatch = trimmed.match(BLOCK_ID_RE);
      if (blockIdMatch) {
        blockId = blockIdMatch[1];
        continue;
      }

      // Track id-list boundaries — only extract UUIDs between them
      if (trimmed === ID_LIST_START) {
        inIdList = true;
        continue;
      }
      if (trimmed === ID_LIST_END) {
        inIdList = false;
        continue;
      }

      if (inIdList && UUID_RE.test(trimmed)) {
        ids.push(trimmed);
      }
    }

    // lines returns only the valid UUIDs (used by callers for append/remove/cleanup)
    return { ids, lines: ids.slice(), blockId };
  }

  private buildBlockContent(blockId: string, uuidLines: string): string {
    const body = uuidLines ? '\n' + uuidLines + '\n' : '\n';
    return `:block-id: ${blockId}\n${ID_LIST_START}${body}${ID_LIST_END}`;
  }

  private async writeBlock(content: string, blockId?: string): Promise<void> {
    const filePath = this.ctx.sourcePath;
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const startMarker = '```tasklist';
    const endMarker = '```';

    const effectiveBlockId = blockId || generateBlockId();
    const finalContent = this.buildBlockContent(effectiveBlockId, content);

    await this.plugin.app.vault.process(file, (full) => {
      let startIdx: number;

      if (blockId) {
        // Path A: locate by existing block ID marker
        const markerIdx = full.indexOf(`:block-id: ${blockId}`);
        if (markerIdx === -1) return full;
        const beforeMarker = full.substring(0, markerIdx);
        startIdx = beforeMarker.lastIndexOf(startMarker);
        if (startIdx === -1) return full;
      } else {
        // Path B: no existing ID — locate by matching block content fingerprint
        const section = this.ctx.getSectionInfo(this.containerEl);
        if (!section) return full;

        const innerMatch = section.text.match(/```tasklist\n([\s\S]*?)\n```/);
        if (!innerMatch) return full;
        const currentInner = innerMatch[1];

        const blockFingerprint = '```tasklist\n' + currentInner + '\n```';

        const allLines = full.split('\n');
        let sectionCharOffset = 0;
        for (let i = 0; i < section.lineStart; i++) {
          sectionCharOffset += allLines[i].length + 1;
        }
        startIdx = full.indexOf(blockFingerprint, sectionCharOffset);
        if (startIdx === -1) return full;
      }

      const afterStart = full.indexOf('\n', startIdx);
      if (afterStart === -1) return full;

      const closeIdx = full.indexOf('\n' + endMarker + '\n', afterStart);
      const closeIdxAlt = full.indexOf('\n' + endMarker, afterStart);
      const endIdx = closeIdx !== -1 ? closeIdx : closeIdxAlt;
      if (endIdx === -1) return full;

      const before = full.substring(0, afterStart + 1);
      const after = full.substring(endIdx);
      return before + finalContent + after;
    });
  }

  private async appendIdsToBlock(ids: string[]): Promise<void> {
    const { lines, blockId } = this.parseBlockSource();
    for (const id of ids) {
      lines.push(id);
    }
    await this.writeBlock(lines.join('\n'), blockId ?? undefined);
  }

  private async removeIdFromBlock(id: string): Promise<void> {
    const { lines, blockId } = this.parseBlockSource();
    const filtered = lines.filter(
      (line) => line.trim() !== id
    );
    await this.writeBlock(filtered.join('\n'), blockId ?? undefined);
  }

  // ───── Add panel ─────

  private openAddPanel() {
    const { ids } = this.parseBlockSource();
    const excludeIds = new Set(ids);

    new TaskAddPanel(
      this.plugin.app,
      this.plugin,
      excludeIds,
      async (selectedIds: string[]) => {
        await this.appendIdsToBlock(selectedIds);
      },
      async (data: TaskSubmitData) => {
        return await this.plugin.taskDatabase.addTask({
          title: data.title,
          content: data.content,
          priority: data.priority,
          status: data.status,
          taskType: data.taskType,
          progressValue: data.progressValue,
          date: data.date,
          dateEnd: data.dateEnd,
        });
      },
      async (id: string) => {
        const deleted = await this.plugin.taskDatabase.deleteTask(id);
        if (!deleted) throw new Error('Task delete failed');
        await this.removeIdFromBlock(id);
      }
    ).open();
  }

  private openEditModal(task: Task) {
    new TaskModal(
      this.plugin.app,
      this.plugin,
      task,
      () => { void this.render(); }
    ).open();
  }
}
