import { App, Modal, Notice, setIcon } from 'obsidian';
import type TaskListPlugin from './main';
import { Task, getStatusLabel, getPriorityLabel, TaskStatus, TaskPriority } from './types';
import { TaskModal, TaskSubmitData } from './TaskModal';
import { t } from './i18n';

export class TaskAddPanel extends Modal {
  private plugin: TaskListPlugin;
  private excludeIds: Set<string>;
  private onTasksAdded: (ids: string[]) => Promise<void>;
  private onNewTaskCreated: (data: TaskSubmitData) => Promise<Task>;

  // State
  private allTasks: Task[] = [];
  private checkboxes: Map<string, HTMLInputElement> = new Map();
  private selectAllCheckbox!: HTMLInputElement;
  private counterEl!: HTMLElement;
  private listEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private statusFilter!: HTMLSelectElement;
  private priorityFilter!: HTMLSelectElement;

  constructor(
    app: App,
    plugin: TaskListPlugin,
    excludeIds: Set<string>,
    onTasksAdded: (ids: string[]) => Promise<void>,
    onNewTaskCreated: (data: TaskSubmitData) => Promise<Task>
  ) {
    super(app);
    this.plugin = plugin;
    this.excludeIds = excludeIds;
    this.onTasksAdded = onTasksAdded;
    this.onNewTaskCreated = onNewTaskCreated;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tasklist-add-panel');

    // ── Load DB tasks ──
    try {
      this.allTasks = await this.plugin.taskDatabase.readTasks();
    } catch {
      contentEl.createDiv({
        text: t('block.loadFailed'),
        cls: 'tasklist-block-error',
      });
      return;
    }

    // ── Header ──
    contentEl.createEl('h3', { text: t('addPanel.title') });

    // ── 1. Create new task ──
    const createSection = contentEl.createDiv({
      cls: 'tasklist-add-create-section',
    });

    const createBtn = createSection.createEl('button', {
      cls: 'mod-cta',
      attr: { 'aria-label': t('addPanel.createNew') },
    });
    setIcon(createBtn, 'plus');
    createBtn.createSpan({ text: ' ' + t('addPanel.createNew') });
    createBtn.addEventListener('click', () => {
      this.openCreateTaskModal();
    });

    // ── Separator ──
    contentEl.createDiv({ cls: 'tasklist-add-separator' });
    contentEl.createEl('p', {
      text: t('addPanel.pickFromDb'),
      cls: 'tasklist-add-subtitle',
    });

    // ── 2. Filter bar ──
    const filterBar = contentEl.createDiv({
      cls: 'tasklist-add-filter-bar',
    });

    this.searchInput = filterBar.createEl('input', {
      type: 'text',
      placeholder: t('common.search'),
      cls: 'tasklist-add-search',
    });
    this.searchInput.addEventListener('input', () => this.renderTaskList());

    this.statusFilter = filterBar.createEl('select', {
      cls: 'tasklist-add-filter-select',
      attr: { 'aria-label': 'Filter by status' },
    });
    this.statusFilter.createEl('option', {
      text: t('tasklist.filterStatus.all'),
      value: 'all',
    });
    this.statusFilter.createEl('option', {
      text: t('tasklist.filterStatus.pending'),
      value: 'pending',
    });
    this.statusFilter.createEl('option', {
      text: t('tasklist.filterStatus.in-progress'),
      value: 'in-progress',
    });
    this.statusFilter.createEl('option', {
      text: t('tasklist.filterStatus.done'),
      value: 'done',
    });
    this.statusFilter.addEventListener('change', () =>
      this.renderTaskList()
    );

    this.priorityFilter = filterBar.createEl('select', {
      cls: 'tasklist-add-filter-select',
      attr: { 'aria-label': 'Filter by priority' },
    });
    this.priorityFilter.createEl('option', {
      text: t('tasklist.filterPriority.all'),
      value: 'all',
    });
    this.priorityFilter.createEl('option', {
      text: t('tasklist.filterPriority.high'),
      value: 'high',
    });
    this.priorityFilter.createEl('option', {
      text: t('tasklist.filterPriority.medium'),
      value: 'medium',
    });
    this.priorityFilter.createEl('option', {
      text: t('tasklist.filterPriority.low'),
      value: 'low',
    });
    this.priorityFilter.addEventListener('change', () =>
      this.renderTaskList()
    );

    // ── 3. Select all row ──
    const selectAllRow = contentEl.createDiv({
      cls: 'tasklist-add-select-all',
    });
    this.selectAllCheckbox = selectAllRow.createEl('input', {
      type: 'checkbox',
      attr: { 'aria-label': t('common.selectAll') },
    });
    this.selectAllCheckbox.addEventListener('change', () => {
      const checked = this.selectAllCheckbox.checked;
      this.checkboxes.forEach((cb) => {
        cb.checked = checked;
      });
      this.updateCounter();
    });
    selectAllRow.createSpan({ text: ' ' + t('common.selectAll') });

    // ── 4. Task list ──
    this.listEl = contentEl.createDiv({
      cls: 'tasklist-add-list',
    });

    // ── 5. Bottom bar ──
    const bottomBar = contentEl.createDiv({
      cls: 'tasklist-add-bottom',
    });

    this.counterEl = bottomBar.createSpan({
      text: '0 ' + t('common.selected'),
      cls: 'tasklist-add-counter',
    });

    const addBtn = bottomBar.createEl('button', {
      text: t('addPanel.addSelected'),
      cls: 'mod-cta',
      attr: { 'aria-label': t('addPanel.addSelected') },
    });
    addBtn.addEventListener('click', () => this.addSelected());

    const cancelBtn = bottomBar.createEl('button', {
      text: t('common.cancel'),
      attr: { 'aria-label': t('common.cancel') },
    });
    cancelBtn.addEventListener('click', () => this.close());

    // Initial render
    this.renderTaskList();
  }

