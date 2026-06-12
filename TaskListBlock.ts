import {
  MarkdownRenderChild,
  MarkdownPostProcessorContext,
  TFile,
  Notice,
  setIcon,
} from 'obsidian';
import type TaskListPlugin from './main';
import { Task, getStatusLabel, getPriorityLabel } from './types';
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

  // eslint-disable-next-line @typescript-eslint/no-misused-promises
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
    }
  }

  private renderRow(container: HTMLElement, task: Task) {
    const row = container.createDiv({ cls: 'tasklist-block-row' });

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
    if (task.content) {
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

    // Toggle status
    const toggleBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small',
      attr: {
        'aria-label': t('block.toggleTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(toggleBtn, 'arrow-right-circle');
    toggleBtn.addEventListener('click', async () => {
      await this.plugin.taskDatabase.cycleTaskStatus(task.id);
      await this.render();
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
    editBtn.addEventListener('click', () => this.openEditModal(task));

    // Delete (from DB + remove ref from block)
    const delBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small tasklist-btn-remove-small',
      attr: {
        'aria-label': t('block.deleteTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(delBtn, 'trash-2');
    delBtn.addEventListener('click', async () => {
      await this.plugin.taskDatabase.deleteTask(task.id);
      await this.render();
    });

    // Remove from this list only (keep in DB)
    const unlinkBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small',
      attr: {
        'aria-label': t('block.unlinkTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(unlinkBtn, 'link-2-off');
    unlinkBtn.addEventListener('click', async () => {
      await this.removeIdFromBlock(task.id);
      await this.render();
    });
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
          date: data.date,
          dateEnd: data.dateEnd,
        });
      }
    ).open();
  }

  private openEditModal(task: Task) {
    new TaskModal(
      this.plugin.app,
      this.plugin,
      task,
      () => this.render()
    ).open();
  }
}
