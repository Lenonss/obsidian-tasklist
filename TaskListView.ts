import {
  ItemView,
  WorkspaceLeaf,
  Notice,
  setIcon,
} from 'obsidian';
import type TaskListPlugin from './main';
import { Task, getStatusLabel, getPriorityLabel, getTaskTypeLabel } from './types';
import { TaskModal } from './TaskModal';
import { t } from './i18n';

export const VIEW_TYPE_TASKLIST = 'tasklist-view';

export class TaskListView extends ItemView {
  private plugin: TaskListPlugin;
  private tasks: Task[] = [];
  private listContainerEl!: HTMLElement;
  private expandedTaskId: string | null = null;
  private childrenCache: Map<string, Task[]> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: TaskListPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TASKLIST;
  }

  getDisplayText(): string {
    return t('tasklist.title');
  }

  getIcon(): string {
    return 'list-checks';
  }

  async onOpen() {
    // Auto-detect project from active file
    const detected = this.plugin.detectProjectFromActiveFile();
    if (detected && detected.id !== this.plugin.settings.activeProjectId) {
      await this.plugin.setActiveProject(detected.id);
    }

    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('tasklist-view');

    // Header bar
    const header = container.createDiv({ cls: 'tasklist-header' });

    header.createEl('h4', {
      text: t('tasklist.title'),
      cls: 'tasklist-header-title',
    });

    const headerActions = header.createDiv({ cls: 'tasklist-header-actions' });

    // Add task button
    const addButton = headerActions.createEl('button', {
      cls: 'tasklist-btn tasklist-btn-add mod-cta',
      attr: {
        'aria-label': t('tasklist.add'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(addButton, 'plus');
    addButton.createSpan({ text: ' ' + t('tasklist.add') });
    addButton.addEventListener('click', () => {
      this.openAddTaskModal();
    });

    // Refresh button
    const refreshButton = headerActions.createEl('button', {
      cls: 'tasklist-btn tasklist-btn-refresh',
      attr: {
        'aria-label': t('tasklist.refreshTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(refreshButton, 'refresh-cw');
    refreshButton.addEventListener('click', () => {
      void this.refresh();
    });

    // Filter bar
    const filterBar = container.createDiv({ cls: 'tasklist-filter-bar' });

    const statusFilter = filterBar.createEl('select', {
      cls: 'tasklist-filter-select',
      attr: { 'aria-label': 'Filter by status' },
    });
    statusFilter.createEl('option', { text: t('tasklist.filterStatus.all'), value: 'all' });
    statusFilter.createEl('option', { text: t('tasklist.filterStatus.pending'), value: 'pending' });
    statusFilter.createEl('option', {
      text: t('tasklist.filterStatus.in-progress'),
      value: 'in-progress',
    });
    statusFilter.createEl('option', { text: t('tasklist.filterStatus.done'), value: 'done' });
    statusFilter.addEventListener('change', () => {
      this.renderTaskList(statusFilter.value, priorityFilter.value);
    });

    const priorityFilter = filterBar.createEl('select', {
      cls: 'tasklist-filter-select',
      attr: { 'aria-label': 'Filter by priority' },
    });
    priorityFilter.createEl('option', {
      text: t('tasklist.filterPriority.all'),
      value: 'all',
    });
    priorityFilter.createEl('option', { text: t('tasklist.filterPriority.high'), value: 'high' });
    priorityFilter.createEl('option', { text: t('tasklist.filterPriority.medium'), value: 'medium' });
    priorityFilter.createEl('option', { text: t('tasklist.filterPriority.low'), value: 'low' });
    priorityFilter.addEventListener('change', () => {
      this.renderTaskList(statusFilter.value, priorityFilter.value);
    });

    // Task list container
    this.listContainerEl = container.createDiv({ cls: 'tasklist-container' });

    // Load tasks
    await this.refresh();
  }

  async refresh() {
    try {
      this.tasks = await this.plugin.taskDatabase.readTasks();
      this.renderTaskList('all', 'all');
    } catch (error) {
      console.error('Failed to load tasks:', error);
      this.listContainerEl.empty();
      this.listContainerEl.createDiv({
        text: t('tasklist.loadFailed'),
        cls: 'tasklist-empty',
      });
    }
  }

  private renderTaskList(statusFilter: string, priorityFilter: string = 'all') {
    this.listContainerEl.empty();

    // Apply filters
    let filteredTasks = this.tasks;
    if (statusFilter !== 'all') {
      filteredTasks = filteredTasks.filter(
        (t) => t.status === statusFilter
      );
    }
    if (priorityFilter !== 'all') {
      filteredTasks = filteredTasks.filter(
        (t) => t.priority === priorityFilter
      );
    }

    if (filteredTasks.length === 0) {
      this.listContainerEl.createDiv({
        text: t('tasklist.empty'),
        cls: 'tasklist-empty',
      });
      return;
    }

    // Sort: by priority (high > medium > low), then by updatedAt desc
    const priorityOrder: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    filteredTasks.sort((a, b) => {
      const pDiff =
        (priorityOrder[a.priority] ?? 99) -
        (priorityOrder[b.priority] ?? 99);
      if (pDiff !== 0) return pDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    for (const task of filteredTasks) {
      this.renderTaskCard(task);
    }
  }

  private renderTaskCard(task: Task) {
    const card = this.listContainerEl.createDiv({ cls: 'tasklist-card' });

    // Priority color dot
    const priorityColors: Record<string, string> = {
      high: 'var(--text-error)',
      medium: 'var(--text-warning)',
      low: 'var(--text-muted)',
    };
    const priorityDot = card.createDiv({
      cls: 'tasklist-priority-dot',
    });
    priorityDot.setCssProps({
      '--priority-color': priorityColors[task.priority] || priorityColors['medium'],
    });
    priorityDot.setAttr('aria-label', 'Priority: ' + getPriorityLabel(task.priority));

    // Card header (clickable row)
    const header = card.createDiv({ cls: 'tasklist-card-header' });

    // Title
    header.createEl('strong', {
      text: task.title,
      cls: 'tasklist-card-title',
    });

    // Type badge
    const taskType = (task.taskType || 'text') as 'text' | 'progress' | 'parent';
    header.createSpan({
      text: getTaskTypeLabel(taskType),
      cls: `tasklist-type-badge tasklist-type-${taskType}`,
    });

    // Status badge
    header.createSpan({
      text: getStatusLabel(task.status),
      cls: 'tasklist-status-badge tasklist-status-' + task.status,
    });

    // Action buttons
    const actions = card.createDiv({ cls: 'tasklist-card-actions' });

    // Status toggle
    const statusBtn = actions.createEl('button', {
      cls: 'tasklist-btn tasklist-btn-toggle',
      attr: {
        'aria-label': t('block.toggleTooltip') + ' (' + getStatusLabel(task.status) + ')',
        'data-tooltip-position': 'top',
      },
    });
    setIcon(statusBtn, 'arrow-right-circle');
    statusBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      void (async () => {
        await this.handleStatusToggle(task);
      })();
    });

    // Edit button
    const editBtn = actions.createEl('button', {
      cls: 'tasklist-btn tasklist-btn-edit',
      attr: {
        'aria-label': t('block.editTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      this.openEditTaskModal(task);
    });

    // Expand/Collapse button
    const isExpanded = task.id === this.expandedTaskId;
    const expandBtn = actions.createEl('button', {
      cls: 'tasklist-btn tasklist-btn-save',
      attr: {
        'aria-label': isExpanded ? t('tasklist.collapseTooltip') : t('tasklist.expandTooltip'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(expandBtn, isExpanded ? 'chevron-up' : 'chevron-down');

    // Delete button
    const removeBtn = actions.createEl('button', {
      cls: 'tasklist-btn tasklist-btn-remove',
      attr: {
        'aria-label': t('common.delete'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(removeBtn, 'trash-2');
    removeBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      void (async () => {
        await this.handleDeleteTask(task);
      })();
    });

    // Click card (not buttons) to expand/collapse
    card.addEventListener('click', () => {
      void this.toggleExpand(task, card);
    });

    // If expanded, render the expanded body
    if (isExpanded) {
      card.addClass('tasklist-card-expanded');
      this.renderExpandedBody(card, task);
    }
  }

  // ───── Expand/Collapse ─────

  private async toggleExpand(task: Task, _card: HTMLElement) {
    if (this.expandedTaskId === task.id) {
      this.expandedTaskId = null;
    } else {
      // Pre-load children for parent tasks
      if ((task.taskType || 'text') === 'parent') {
        const children = await this.plugin.taskDatabase.getChildren(task.id);
        this.childrenCache.set(task.id, children);
      }
      this.expandedTaskId = task.id;
    }
    // Re-render the whole list (handles accordion)
    const selects = this.listContainerEl.parentElement?.querySelectorAll('.tasklist-filter-select');
    const statusFilter = (selects?.[0] as HTMLSelectElement)?.value || 'all';
    const priorityFilter = (selects?.[1] as HTMLSelectElement)?.value || 'all';
    this.renderTaskList(statusFilter, priorityFilter);
  }

  // ───── Expanded Body ─────

  private renderExpandedBody(card: HTMLElement, task: Task) {
    const body = card.createDiv({ cls: 'tasklist-card-expanded-body' });
    const taskType = (task.taskType || 'text') as 'text' | 'progress' | 'parent';

    switch (taskType) {
      case 'text':
        this.renderTextExpanded(body, task);
        break;
      case 'progress':
        this.renderProgressExpanded(body, task);
        break;
      case 'parent':
        this.renderParentExpanded(body, task);
        break;
    }

    // Footer metadata
    const footer = body.createDiv({ cls: 'tasklist-card-footer' });
    footer.createSpan({
      text: t('tasklist.priorityLabel') + ': ' + getPriorityLabel(task.priority),
      cls: 'tasklist-card-meta',
    });
    footer.createSpan({
      text: t('tasklist.updated') + ' ' + task.updatedAt.substring(0, 10),
      cls: 'tasklist-card-meta tasklist-card-date',
    });
  }

  // ───── Text Expanded ─────

  private renderTextExpanded(container: HTMLElement, task: Task) {
    const textarea = container.createEl('textarea', {
      cls: 'tasklist-modal-content',
      attr: { rows: '4' },
    });
    textarea.value = task.content || '';

    const saveBtn = container.createEl('button', {
      text: t('common.save'),
      cls: 'mod-cta tasklist-card-inline-save',
    });
    saveBtn.addEventListener('click', async () => {
      task.content = textarea.value;
      await this.plugin.taskDatabase.updateTask(task);
      new Notice(t('tasklist.notices.saved'));
    });
  }

  // ───── Progress Expanded ─────

  private renderProgressExpanded(container: HTMLElement, task: Task) {
    // Label input (uses content field)
    const labelInput = container.createEl('input', {
      type: 'text',
      cls: 'tasklist-modal-title',
      placeholder: t('modal.taskContent.placeholder'),
    });
    labelInput.value = task.content || '';

    // Progress bar
    const progressWrap = container.createDiv({ cls: 'tasklist-card-progress-wrap' });
    const bar = progressWrap.createDiv({ cls: 'tasklist-card-progress-bar' });
    const fill = bar.createDiv({ cls: 'tasklist-card-progress-fill' });
    const label = progressWrap.createSpan({ cls: 'tasklist-card-progress-label' });

    const updateProgressDisplay = (val: number) => {
      fill.setCssProps({
        '--progress-width': val + '%',
        '--progress-color':
          val >= 75 ? 'var(--color-green)' :
          val >= 40 ? 'var(--color-blue)' :
          'var(--text-error)',
      });
      label.setText(val + '%');
    };

    const currentVal = task.progressValue ?? 0;
    updateProgressDisplay(currentVal);

    // Slider
    const sliderDiv = container.createDiv({ cls: 'tasklist-card-progress-slider' });
    const slider = sliderDiv.createEl('input', {
      type: 'range',
      attr: { min: '0', max: '100', step: '5' },
    });
    slider.value = String(currentVal);

    slider.addEventListener('input', () => {
      updateProgressDisplay(parseInt(slider.value, 10));
    });

    // Save button
    const saveBtn = container.createEl('button', {
      text: t('common.save'),
      cls: 'mod-cta tasklist-card-inline-save',
    });
    saveBtn.addEventListener('click', async () => {
      task.content = labelInput.value;
      task.progressValue = parseInt(slider.value, 10);
      await this.plugin.taskDatabase.updateTask(task);
      new Notice(t('tasklist.notices.saved'));
    });
  }

  // ───── Parent Expanded ─────

  private renderParentExpanded(container: HTMLElement, task: Task) {
    const children = this.childrenCache.get(task.id) || [];
    const doneCount = children.filter(c => c.status === 'done').length;
    const progress = children.length > 0
      ? Math.round((doneCount / children.length) * 100)
      : 0;

    // Auto-calculated progress bar
    const progressWrap = container.createDiv({ cls: 'tasklist-card-progress-wrap' });
    const bar = progressWrap.createDiv({ cls: 'tasklist-card-progress-bar' });
    const fill = bar.createDiv({ cls: 'tasklist-card-progress-fill' });
    const pLabel = progressWrap.createSpan({ cls: 'tasklist-card-progress-label' });

    fill.setCssProps({
      '--progress-width': progress + '%',
      '--progress-color':
        progress >= 75 ? 'var(--color-green)' :
        progress >= 40 ? 'var(--color-blue)' :
        'var(--text-error)',
    });
    pLabel.setText(doneCount + '/' + children.length);

    // Subtask list
    if (children.length > 0) {
      const list = container.createDiv({ cls: 'tasklist-subtask-list' });

      for (let i = 0; i < children.length; i++) {
        this.renderSubtaskRow(list, children[i], task, i);
      }
    } else {
      container.createDiv({
        text: t('tasklist.noChildren'),
        cls: 'setting-item-description',
      });
    }

    // Add child button
    const addRow = container.createDiv({ cls: 'tasklist-subtask-add-row' });
    const addBtn = addRow.createEl('button', {
      text: '+ ' + t('tasklist.addChild'),
      cls: 'tasklist-btn',
    });
    addBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      this.showAddChildInline(container, task);
    });
  }

  // ───── Subtask Row ─────

  private renderSubtaskRow(
    container: HTMLElement,
    child: Task,
    _parent: Task,
    _index: number,
  ) {
    const row = container.createDiv({ cls: 'tasklist-subtask-item' });

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
      // Update parent progress
      if (this.expandedTaskId) {
        await this.plugin.taskDatabase.calculateParentProgress(this.expandedTaskId);
        await this.refresh();
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
      cls: 'tasklist-subtask-title',
    });

    // Status badge
    row.createSpan({
      text: getStatusLabel(child.status),
      cls: 'tasklist-status-badge tasklist-status-' + child.status,
    });

    // Hover actions
    const actions = row.createDiv({ cls: 'tasklist-subtask-actions' });

    const editBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small',
      attr: { 'aria-label': t('block.editTooltip') },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      this.openEditTaskModal(child);
    });

    const delBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small tasklist-btn-remove-small',
      attr: { 'aria-label': t('common.delete') },
    });
    setIcon(delBtn, 'trash-2');
    delBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      void (async () => {
        await this.handleDeleteTask(child);
      })();
    });
  }

  // ───── Inline Add Child ─────

  private showAddChildInline(container: HTMLElement, parent: Task) {
    // Remove existing add row
    const existing = container.querySelector('.tasklist-subtask-add-inline');
    if (existing) existing.remove();

    const addRow = container.createDiv({ cls: 'tasklist-subtask-add-row tasklist-subtask-add-inline' });
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
      await this.refresh();
    });

    const cancelBtn = addRow.createEl('button', {
      text: t('common.cancel'),
    });
    cancelBtn.addEventListener('click', () => addRow.remove());
  }

  private openAddTaskModal() {
    new TaskModal(this.app, this.plugin, null, () => {
      this.refresh();
    }).open();
  }

  private openEditTaskModal(task: Task) {
    new TaskModal(this.app, this.plugin, task, () => {
      this.refresh();
    }).open();
  }

  private async handleStatusToggle(task: Task) {
    const success = await this.plugin.taskDatabase.cycleTaskStatus(task.id);
    if (success) {
      await this.refresh();
    } else {
      new Notice(t('tasklist.notices.toggleFailed'));
    }
  }

  private async handleSaveTask(task: Task) {
    const success = await this.plugin.taskDatabase.updateTask(task);
    if (success) {
      new Notice(t('tasklist.notices.saved'));
      await this.refresh();
    } else {
      new Notice(t('tasklist.notices.saveFailed'));
    }
  }

  private async handleDeleteTask(task: Task) {
    // Check for children and warn
    if ((task.taskType || 'text') === 'parent') {
      const children = await this.plugin.taskDatabase.getChildren(task.id);
      if (children.length > 0) {
        const confirmed = await this.showDeleteConfirm(task);
        if (!confirmed) return;
        // Cascade delete children
        await this.plugin.taskDatabase.deleteChildrenByParentId(task.id);
        for (const child of children) {
          await this.plugin.taskDatabase.deleteTask(child.id);
        }
      } else {
        const confirmed = await this.showDeleteConfirm(task);
        if (!confirmed) return;
      }
    } else {
      // Check if this is a child — if so, recalculate parent progress after delete
      const parent = await this.plugin.taskDatabase.getParent(task.id);
      const confirmed = await this.showDeleteConfirm(task);
      if (!confirmed) return;

      const success = await this.plugin.taskDatabase.deleteTask(task.id);
      if (success && parent) {
        await this.plugin.taskDatabase.calculateParentProgress(parent.id);
      }
      if (success) {
        new Notice(t('tasklist.notices.deleted'));
        await this.refresh();
      } else {
        new Notice(t('tasklist.notices.deleteFailed'));
      }
      return;
    }

    const success = await this.plugin.taskDatabase.deleteTask(task.id);
    if (success) {
      new Notice(t('tasklist.notices.deleted'));
      await this.refresh();
    } else {
      new Notice(t('tasklist.notices.deleteFailed'));
    }
  }

  /**
   * Show a confirmation dialog before deleting a task.
   */
  private async showDeleteConfirm(task: Task): Promise<boolean> {
    return new Promise((resolve) => {
      const message = t('tasklist.deleteConfirm') + ': ' + task.title + '?';
      const notice = new Notice(message, 0);

      const noticeEl = notice.noticeEl;

      const buttonContainer = noticeEl.createDiv({
        cls: 'tasklist-confirm-buttons',
      });

      const confirmBtn = buttonContainer.createEl('button', {
        text: t('common.delete'),
        cls: 'mod-warning',
        attr: {
          'aria-label': 'Confirm delete this task',
        },
      });
      confirmBtn.addEventListener('click', () => {
        notice.hide();
        resolve(true);
      });

      const cancelBtn = buttonContainer.createEl('button', {
        text: t('common.cancel'),
        attr: {
          'aria-label': 'Cancel delete',
        },
      });
      cancelBtn.addEventListener('click', () => {
        notice.hide();
        resolve(false);
      });
    });
  }

  async onClose() {
    this.containerEl.empty();
  }
}
