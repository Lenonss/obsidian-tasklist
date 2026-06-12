import { App, Modal, Notice, Setting } from 'obsidian';
import type TaskListPlugin from './main';
import { Task, TaskPriority, TaskStatus } from './types';
import { t } from './i18n';

export interface TaskSubmitData {
  title: string;
  content: string;
  priority: TaskPriority;
  status: TaskStatus;
  date?: string;
  dateEnd?: string;
}

export class TaskModal extends Modal {
  private plugin: TaskListPlugin;
  private existingTask: Task | null;
  private onSubmit: () => void;
  private saveHandler: ((data: TaskSubmitData) => Promise<void>) | null;

  private titleInputEl!: HTMLInputElement;
  private contentInputEl!: HTMLTextAreaElement;
  private prioritySelectEl!: HTMLSelectElement;
  private statusSelectEl!: HTMLSelectElement;
  private dateInputEl: HTMLInputElement | null = null;
  private dateEndInputEl: HTMLInputElement | null = null;

  constructor(
    app: App,
    plugin: TaskListPlugin,
    existingTask: Task | null,
    onSubmit: () => void,
    saveHandler?: (data: TaskSubmitData) => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.existingTask = existingTask;
    this.onSubmit = onSubmit;
    this.saveHandler = saveHandler || null;
  }

  onOpen() {
    const { contentEl } = this;
    const isEdit = this.existingTask !== null;

    contentEl.addClass('tasklist-modal');
    contentEl.createEl('h3', {
      text: isEdit ? t('modal.editTask') : t('modal.newTask'),
    });

    // Title field
    new Setting(contentEl)
      .setName(t('modal.taskTitle.name'))
      .setDesc(t('modal.taskTitle.desc'))
      .addText((text) => {
        this.titleInputEl = text.inputEl;
        this.titleInputEl.addClass('tasklist-modal-title');
        text.setPlaceholder(t('modal.taskTitle.placeholder')).onChange(() => {
          this.titleInputEl.classList.remove('tasklist-input-error');
        });

        if (this.existingTask) {
          text.setValue(this.existingTask.title);
        }

        this.titleInputEl.addEventListener('keydown', (evt) => {
          if (evt.key === 'Enter') {
            evt.preventDefault();
            this.handleSubmit();
          }
        });
      });

    // Content field
    new Setting(contentEl)
      .setName(t('modal.taskContent.name'))
      .setDesc(t('modal.taskContent.desc'))
      .addTextArea((textArea) => {
        this.contentInputEl = textArea.inputEl;
        this.contentInputEl.addClass('tasklist-modal-content');
        textArea.setPlaceholder(t('modal.taskContent.placeholder'));

        if (this.existingTask) {
          textArea.setValue(this.existingTask.content);
        }
      });

    // Priority field
    new Setting(contentEl)
      .setName(t('modal.priority.name'))
      .setDesc(t('modal.priority.desc'))
      .addDropdown((dropdown) => {
        this.prioritySelectEl = dropdown.selectEl;
        dropdown
          .addOption('high', t('priority.high'))
          .addOption('medium', t('priority.medium'))
          .addOption('low', t('priority.low'))
          .setValue(
            this.existingTask
              ? this.existingTask.priority
              : this.plugin.settings.defaultPriority
          );
      });

    // Status field (only in edit mode)
    if (isEdit) {
      new Setting(contentEl)
        .setName(t('modal.status.name'))
        .setDesc(t('modal.status.desc'))
        .addDropdown((dropdown) => {
          this.statusSelectEl = dropdown.selectEl;
          dropdown
            .addOption('pending', t('status.pending'))
            .addOption('in-progress', t('status.in-progress'))
            .addOption('done', t('status.done'))
            .setValue(this.existingTask!.status);
        });
    }

    // Date fields (only in create mode)
    if (!isEdit) {
      const todayStr = new Date().toISOString().split('T')[0];

      new Setting(contentEl)
        .setName(t('modal.startDate.name'))
        .setDesc(t('modal.startDate.desc'))
        .addText((text) => {
          this.dateInputEl = text.inputEl;
          text.inputEl.type = 'date';
          text.setValue(todayStr);
        });

      new Setting(contentEl)
        .setName(t('modal.endDate.name'))
        .setDesc(t('modal.endDate.desc'))
        .addText((text) => {
          this.dateEndInputEl = text.inputEl;
          text.inputEl.type = 'date';
          text.setPlaceholder(t('modal.endDate.placeholder'));
        });
    }

    // Submit button
    const buttonContainer = contentEl.createDiv({
      cls: 'tasklist-modal-buttons',
    });

    const submitButton = buttonContainer.createEl('button', {
      text: isEdit ? t('modal.save') : t('modal.create'),
      cls: 'mod-cta',
      attr: {
        'aria-label': isEdit ? t('modal.save') : t('modal.create'),
        'data-tooltip-position': 'top',
      },
    });

    submitButton.addEventListener('click', () => {
      this.handleSubmit();
    });

    const cancelButton = buttonContainer.createEl('button', {
      text: t('modal.cancel'),
      attr: {
        'aria-label': t('modal.cancel'),
        'data-tooltip-position': 'top',
      },
    });

    cancelButton.addEventListener('click', () => {
      this.close();
    });
  }

  private async handleSubmit() {
    const title = this.titleInputEl.value.trim();

    if (!title) {
      this.titleInputEl.classList.add('tasklist-input-error');
      this.titleInputEl.focus();
      new Notice(t('modal.notices.titleRequired'));
      return;
    }

    const content = this.contentInputEl.value.trim();
    const priority = this.prioritySelectEl.value as TaskPriority;

    try {
      const dateVal = this.dateInputEl?.value || '';
      const dateEndVal = this.dateEndInputEl?.value || '';

      if (this.saveHandler) {
        // Custom save handler (e.g., code block writes to file)
        const status = this.statusSelectEl
          ? (this.statusSelectEl.value as TaskStatus)
          : this.existingTask
            ? this.existingTask.status
            : this.plugin.settings.defaultStatus;

        await this.saveHandler({
          title, content, priority, status,
          date: dateVal || undefined,
          dateEnd: dateEndVal || undefined,
        });
      } else if (this.existingTask) {
        // Edit mode — save to global SQLite database
        const status = this.statusSelectEl
          ? (this.statusSelectEl.value as TaskStatus)
          : this.existingTask.status;

        await this.plugin.taskDatabase.updateTask({
          ...this.existingTask,
          title,
          content,
          priority,
          status,
        });

        new Notice(t('modal.notices.updated'));
      } else {
        // Add mode — save to global SQLite database
        await this.plugin.taskDatabase.addTask({
          title,
          content,
          priority,
          status: this.plugin.settings.defaultStatus,
          date: dateVal || undefined,
          dateEnd: dateEndVal || undefined,
        });

        new Notice(t('modal.notices.created'));
      }

      this.onSubmit();
      this.close();
    } catch (error) {
      console.error('Failed to save task:', error);
      new Notice(t('modal.notices.saveFailed'));
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
