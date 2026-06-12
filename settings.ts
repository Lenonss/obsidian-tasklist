import { App, PluginSettingTab, Setting, Modal, Notice } from 'obsidian';
import type TaskListPlugin from './main';
import { t, initI18n } from './i18n';
import { generateUUID } from './utils';
import type { ProjectConfig } from './types';

type SettingsTab = 'basic' | 'workboard' | 'ai';

export class TaskListSettingTab extends PluginSettingTab {
  plugin: TaskListPlugin;
  private activeTab: SettingsTab = 'basic';

  constructor(app: App, plugin: TaskListPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Tab navigation ──
    const tabBar = containerEl.createDiv({ cls: 'tasklist-settings-tabs' });

    const tabs: { id: SettingsTab; label: string }[] = [
      { id: 'basic', label: '基本' },
      { id: 'workboard', label: '看板' },
      { id: 'ai', label: 'AI & 项目' },
    ];

    const tabButtons: Record<string, HTMLElement> = {};
    const tabContents: Record<string, HTMLElement> = {};

    for (const tab of tabs) {
      const btn = tabBar.createEl('button', {
        text: tab.label,
        cls: 'tasklist-settings-tab',
      });
      if (tab.id === this.activeTab) {
        btn.addClass('tasklist-settings-tab-active');
      }
      tabButtons[tab.id] = btn;

      const content = containerEl.createDiv({
        cls: 'tasklist-settings-content',
      });
      if (tab.id !== this.activeTab) {
        content.addClass('tasklist-settings-tab-hidden');
      }
      tabContents[tab.id] = content;

      btn.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.display();
      });
    }

    // ── Tab: Basic ──
    this.renderBasicTab(tabContents['basic']);

    // ── Tab: Workboard ──
    this.renderWorkboardTab(tabContents['workboard']);

    // ── Tab: AI & Project ──
    this.renderAITab(tabContents['ai']);
  }

  // ═══════════════════════════════════
  // Basic Tab
  // ═══════════════════════════════════

  private renderBasicTab(el: HTMLElement): void {
    new Setting(el).setName(t('settings.title')).setHeading();

    new Setting(el)
      .setName(t('settings.language.name'))
      .setDesc(t('settings.language.desc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('zh', t('settings.language.optionZh'))
          .addOption('en', t('settings.language.optionEn'))
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as 'zh' | 'en';
            await this.plugin.saveSettings();
            initI18n(value);
            this.display();
          })
      );

    el.createEl('p', {
      text: t('settings.languageHint'),
      cls: 'setting-item-description',
    });

    new Setting(el)
      .setName(t('settings.defaultPriority.name'))
      .setDesc(t('settings.defaultPriority.desc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('high', t('priority.high'))
          .addOption('medium', t('priority.medium'))
          .addOption('low', t('priority.low'))
          .setValue(this.plugin.settings.defaultPriority)
          .onChange(async (value) => {
            this.plugin.settings.defaultPriority = value as 'high' | 'medium' | 'low';
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName(t('settings.defaultStatus.name'))
      .setDesc(t('settings.defaultStatus.desc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('pending', t('status.pending'))
          .addOption('in-progress', t('status.in-progress'))
          .addOption('done', t('status.done'))
          .setValue(this.plugin.settings.defaultStatus)
          .onChange(async (value) => {
            this.plugin.settings.defaultStatus = value as 'pending' | 'in-progress' | 'done';
            await this.plugin.saveSettings();
          })
      );
  }

  // ═══════════════════════════════════
  // Workboard Tab
  // ═══════════════════════════════════

  private renderWorkboardTab(el: HTMLElement): void {
    new Setting(el).setName(t('settings.workboardDefaults')).setHeading();

    new Setting(el)
      .setName(t('settings.defaultWorkboardYear.name'))
      .setDesc(t('settings.defaultWorkboardYear.desc'))
      .addText((text) =>
        text
          .setPlaceholder('2026')
          .setValue(String(this.plugin.settings.defaultWorkboardYear))
          .onChange(async (value) => {
            const v = parseInt(value, 10);
            if (v > 2000 && v < 2100) {
              this.plugin.settings.defaultWorkboardYear = v;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(el)
      .setName(t('settings.defaultQuarter.name'))
      .setDesc(t('settings.defaultQuarter.desc'))
      .addDropdown((dropdown) => {
        for (let q = 1; q <= 4; q++) dropdown.addOption(String(q), `Q${q}`);
        return dropdown
          .setValue(String(this.plugin.settings.defaultQuarter))
          .onChange(async (value) => {
            this.plugin.settings.defaultQuarter = parseInt(value, 10);
            await this.plugin.saveSettings();
          });
      });

    new Setting(el)
      .setName(t('settings.defaultTimeRange.name'))
      .setDesc(t('settings.defaultTimeRange.desc'))
      .addDropdown((dropdown) =>
        dropdown
          .addOption('week', t('settings.timeRange.week'))
          .addOption('month', t('settings.timeRange.month'))
          .addOption('quarter', t('settings.timeRange.quarter'))
          .addOption('year', t('settings.timeRange.year'))
          .setValue(this.plugin.settings.defaultTimeRange)
          .onChange(async (value) => {
            this.plugin.settings.defaultTimeRange = value as 'week' | 'month' | 'quarter' | 'year';
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName(t('settings.showDashboard.name'))
      .setDesc(t('settings.showDashboard.desc'))
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.defaultShowDashboard)
          .onChange(async (value) => {
            this.plugin.settings.defaultShowDashboard = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(el)
      .setName(t('settings.maxCards.name'))
      .setDesc(t('settings.maxCards.desc'))
      .addText((text) =>
        text
          .setPlaceholder('20')
          .setValue(String(this.plugin.settings.defaultMaxCards))
          .onChange(async (value) => {
            const v = parseInt(value, 10);
            if (v > 0 && v <= 100) {
              this.plugin.settings.defaultMaxCards = v;
              await this.plugin.saveSettings();
            }
          })
      );
  }

  // ═══════════════════════════════════
  // AI & Project Tab
  // ═══════════════════════════════════

  private renderAITab(el: HTMLElement): void {
    new Setting(el).setName('AI & 项目管理').setHeading();

    new Setting(el)
      .setName(t('settings.projects.dataDir.name'))
      .setDesc(t('settings.projects.dataDir.desc'))
      .addText((text) =>
        text
          .setPlaceholder(t('settings.projects.dataDir.placeholder'))
          .setValue(this.plugin.settings.dataDir || '.tasklist/databases')
          .onChange(async (value) => {
            this.plugin.settings.dataDir = value.trim() || '.tasklist/databases';
            await this.plugin.saveSettings();
          })
      );

    const projects = this.plugin.settings.projects.filter(p => p.enabled);
    if (projects.length > 0) {
      new Setting(el)
        .setName(t('settings.projects.activeProject'))
        .setDesc('当前使用的项目，也可通过打开对应目录的文件自动切换')
        .addDropdown((dropdown) => {
          for (const p of projects) dropdown.addOption(p.id, p.name);
          return dropdown
            .setValue(this.plugin.settings.activeProjectId || projects[0]?.id || '')
            .onChange(async (value) => { await this.plugin.setActiveProject(value); });
        });
    }

    this.renderProjectList(el);
    this.renderMcpSection(el);
    this.renderSkillSection(el);
  }

  // ───── MCP ─────

  private renderMcpSection(el: HTMLElement): void {
    new Setting(el).setName(t('settings.mcp.title')).setHeading();

    const mcpStatus = this.plugin.detectMcpStatus();
    el.createDiv({
      cls: 'setting-item-description tasklist-status-padding',
    }).createEl('strong', { text: t(`settings.mcp.status.${mcpStatus}`) });

    new Setting(el)
      .addButton((btn) =>
        btn.setButtonText(t('settings.mcp.install')).setCta().onClick(async () => {
          const notice = el.createDiv({ text: '⏳ 安装中...', cls: 'setting-item-description' });
          const result = await this.plugin.installMcpServer();
          notice.remove();
          new Notice(result.message);
          this.display();
        })
      )
      .addButton((btn) =>
        btn.setButtonText(t('settings.mcp.testConnection')).onClick(async () => {
          const result = await this.plugin.testMcpConnection();
          new Notice(result.message);
        })
      )
      .addButton((btn) =>
        btn.setButtonText(t('settings.mcp.reregister')).onClick(async () => {
          const result = await this.plugin.registerMcpEntries();
          new Notice(result.message);
        })
      );
  }

  // ───── Skill ─────

  private renderSkillSection(el: HTMLElement): void {
    new Setting(el).setName(t('settings.skill.title')).setHeading();

    const skillStatus = this.plugin.detectSkillStatus();
    el.createDiv({
      cls: 'setting-item-description tasklist-status-padding',
    }).createEl('strong', { text: t(`settings.skill.status.${skillStatus}`) });

    new Setting(el)
      .addButton((btn) =>
        btn.setButtonText(t('settings.skill.install')).setCta().onClick(async () => {
          const result = await this.plugin.installSkill();
          new Notice(result.message);
        })
      );
  }

  // ───── Project List & Modal ─────

  private renderProjectList(el: HTMLElement): void {
    const projects = this.plugin.settings.projects;

    const headerRow = el.createDiv({ cls: 'setting-item' });
    const hi = headerRow.createDiv({ cls: 'setting-item-info' });
    hi.createDiv({ cls: 'setting-item-name', text: t('settings.projects.title') });
    hi.createDiv({ cls: 'setting-item-description', text: '管理多个工作项目，每个项目拥有独立的数据和 Markdown 目录' });

    if (projects.length === 0) {
      el.createDiv({ text: t('settings.projects.noProjects'), cls: 'setting-item-description tasklist-empty-hint' });
    } else {
      const table = el.createEl('table', { cls: 'tasklist-project-table' });
      const thead = table.createEl('thead');
      const th = thead.createEl('tr');
      ['', t('settings.projects.name'), t('settings.projects.rootPath'), t('settings.projects.dbFileName'), ''].forEach(h => th.createEl('th', { text: h }));

      const tbody = table.createEl('tbody');
      for (const project of projects) {
        const tr = tbody.createEl('tr');
        const t0 = tr.createEl('td');
        const toggle = t0.createEl('input', { type: 'checkbox' });
        if (toggle.instanceOf(HTMLInputElement)) toggle.checked = project.enabled;
        toggle.addEventListener('change', () => {
          void (async () => {
            project.enabled = toggle.checked;
            await this.plugin.saveSettings();
            this.display();
          })();
        });
        tr.createEl('td', { text: project.name });
        tr.createEl('td', { text: project.rootPath || '—', cls: 'tasklist-project-path' });
        tr.createEl('td', { text: project.dbFileName });

        const ta = tr.createEl('td');
        ta.createEl('button', { text: t('settings.projects.edit') }).addEventListener('click', () => this.showProjectModal(project));
        const delBtn = ta.createEl('button', { text: t('settings.projects.delete'), cls: 'mod-warning' });
        delBtn.addEventListener('click', () => {
          void (async () => {
            const confirmed = await showConfirmModal(
              this.app,
              t('settings.projects.deleteConfirm').replace('{{name}}', project.name)
            );
            if (confirmed) {
              this.plugin.settings.projects = this.plugin.settings.projects.filter(p => p.id !== project.id);
              if (this.plugin.settings.activeProjectId === project.id) {
                const r = this.plugin.settings.projects.filter(p => p.enabled);
                this.plugin.settings.activeProjectId = r[0]?.id || '';
              }
              await this.plugin.saveSettings();
              this.display();
            }
          })();
        });
      }
    }

    new Setting(el)
      .addButton((btn) => btn.setButtonText(t('settings.projects.add')).setCta().onClick(() => this.showProjectModal()));
  }

  private showProjectModal(existing?: ProjectConfig): void {
    const isEdit = !!existing;
    const project: ProjectConfig = existing
      ? { ...existing }
      : { id: generateUUID(), name: '', rootPath: '', dbFileName: '', enabled: true };

    const modal = new Modal(this.app);
    modal.titleEl.setText(isEdit ? '编辑项目' : t('settings.projects.add'));
    const c = modal.contentEl;
    c.createDiv({ cls: 'setting-item-description', text: '配置项目的名称、文档目录和数据库文件' });

    new Setting(c).setName(t('settings.projects.name')).addText((text) =>
      text.setPlaceholder(t('settings.projects.namePlaceholder')).setValue(project.name).onChange((v) => {
        project.name = v.trim();
        if (!project.dbFileName && project.name) project.dbFileName = `${project.name}.db`;
      })
    );
    new Setting(c).setName(t('settings.projects.rootPath')).setDesc('Markdown 日报/周报/OKR 文件所在的根目录').addText((text) =>
      text.setPlaceholder(t('settings.projects.rootPathPlaceholder')).setValue(project.rootPath).onChange((v) => { project.rootPath = v.trim(); })
    );
    new Setting(c).setName(t('settings.projects.dbFileName')).addText((text) =>
      text.setPlaceholder(t('settings.projects.dbFileNamePlaceholder')).setValue(project.dbFileName).onChange((v) => (project.dbFileName = v.trim()))
    );
    new Setting(c)
      .addButton((btn) => btn.setButtonText('取消').onClick(() => modal.close()))
      .addButton((btn) => btn.setButtonText(isEdit ? '保存' : '创建').setCta().onClick(async () => {
        const errors = this.plugin.validateProject(project, existing?.id);
        if (errors.length > 0) { new Notice(errors[0]); return; }
        if (isEdit) {
          const idx = this.plugin.settings.projects.findIndex(p => p.id === existing?.id);
          if (idx >= 0) this.plugin.settings.projects[idx] = project;
        } else {
          this.plugin.settings.projects.push(project);
          if (!this.plugin.settings.activeProjectId) this.plugin.settings.activeProjectId = project.id;
        }
        await this.plugin.saveSettings();
        modal.close();
        this.display();
      }));

    modal.open();
  }
}

/** Show a confirm dialog using Obsidian Modal instead of browser confirm(). */
function showConfirmModal(app: App, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    modal.titleEl.setText('确认');
    const c = modal.contentEl;
    c.createDiv({ text: message, cls: 'setting-item-description' });
    const btnRow = c.createDiv({ cls: 'tasklist-modal-buttons' });
    btnRow.createEl('button', { text: '取消' }).addEventListener('click', () => {
      modal.close();
      resolve(false);
    });
    btnRow.createEl('button', { text: '删除', cls: 'mod-warning' }).addEventListener('click', () => {
      modal.close();
      resolve(true);
    });
    modal.open();
  });
}