  // ───── Open nested TaskModal for new task ─────

  private openCreateTaskModal() {
    new TaskModal(
      this.app,
      this.plugin,
      null,
      () => {
        this.loadPanelTasks();
      },
      async (data: TaskSubmitData) => {
        const newTask = await this.onNewTaskCreated(data);
        this.excludeIds.add(newTask.id);
        await this.onTasksAdded([newTask.id]);
      }
    ).open();
  }

  private async loadPanelTasks() {
    try {
      this.allTasks = await this.plugin.taskDatabase.readTasks();
    } catch {
      // keep existing list
    }
    this.renderTaskList();
  }

  // ───── Render filtered task list ─────

  private renderTaskList() {
    this.listEl.empty();
    this.checkboxes.clear();

    const searchQuery = this.searchInput.value.toLowerCase().trim();
    const statusVal = this.statusFilter.value;
    const priorityVal = this.priorityFilter.value;

    // Filter tasks: exclude already-referenced, apply search + filters
    const candidates = this.allTasks.filter((t) => {
      if (this.excludeIds.has(t.id)) return false;
      if (statusVal !== 'all' && t.status !== statusVal) return false;
      if (priorityVal !== 'all' && t.priority !== priorityVal) return false;
      if (searchQuery) {
        const haystack = (t.title + ' ' + t.content).toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    });

    // Sort: priority desc, updated desc
    const priorityOrder: Record<string, number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    candidates.sort((a, b) => {
      const p =
        (priorityOrder[a.priority] ?? 99) -
        (priorityOrder[b.priority] ?? 99);
      if (p !== 0) return p;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

    if (candidates.length === 0) {
      this.listEl.createDiv({
        text: this.excludeIds.size === 0
          ? t('addPanel.emptyNone')
          : t('addPanel.emptyAllIncluded'),
        cls: 'tasklist-add-empty',
      });
      this.counterEl.textContent = '0 ' + t('common.selected');
      return;
    }

    // Render each candidate row
    for (const task of candidates) {
      const row = this.listEl.createDiv({
        cls: 'tasklist-add-row',
      });

      const checkbox = row.createEl('input', {
        type: 'checkbox',
        attr: { 'aria-label': 'Select: ' + task.title },
      });
      checkbox.addEventListener('change', () => this.updateCounter());
      this.checkboxes.set(task.id, checkbox);

      // Priority dot
      const colors: Record<string, string> = {
        high: 'var(--text-error)',
        medium: 'var(--text-warning)',
        low: 'var(--text-muted)',
      };
      row.createDiv({
        cls: 'tasklist-priority-dot',
        attr: {
          style:
            'background-color: ' +
            (colors[task.priority] || colors['medium']),
        },
      });

      row.createSpan({
        text: task.title,
        cls: 'tasklist-add-row-title',
      });

      row.createSpan({
        text: getStatusLabel(task.status),
        cls:
          'tasklist-status-badge tasklist-status-' + task.status,
      });

      row.createSpan({
        text: getPriorityLabel(task.priority),
        cls: 'tasklist-add-row-priority',
      });
    }

    this.selectAllCheckbox.checked = false;
    this.updateCounter();
  }

  // ───── Selection counter ─────

  private updateCounter() {
    let count = 0;
    this.checkboxes.forEach((cb) => {
      if (cb.checked) count++;
    });
    this.counterEl.textContent = count + ' ' + t('common.selected');
  }

  // ───── Add selected ─────

  private async addSelected() {
    const selectedIds: string[] = [];
    this.checkboxes.forEach((cb, id) => {
      if (cb.checked) selectedIds.push(id);
    });

    if (selectedIds.length === 0) {
      new Notice(t('addPanel.notices.noSelection'));
      return;
    }

    try {
      await this.onTasksAdded(selectedIds);
      this.close();
    } catch (error) {
      console.error('TaskList: Failed to add tasks:', error);
      new Notice(t('addPanel.notices.addFailed'));
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
