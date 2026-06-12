import {
  ItemView,
  WorkspaceLeaf,
  Notice,
  setIcon,
} from 'obsidian';
import type TaskListPlugin from './main';
import { Task, getStatusLabel, getPriorityLabel } from './types';
import { TaskModal } from './TaskModal';
import { t } from './i18n';

export const VIEW_TYPE_TASKLIST = 'tasklist-view';

export class TaskListView extends ItemView {
  private plugin: TaskListPlugin;
  private tasks: Task[] = [];
  private listContainerEl!: HTMLElement;

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
      this.renderTaskList(statusFilter.value);
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
      this.renderTaskList(statusFilter.value);
    });

    // Task list container
    this.listContainerEl = container.createDiv({ cls: 'tasklist-container' });

    // Load tasks
    await this.refresh();
  }

  async refresh() {
    try {
      this.tasks = await this.plugin.taskDatabase.readTasks();
      this.renderTaskList('all');
    } catch (error) {
      console.error('Failed to load tasks:', error);
      this.listContainerEl.empty();
      this.listContainerEl.createDiv({
        text: t('tasklist.loadFailed'),
        cls: 'tasklist-empty',
      });
    }
  }

  private renderTaskList(statusFilter: string) {
    this.listContainerEl.empty();

    // Apply filters
    let filteredTasks = this.tasks;
    if (statusFilter !== 'all') {
      filteredTasks = filteredTasks.filter(
        (t) => t.status === statusFilter
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

    // Priority color indicator
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

    // Card body
    const cardBody = card.createDiv({ cls: 'tasklist-card-body' });

    // Task info row (title + status badge)
    const infoRow = cardBody.createDiv({ cls: 'tasklist-card-info' });

    infoRow.createEl('strong', {
      text: task.title,
      cls: 'tasklist-card-title',
    });

    infoRow.createSpan({
      text: getStatusLabel(task.status),
      cls: 'tasklist-status-badge tasklist-status-' + task.status,
    });

    // Task content (collapsible if long)
    if (task.content) {
      cardBody.createDiv({
        text: task.content,
        cls: 'tasklist-card-content',
      });
    }

    // Card footer with metadata
    const footer = cardBody.createDiv({ cls: 'tasklist-card-footer' });

    footer.createSpan({
      text: t('tasklist.priorityLabel') + ': ' + getPriorityLabel(task.priority),
      cls: 'tasklist-card-meta',
    });

    footer.createSpan({
      text: t('tasklist.updated') + ' ' + task.updatedAt.substring(0, 10),
      cls: 'tasklist-card-meta tasklist-card-date',
    });

    // Action buttons
    const actions = card.createDiv({ cls: 'tasklist-card-actions' });

    // Status toggle button
    const statusBtn = actions.createEl('button', {
      cls: 'tasklist-btn tasklist-btn-toggle',
      attr: {
        'aria-label':
          t('block.toggleTooltip') +
          ' (' +
          getStatusLabel(task.status) +
          ')',
        'data-tooltip-position': 'top',
      },
    });
    setIcon(statusBtn, 'arrow-right-circle');
    statusBtn.addEventListener('click', () => {
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
    editBtn.addEventListener('click', () => {
      this.openEditTaskModal(task);
    });

    // Save button
    const saveBtn = actions.createEl('button', {
      cls: 'tasklist-btn tasklist-btn-save',
      attr: {
        'aria-label': t('common.save'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(saveBtn, 'save');
    saveBtn.addEventListener('click', () => {
      void (async () => {
        await this.handleSaveTask(task);
      })();
    });

    // Remove button
    const removeBtn = actions.createEl('button', {
      cls: 'tasklist-btn tasklist-btn-remove',
      attr: {
        'aria-label': t('common.delete'),
        'data-tooltip-position': 'top',
      },
    });
    setIcon(removeBtn, 'trash-2');
    removeBtn.addEventListener('click', () => {
      void (async () => {
        await this.handleDeleteTask(task);
      })();
    });
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
    const confirmed = await this.showDeleteConfirm(task);
    if (!confirmed) return;

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

      const noticeEl = notice.messageEl;

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
