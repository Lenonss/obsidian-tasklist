import { App, Modal, Notice, Setting } from 'obsidian';
import type TaskListPlugin from './main';
import { Task, TaskPriority, TaskStatus, TaskType } from './types';
import { t } from './i18n';

export interface TaskSubmitData {
  title: string;
  content: string;
  priority: TaskPriority;
  status: TaskStatus;
  taskType?: TaskType;
  progressValue?: number;
  date?: string;
  dateEnd?: string;
}

export class TaskModal extends Modal {
  private plugin: TaskListPlugin;
  private existingTask: Task | null;
  private onSubmit: () => void;
  private saveHandler: ((data: TaskSubmitData) => Promise<void>) | null;

  private titleInputEl!: HTMLInputElement;
  private contentTextWrapper!: HTMLElement;
  private contentProgressWrapper!: HTMLElement;
  private contentParentWrapper!: HTMLElement;
  private contentInputEl!: HTMLTextAreaElement;
  private parentContentTextareaEl!: HTMLTextAreaElement;
  private taskTypeSelectEl!: HTMLSelectElement;
  private progressSliderEl!: HTMLInputElement;
  private progressValueDisplay!: HTMLElement;
  private progressLabelInputEl!: HTMLInputElement;
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
            void this.handleSubmit();
          }
        });
      });

    // Task type selector (moved before content)
    new Setting(contentEl)
      .setName(t('modal.taskType.name'))
      .setDesc(t('modal.taskType.desc'))
      .addDropdown((dropdown) => {
        this.taskTypeSelectEl = dropdown.selectEl;
        dropdown
          .addOption('text', t('taskType.text'))
          .addOption('progress', t('taskType.progress'))
          .addOption('parent', t('taskType.parent'))
          .setValue(this.existingTask?.taskType || 'text');
        dropdown.onChange((value) => {
          this.renderContentByType(value as TaskType);
        });
      });

    // ─── Content area (switches based on type) ───
    const contentContainer = contentEl.createDiv({ cls: 'tasklist-modal-content-container' });

    // Text type content
    this.contentTextWrapper = contentContainer.createDiv();
    new Setting(this.contentTextWrapper)
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

    // Progress type content
    this.contentProgressWrapper = contentContainer.createDiv();

    new Setting(this.contentProgressWrapper)
      .setName('进度标签')
      .setDesc('进度条显示的标签文字（可选）')
      .addText((text) => {
        this.progressLabelInputEl = text.inputEl;
        text.setPlaceholder('输入进度标签...');
        if (this.existingTask?.taskType === 'progress') {
          text.setValue(this.existingTask.content || '');
        }
      });

    new Setting(this.contentProgressWrapper)
      .setName(t('modal.progressValue.name'))
      .setDesc(t('modal.progressValue.desc'))
      .addSlider((slider) => {
        slider.setLimits(0, 100, 5)
          .setValue(this.existingTask?.progressValue ?? 0)
          .setDynamicTooltip();
        this.progressSliderEl = slider.sliderEl;
        this.progressSliderEl.addClass('tasklist-modal-progress-slider');
      });

    this.progressValueDisplay = this.contentProgressWrapper.createSpan({
      cls: 'tasklist-card-progress-label',
      text: (this.existingTask?.progressValue ?? 0) + '%',
    });
    this.progressSliderEl.addEventListener('input', () => {
      this.progressValueDisplay.setText(this.progressSliderEl.value + '%');
    });

    // Parent type content
    this.contentParentWrapper = contentContainer.createDiv();

    new Setting(this.contentParentWrapper)
      .setName(t('modal.taskContent.name'))
      .setDesc(t('modal.taskContent.desc'))
      .addTextArea((textArea) => {
        this.parentContentTextareaEl = textArea.inputEl;
        this.parentContentTextareaEl.addClass('tasklist-modal-content');
        textArea.setPlaceholder('对父任务的补充说明（可选）');
        if (this.existingTask?.taskType === 'parent') {
          textArea.setValue(this.existingTask.content || '');
        }
      });

    this.contentParentWrapper.createDiv({
      text: t('tasklist.parentHint'),
      cls: 'setting-item-description',
    });

    // Initialize correct content UI
    this.renderContentByType(
      (this.existingTask?.taskType || 'text') as TaskType
    );

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
      void this.handleSubmit();
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

  private renderContentByType(taskType: TaskType) {
    this.contentTextWrapper.style.display = taskType === 'text' ? '' : 'none';
    this.contentProgressWrapper.style.display = taskType === 'progress' ? '' : 'none';
    this.contentParentWrapper.style.display = taskType === 'parent' ? '' : 'none';
  }

  private async handleSubmit() {
    const title = this.titleInputEl.value.trim();

    if (!title) {
      this.titleInputEl.classList.add('tasklist-input-error');
      this.titleInputEl.focus();
      new Notice(t('modal.notices.titleRequired'));
      return;
    }

    const taskType = (this.taskTypeSelectEl?.value as TaskType) || 'text';
    let content = '';
    const priority = this.prioritySelectEl.value as TaskPriority;
    let progressValue = 0;

    if (taskType === 'progress') {
      content = this.progressLabelInputEl?.value?.trim() || '';
      progressValue = parseInt(this.progressSliderEl?.value || '0', 10);
    } else if (taskType === 'parent') {
      content = this.parentContentTextareaEl?.value?.trim() || '';
    } else {
      content = this.contentInputEl?.value?.trim() || '';
    }

    try {
      const dateVal = this.dateInputEl?.value || '';
      const dateEndVal = this.dateEndInputEl?.value || '';

      if (this.saveHandler) {
        const status = this.statusSelectEl
          ? (this.statusSelectEl.value as TaskStatus)
          : this.existingTask
            ? this.existingTask.status
            : this.plugin.settings.defaultStatus;

        await this.saveHandler({
          title, content, priority, status, taskType, progressValue,
          date: dateVal || undefined,
          dateEnd: dateEndVal || undefined,
        });
      } else if (this.existingTask) {
        const status = this.statusSelectEl
          ? (this.statusSelectEl.value as TaskStatus)
          : this.existingTask.status;

        await this.plugin.taskDatabase.updateTask({
          ...this.existingTask,
          title,
          content,
          priority,
          status,
          taskType,
          progressValue,
        });

        new Notice(t('modal.notices.updated'));
      } else {
        await this.plugin.taskDatabase.addTask({
          title,
          content,
          priority,
          status: this.plugin.settings.defaultStatus,
          taskType,
          progressValue,
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
