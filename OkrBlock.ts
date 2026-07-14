import {
  MarkdownRenderChild,
  MarkdownPostProcessorContext,
  TFile,
  Notice,
  setIcon,
  Modal,
  App,
} from 'obsidian';
import type TaskListPlugin from './main';
import type { KeyResult, Objective } from './types';
import { t } from './i18n';

// Block ID marker (hidden comment before JSON)
const BLOCK_ID_RE = /^\/\/blockId:([a-z0-9]+)$/;

function generateBlockId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// ───── OkrBlockConfig ─────

interface OkrBlockConfig {
  blockId: string;
  objectiveId: string; // UUID
  title: string;
  krUuids: string[];
  /** @deprecated Use krUuids instead — kept for backward-compatible parsing of old blocks */
  krIds?: string[];
}

// ───── OkrBlock ─────

export class OkrBlock extends MarkdownRenderChild {
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

  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- MarkdownRenderChild onload must be async for data loading and render flow
  async onload() {
    // Auto-detect project from the source file path
    const sourcePath = this.ctx.sourcePath;
    for (const project of this.plugin.settings.projects) {
      if (!project.enabled || !project.rootPath) continue;
      const normalizedRoot = project.rootPath.replace(/\\/g, '/');
      if (sourcePath.startsWith(normalizedRoot + '/') || sourcePath === normalizedRoot) {
        if (project.id !== this.plugin.settings.activeProjectId) {
          await this.plugin.setActiveProject(project.id);
        }
        break;
      }
    }
    await this.render();
  }

  // ───── Render ─────

  async render() {
    const el = this.containerEl;
    el.empty();
    el.addClass('tasklist-okr-block');

    const config = await this.parseBlockSource();

    if (!config.objectiveId) {
      const emptyEl = el.createDiv({
        cls: 'tasklist-block-empty',
      });
      emptyEl.createEl('p', {
        text: t('okr.noObjective'),
      });

      const emptyActions = emptyEl.createDiv({
        cls: 'tasklist-okr-empty-actions',
      });

      const selectBtn = emptyActions.createEl('button', {
        cls: 'mod-cta',
      });
      setIcon(selectBtn, 'search');
      selectBtn.createSpan({ text: ' ' + t('okr.selectObjective') });
      selectBtn.addEventListener('click', () =>
        this.openObjectivePicker(config)
      );

      const createBtn = emptyActions.createEl('button', {
        cls: 'mod-cta',
      });
      setIcon(createBtn, 'plus');
      createBtn.createSpan({ text: ' ' + t('okr.createObjective') });
      createBtn.addEventListener('click', () =>
        this.openNewObjectiveModal(config)
      );

      return;
    }

    // Read objective by UUID
    let objective: Objective | null = null;
    try {
      objective =
        await this.plugin.taskDatabase.readObjectiveByUuid(
          config.objectiveId
        );
    } catch (err) {
      console.error('OkrBlock: DB read failed', err);
      el.createDiv({
        text: t('okr.loadFailed'),
        cls: 'tasklist-block-error',
      });
      return;
    }

    if (!objective) {
      el.createDiv({
        text: `${t('okr.objectiveNotFound')}: ${config.objectiveId}`,
        cls: 'tasklist-block-error',
      });
      return;
    }

    // Read KRs by UUIDs
    let krs: KeyResult[] = [];
    try {
      if (config.krUuids.length > 0) {
        krs =
          await this.plugin.taskDatabase.readKeyResultsByUuids(
            config.krUuids
          );
      }
    } catch (err) {
      console.error('OkrBlock: KR read failed', err);
    }

    // ── Header bar ──
    const header = el.createDiv({ cls: 'tasklist-block-header' });

    header.createSpan({
      text: config.title || objective.title || objective.text,
      cls: 'tasklist-block-title',
    });

    const headerActions = header.createDiv({
      cls: 'tasklist-block-header-actions',
    });

    // Quarter badge (top-right)
    if (objective.year && objective.quarter) {
      headerActions.createSpan({
        text: `${objective.year} Q${objective.quarter}`,
        cls: 'tasklist-okr-badge tasklist-okr-badge-quarter',
      });
    }

    // Config button (O-level)
    const configBtn = headerActions.createEl('button', {
      cls: 'tasklist-btn-small',
      attr: { 'aria-label': t('okr.configureObjective') },
    });
    setIcon(configBtn, 'settings');
    configBtn.addEventListener('click', () => {
      this.openOConfigModal(objective, config);
    });

    // Add KR button
    const addBtn = headerActions.createEl('button', {
      cls: 'tasklist-block-add-btn mod-cta',
      attr: { 'aria-label': t('okr.addKRTooltip') },
    });
    setIcon(addBtn, 'plus');
    addBtn.createSpan({ text: ' ' + t('okr.addKR') });
    addBtn.addEventListener('click', () => {
      this.openAddPanel(objective, config);
    });

    // ── O summary row ──
    const summaryRow = el.createDiv({
      cls: 'tasklist-okr-summary',
    });

    // Progress
    const pct = objective.progress || 0;
    const pColor =
      pct >= 80
        ? 'var(--color-green)'
        : pct >= 50
          ? 'var(--color-orange)'
          : 'var(--text-error)';
    const progressWrap = summaryRow.createDiv({
      cls: 'tasklist-okr-progress-wrap tasklist-okr-progress-o',
    });
    progressWrap.createSpan({
      text: t('okr.progress') + ' ',
      cls: 'tasklist-okr-progress-label-text',
    });
    const bar = progressWrap.createDiv({
      cls: 'tasklist-okr-progress-bar',
    });
    const fill = bar.createDiv({
      cls: 'tasklist-okr-progress-fill',
    });
    fill.setCssProps({
      '--progress-width': `${pct}%`,
      '--progress-color': pColor,
    });
    progressWrap.createSpan({
      text: `${pct}%`,
      cls: 'tasklist-okr-progress-label',
    });

    summaryRow.createSpan({
      text: `${t('okr.score')}: ${objective.score ?? 0}`,
      cls: 'tasklist-okr-badge tasklist-okr-badge-score',
    });

    summaryRow.createSpan({
      text: `${t('okr.weight')}: ${objective.weight ?? 0}%`,
      cls: 'tasklist-okr-badge tasklist-okr-badge-weight',
    });

    // ── Empty state ──
    if (krs.length === 0) {
      el.createDiv({
        text: t('okr.noKRs'),
        cls: 'tasklist-block-empty',
      });
      return;
    }

    // ── KR Cards ──
    const list = el.createDiv({ cls: 'tasklist-okr-list' });
    for (const kr of krs) {
      this.renderKRCard(list, kr);
    }
  }

  private renderKRCard(container: HTMLElement, kr: KeyResult) {
    const card = container.createDiv({ cls: 'tasklist-okr-card' });

    // Title row (title + inline actions)
    const titleRow = card.createDiv({
      cls: 'tasklist-okr-card-title-row',
    });
    titleRow.createSpan({
      text: kr.title || kr.text,
      cls: 'tasklist-okr-card-title',
    });

    // Actions (inline in title row)
    const actions = titleRow.createDiv({
      cls: 'tasklist-block-actions',
    });

    const updateBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small',
      attr: { 'aria-label': t('okr.updateKR') },
    });
    setIcon(updateBtn, 'edit');
    updateBtn.addEventListener('click', () =>
      this.openKRConfigModal(kr, () => this.render())
    );

    const removeBtn = actions.createEl('button', {
      cls: 'tasklist-btn-small tasklist-btn-remove-small',
      attr: { 'aria-label': t('okr.removeFromList') },
    });
    setIcon(removeBtn, 'link-2-off');
    removeBtn.addEventListener('click', () => {
      void (async () => {
        const config = await this.parseBlockSource();
        config.krUuids = config.krUuids.filter(
        (id) => id !== kr.uuid
      );
      await this.writeBlock(config);
      await this.render();
      })();
    });

    // Progress bar
    const pct = kr.progress || 0;
    const pColor =
      pct >= 80
        ? 'var(--color-green)'
        : pct >= 50
          ? 'var(--color-orange)'
          : 'var(--text-error)';
    const progressWrap = card.createDiv({
      cls: 'tasklist-okr-progress-wrap',
    });
    const bar = progressWrap.createDiv({
      cls: 'tasklist-okr-progress-bar',
    });
    const fill = bar.createDiv({
      cls: 'tasklist-okr-progress-fill',
    });
    fill.setCssProps({
      '--progress-width': `${pct}%`,
      '--progress-color': pColor,
    });
    progressWrap.createSpan({
      text: `${pct}%`,
      cls: 'tasklist-okr-progress-label',
    });

    // Badges row (score + weight)
    const badgeRow = card.createDiv({
      cls: 'tasklist-okr-badge-row',
    });
    badgeRow.createSpan({
      text: `${t('okr.score')}: ${kr.score ?? 0}`,
      cls: 'tasklist-okr-badge tasklist-okr-badge-score',
    });
    badgeRow.createSpan({
      text: `${t('okr.weight')}: ${kr.weight ?? 0}%`,
      cls: 'tasklist-okr-badge tasklist-okr-badge-weight',
    });

    // Today update
    if (kr.today) {
      card.createDiv({
        text: kr.today,
        cls: 'tasklist-okr-today',
      });
    }
  }

  // ───── Code block parsing ─────

  private async parseBlockSource(): Promise<OkrBlockConfig> {
    const section = this.ctx.getSectionInfo(this.containerEl);

    const defaultConfig: OkrBlockConfig = {
      blockId: generateBlockId(),
      objectiveId: '',
      title: '',
      krUuids: [],
    };

    if (!section) return defaultConfig;

    // Read file content and extract ONLY lines [lineStart, lineEnd]
    // for this specific code block. This avoids the multi-block-in-section
    // ambiguity that occurs when two ```okr blocks share the same Markdown section.
    let raw = '';
    const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
    if (file instanceof TFile) {
      try {
        const content = await this.plugin.app.vault.read(file);
        const allLines = content.split('\n');
        const myLines = allLines.slice(section.lineStart, section.lineEnd + 1);
        raw = myLines.join('\n');
      } catch {
        // Fallback to section text on read error
        raw = section.text;
      }
    } else {
      raw = section.text;
    }

    return this.parseContent(raw, defaultConfig);
  }

  private parseContent(raw: string, defaultConfig: OkrBlockConfig): OkrBlockConfig {
    const fenceMatch = raw.match(/```okr\n([\s\S]*?)\n```/);
    const blockContent = fenceMatch ? fenceMatch[1] : '';

    const lines = blockContent ? blockContent.split('\n') : [];
    let blockId = generateBlockId();
    let jsonStr = '';
    let inJson = false;

    for (const line of lines) {
      const trimmed = line.trim();
      const bidMatch = trimmed.match(BLOCK_ID_RE);
      if (bidMatch) {
        blockId = bidMatch[1];
        continue;
      }
      if (trimmed.startsWith('{') || inJson) {
        inJson = true;
        jsonStr += trimmed;
        if (trimmed.includes('}')) break;
      }
    }

    const config: OkrBlockConfig = {
      blockId,
      objectiveId: '',
      title: '',
      krUuids: [],
    };

    try {
      const parsed = JSON.parse(jsonStr) as Partial<OkrBlockConfig>;
      if (parsed.objectiveId) config.objectiveId = parsed.objectiveId;
      if (parsed.title) config.title = parsed.title;
      if (Array.isArray(parsed.krUuids)) config.krUuids = parsed.krUuids;
      else if (Array.isArray(parsed.krIds)) config.krUuids = parsed.krIds as string[];
    } catch {
      // Keep defaults on parse error
    }

    return config;
  }

  private buildBlockContent(config: OkrBlockConfig): string {
    const json = JSON.stringify(
      {
      objectiveId: config.objectiveId,
      title: config.title || undefined,
      krUuids: config.krUuids,
      },
      null,
      2
    );
    return `//blockId:${config.blockId}\n${json}`;
  }

  private async writeBlock(config: OkrBlockConfig): Promise<void> {
    const filePath = this.ctx.sourcePath;
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const startMarker = '```okr';
    const endMarker = '```';
    const finalContent = this.buildBlockContent(config);

    await this.plugin.app.vault.process(file, (full) => {
      const bidIdx = full.indexOf(`//blockId:${config.blockId}`);
      if (bidIdx !== -1) {
        const beforeMarker = full.substring(0, bidIdx);
        const startIdx = beforeMarker.lastIndexOf(startMarker);
        if (startIdx === -1) return full;
        const afterStart = full.indexOf('\n', startIdx);
        if (afterStart === -1) return full;
        const endIdx = full.indexOf('\n' + endMarker, afterStart);
        const endIdx0 = full.indexOf('\n' + endMarker + '\n', afterStart);
        const closeIdx = endIdx !== -1 ? endIdx : endIdx0;
        if (closeIdx === -1) return full;
        return (
          full.substring(0, afterStart + 1) +
          finalContent +
          full.substring(closeIdx)
        );
      }

      const section = this.ctx.getSectionInfo(this.containerEl);
      if (!section) return full;
      const innerMatch = section.text.match(
        /```okr\n([\s\S]*?)\n```/
      );
      if (!innerMatch) return full;
      const currentInner = innerMatch[1];
      const fingerprint = '```okr\n' + currentInner + '\n```';
      const allLines = full.split('\n');
      let charOffset = 0;
      for (let i = 0; i < section.lineStart; i++) {
        charOffset += allLines[i].length + 1;
      }
      const fpIdx = full.indexOf(fingerprint, charOffset);
      if (fpIdx === -1) return full;
      const afterStart = full.indexOf('\n', fpIdx);
      if (afterStart === -1) return full;
      const endIdx = full.indexOf('\n' + endMarker, afterStart);
      const endIdx0 = full.indexOf('\n' + endMarker + '\n', afterStart);
      const closeIdx = endIdx !== -1 ? endIdx : endIdx0;
      if (closeIdx === -1) return full;
      return (
        full.substring(0, afterStart + 1) +
        finalContent +
        full.substring(closeIdx)
      );
    });
  }

  // ───── Open panels/modals ─────

  private openAddPanel(objective: Objective, config: OkrBlockConfig) {
    new OkrAddPanel(
      this.plugin.app,
      this.plugin,
      objective,
      async (krUuids: string[]) => {
        config.krUuids.push(
          ...krUuids.filter((id) => !config.krUuids.includes(id))
        );
        await this.writeBlock(config);
        await this.render();
      }
    ).open();
  }

  private openOConfigModal(
    objective: Objective,
    config: OkrBlockConfig
  ) {
    new OkrOConfigModal(
      this.plugin.app,
      this.plugin,
      objective,
      config,
      async () => {
        await this.writeBlock(config);
        await this.render();
      }
    ).open();
  }

  private openKRConfigModal(
    kr: KeyResult,
    onSaved: () => Promise<void>
  ) {
    new OkrKRConfigModal(
      this.plugin.app,
      this.plugin,
      kr,
      onSaved
    ).open();
  }

  private openObjectivePicker(config: OkrBlockConfig) {
    new ObjectivePickerModal(
      this.plugin.app,
      this.plugin,
      async (uuid: string, title: string) => {
        config.objectiveId = uuid;
        if (title) config.title = title;
        await this.writeBlock(config);
        await this.render();
      }
    ).open();
  }

  private openNewObjectiveModal(config: OkrBlockConfig) {
    new ObjectiveCreateModal(
      this.plugin.app,
      this.plugin,
      async (uuid: string, title: string) => {
        config.objectiveId = uuid;
        if (title) config.title = title;
        await this.writeBlock(config);
        await this.render();
      }
    ).open();
  }
}

// ───── OkrAddPanel ─────

class OkrAddPanel extends Modal {
  private plugin: TaskListPlugin;
  private objective: Objective;
  private onAdd: (krUuids: string[]) => Promise<void>;
  private checkboxes: Map<string, HTMLInputElement> = new Map();
  private counterEl!: HTMLElement;
  private allKRs: KeyResult[] = [];

  constructor(
    app: App,
    plugin: TaskListPlugin,
    objective: Objective,
    onAdd: (krUuids: string[]) => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.objective = objective;
    this.onAdd = onAdd;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tasklist-add-panel');
    contentEl.createEl('h3', { text: t('okr.addKeyResultsTitle') });

    // ── 1. Create new KR button ──
    const createSection = contentEl.createDiv({
      cls: 'tasklist-add-create-section',
    });
    const createBtn = createSection.createEl('button', {
      cls: 'mod-cta',
    });
    setIcon(createBtn, 'plus');
    createBtn.createSpan({ text: ' ' + t('okr.createNewKR') });
    createBtn.addEventListener('click', () =>
      this.openCreateKrModal()
    );

    // ── Separator ──
    contentEl.createDiv({ cls: 'tasklist-add-separator' });
    contentEl.createEl('p', {
      text: t('okr.pickFromDb'),
      cls: 'tasklist-add-subtitle',
    });

    // ── 2. Load existing KRs (only from this objective) ──
    await this.loadKRs();

    if (this.allKRs.length === 0) {
      contentEl.createDiv({
        text: t('okr.noKRsFound'),
        cls: 'tasklist-add-empty',
      });
      const bottomBar = contentEl.createDiv({
        cls: 'tasklist-add-bottom',
      });
      this.counterEl = bottomBar.createSpan({
        text: '0 ' + t('common.selected'),
        cls: 'tasklist-add-counter',
      });
      const cancelBtn = bottomBar.createEl('button', {
        text: t('common.cancel'),
      });
      cancelBtn.addEventListener('click', () => this.close());
      return;
    }

    // ── 3. KR checklist ──
    const listEl = contentEl.createDiv({
      cls: 'tasklist-add-list',
    });

    for (const kr of this.allKRs) {
      const row = listEl.createDiv({ cls: 'tasklist-add-row' });

      const checkbox = row.createEl('input', {
        type: 'checkbox',
        attr: { 'aria-label': `Select ${kr.id}` },
      });
      checkbox.addEventListener('change', () =>
        this.updateCounter()
      );
      this.checkboxes.set(kr.uuid, checkbox);

      row.createSpan({
        text: kr.title || kr.text,
        cls: 'tasklist-add-row-title',
      });

      row.createSpan({
        text: `${kr.progress || 0}%`,
        cls: 'tasklist-add-row-priority',
      });
    }

    // ── 4. Bottom bar ──
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
    });
    addBtn.addEventListener('click', () => {
      void (async () => {
        const selected: string[] = [];
        this.checkboxes.forEach((cb, uuid) => {
          if (cb.checked) selected.push(uuid);
        });
        if (selected.length === 0) {
          new Notice(t('okr.notices.noKRsSelected'));
          return;
        }
        await this.onAdd(selected);
        this.close();
      })();
    });

    const cancelBtn = bottomBar.createEl('button', {
      text: t('common.cancel'),
    });
    cancelBtn.addEventListener('click', () => this.close());
  }

  private async loadKRs(): Promise<void> {
    this.allKRs =
      await this.plugin.taskDatabase.readKeyResults(
        this.objective.id
      );
  }

  private openCreateKrModal() {
    new OkrCreateModal(
      this.plugin.app,
      this.plugin,
      this.objective,
      async (krUuid: string) => {
        await this.onAdd([krUuid]);
        this.close();
      }
    ).open();
  }

  private updateCounter() {
    let count = 0;
    this.checkboxes.forEach((cb) => {
      if (cb.checked) count++;
    });
    this.counterEl.textContent = `${count} ` + t('common.selected');
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ───── OkrOConfigModal ─────

class OkrOConfigModal extends Modal {
  private plugin: TaskListPlugin;
  private objective: Objective;
  private config: OkrBlockConfig;
  private onSaved: () => Promise<void>;

  constructor(
    app: App,
    plugin: TaskListPlugin,
    objective: Objective,
    config: OkrBlockConfig,
    onSaved: () => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.objective = objective;
    this.config = config;
    this.onSaved = onSaved;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('tasklist-modal');
    contentEl.createEl('h3', {
      text: `${t('okr.configureTitle')}: ${this.objective.id}`,
    });

    // Title
    const titleGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    titleGroup.createEl('label', { text: t('okr.title') });
    const titleInput = titleGroup.createEl('input', {
      type: 'text',
      value: this.config.title || this.objective.title || '',
      cls: 'tasklist-modal-title',
    });

    // Progress
    const progressGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    progressGroup.createEl('label', { text: t('okr.progressPercent') });
    const progressInput = progressGroup.createEl('input', {
      type: 'number',
      attr: { min: '0', max: '100' },
      value: String(this.objective.progress || 0),
      cls: 'tasklist-modal-title tasklist-input-sm',
    });

    // Score
    const scoreGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    scoreGroup.createEl('label', { text: t('okr.score') });
    const scoreInput = scoreGroup.createEl('input', {
      type: 'number',
      attr: { min: '0', max: '100', step: '0.1' },
      value: String(this.objective.score || 0),
      cls: 'tasklist-modal-title tasklist-input-sm',
    });

    // Weight
    const weightGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    weightGroup.createEl('label', { text: t('okr.weightPercent') });
    const weightInput = weightGroup.createEl('input', {
      type: 'number',
      attr: { min: '0', max: '100', step: '0.1' },
      value: String(this.objective.weight || 0),
      cls: 'tasklist-modal-title tasklist-input-sm',
    });

    // Buttons
    const btnContainer = contentEl.createDiv({
      cls: 'tasklist-modal-buttons',
    });

    const saveBtn = btnContainer.createEl('button', {
      text: t('common.save'),
      cls: 'mod-cta',
    });
    saveBtn.addEventListener('click', () => {
      void (async () => {
        const newTitle = titleInput.value.trim();
        const progress = Math.max(
          0,
          Math.min(100, parseInt(progressInput.value, 10) || 0)
        );
        const score = parseFloat(scoreInput.value) || 0;
        const weight = parseFloat(weightInput.value) || 0;
  
        await this.plugin.taskDatabase.updateObjectiveConfig(
          this.objective.uuid,
          { title: newTitle, progress, score, weight }
        );
  
        this.config.title = newTitle;
  
        await this.onSaved();
        this.close();
      })();
    });

    const cancelBtn = btnContainer.createEl('button', {
      text: t('common.cancel'),
    });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ───── OkrKRConfigModal ─────

class OkrKRConfigModal extends Modal {
  private plugin: TaskListPlugin;
  private kr: KeyResult;
  private onSaved: () => Promise<void>;

  constructor(
    app: App,
    plugin: TaskListPlugin,
    kr: KeyResult,
    onSaved: () => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.kr = kr;
    this.onSaved = onSaved;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('tasklist-modal');
    contentEl.createEl('h3', {
      text: `${t('okr.updateTitle')}: ${this.kr.id}`,
    });

    // Title
    const titleGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    titleGroup.createEl('label', { text: t('okr.title') });
    const titleInput = titleGroup.createEl('input', {
      type: 'text',
      value: this.kr.title || this.kr.text,
      cls: 'tasklist-modal-title',
    });

    // Progress
    const progressGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    progressGroup.createEl('label', { text: t('okr.progressPercent') });
    const progressInput = progressGroup.createEl('input', {
      type: 'number',
      attr: { min: '0', max: '100' },
      value: String(this.kr.progress || 0),
      cls: 'tasklist-modal-title tasklist-input-sm',
    });

    // Score
    const scoreGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    scoreGroup.createEl('label', { text: t('okr.score') });
    const scoreInput = scoreGroup.createEl('input', {
      type: 'number',
      attr: { min: '0', max: '100', step: '0.1' },
      value: String(this.kr.score || 0),
      cls: 'tasklist-modal-title tasklist-input-sm',
    });

    // Weight
    const weightGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    weightGroup.createEl('label', { text: t('okr.weightPercent') });
    const weightInput = weightGroup.createEl('input', {
      type: 'number',
      attr: { min: '0', max: '100', step: '0.1' },
      value: String(this.kr.weight || 0),
      cls: 'tasklist-modal-title tasklist-input-sm',
    });

    // Today update
    const todayGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    todayGroup.createEl('label', { text: t('okr.todaysUpdate') });
    const todayInput = todayGroup.createEl('textarea', {
      cls: 'tasklist-textarea-update',
      attr: {
        placeholder: t('okr.todaysUpdatePlaceholder'),
        value: this.kr.today || '',
      },
    });

    // Buttons
    const btnContainer = contentEl.createDiv({
      cls: 'tasklist-modal-buttons',
    });

    const saveBtn = btnContainer.createEl('button', {
      text: t('common.save'),
      cls: 'mod-cta',
    });
    saveBtn.addEventListener('click', () => {
      void (async () => {
        const title = titleInput.value.trim();
        const progress = Math.max(
          0,
          Math.min(100, parseInt(progressInput.value, 10) || 0)
        );
        const score = parseFloat(scoreInput.value) || 0;
        const weight = parseFloat(weightInput.value) || 0;
        const today = todayInput.value.trim();
  
        await this.plugin.taskDatabase.updateKRConfig(
          this.kr.uuid,
          { title, progress, score, weight, today }
        );
  
        await this.onSaved();
        this.close();
      })();
    });

    const cancelBtn = btnContainer.createEl('button', {
      text: t('common.cancel'),
    });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ───── OkrCreateModal ─────

class OkrCreateModal extends Modal {
  private plugin: TaskListPlugin;
  private objective: Objective;
  private onSave: (krUuid: string) => Promise<void>;

  private krIdDisplay!: HTMLElement;
  private krIdValue: string = '';
  private krTitleInput!: HTMLInputElement;
  private krTextInput!: HTMLInputElement;
  private krTargetInput!: HTMLInputElement;
  private krOwnerInput!: HTMLInputElement;
  private krScoreInput!: HTMLInputElement;
  private krWeightInput!: HTMLInputElement;

  constructor(
    app: App,
    plugin: TaskListPlugin,
    objective: Objective,
    onSave: (krUuid: string) => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.objective = objective;
    this.onSave = onSave;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tasklist-modal');
    contentEl.createEl('h3', { text: t('okr.createKRTtile') });

    contentEl.createEl('p', {
      text: `${t('okr.objectiveLabel')}: ${this.objective.id} (${this.objective.title || this.objective.text})`,
      cls: 'tasklist-add-subtitle',
    });

    // Auto-generate KR ID
    this.krIdValue = await this.generateKrId();

    // KR ID (auto-generated, read-only)
    const krIdGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    krIdGroup.createEl('label', { text: t('okr.krId') });
    this.krIdDisplay = krIdGroup.createEl('span', {
      text: this.krIdValue,
      cls: 'tasklist-okr-auto-id',
    });

    // KR Title
    const krTitleGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    krTitleGroup.createEl('label', { text: t('okr.krTitle') });
    this.krTitleInput = krTitleGroup.createEl('input', {
      type: 'text',
      placeholder: 'Custom display title...',
      cls: 'tasklist-modal-title',
    });

    // KR Text
    const krTextGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    krTextGroup.createEl('label', { text: t('okr.krText') });
    this.krTextInput = krTextGroup.createEl('input', {
      type: 'text',
      placeholder: 'Describe the key result...',
      cls: 'tasklist-modal-title',
    });

    // Extra row: target + owner
    const extraRow = contentEl.createDiv({
      cls: 'tasklist-modal-row',
    });

    const targetGroup = extraRow.createDiv({
      cls: 'tasklist-modal-setting tasklist-setting-flex',
    });
    targetGroup.createEl('label', { text: t('okr.target') });
    this.krTargetInput = targetGroup.createEl('input', {
      type: 'text',
      placeholder: 'e.g. 100%',
      cls: 'tasklist-modal-title',
    });

    const ownerGroup = extraRow.createDiv({
      cls: 'tasklist-modal-setting tasklist-setting-flex',
    });
    ownerGroup.createEl('label', { text: t('okr.owner') });
    this.krOwnerInput = ownerGroup.createEl('input', {
      type: 'text',
      placeholder: 'e.g. @username',
      cls: 'tasklist-modal-title',
    });

    // Extra row: score + weight
    const scoreWeightRow = contentEl.createDiv({
      cls: 'tasklist-modal-row',
    });

    const scoreGroup = scoreWeightRow.createDiv({
      cls: 'tasklist-modal-setting tasklist-setting-flex',
    });
    scoreGroup.createEl('label', { text: t('okr.score') });
    this.krScoreInput = scoreGroup.createEl('input', {
      type: 'number',
      attr: { min: '0', max: '100', step: '0.1' },
      value: '0',
      cls: 'tasklist-modal-title',
    });

    const weightGroup = scoreWeightRow.createDiv({
      cls: 'tasklist-modal-setting tasklist-setting-flex',
    });
    weightGroup.createEl('label', { text: t('okr.weightPercent') });
    this.krWeightInput = weightGroup.createEl('input', {
      type: 'number',
      attr: { min: '0', max: '100', step: '0.1' },
      value: '0',
      cls: 'tasklist-modal-title',
    });

    // Buttons
    const btnContainer = contentEl.createDiv({
      cls: 'tasklist-modal-buttons',
    });

    const saveBtn = btnContainer.createEl('button', {
      text: t('common.save'),
      cls: 'mod-cta',
    });
    saveBtn.addEventListener('click', () => {
      void (async () => {
        await this.handleSave();
      })();
    });

    const cancelBtn = btnContainer.createEl('button', {
      text: t('common.cancel'),
    });
    cancelBtn.addEventListener('click', () => this.close());
  }

  private async handleSave() {
    const krId = this.krIdValue;
    const krText = this.krTextInput.value.trim();

    if (!krText) {
      new Notice(t('okr.notices.krTextRequired'));
      return;
    }

    const title = this.krTitleInput.value.trim();
    const target = this.krTargetInput.value.trim();
    const owner = this.krOwnerInput.value.trim();
    const score = parseFloat(this.krScoreInput.value) || 0;
    const weight = parseFloat(this.krWeightInput.value) || 0;

    await this.plugin.taskDatabase.upsertKeyResult({
      id: krId,
      objectiveId: this.objective.id,
      text: krText,
      title: title || undefined,
      target,
      owner,
      score,
      weight,
    });

    // Read back to get the UUID
    const krs = await this.plugin.taskDatabase.readKeyResults(
      this.objective.id
    );
    const created = krs.find((k) => k.id === krId);
    const krUuid = created?.uuid || '';

    await this.onSave(krUuid);
    this.close();
  }

  /**
   * Auto-generate next KR ID for the current objective.
   * Format: KR<n>.<m> where n = objective number, m = next KR sequence.
   */
  private async generateKrId(): Promise<string> {
    // Parse objective number from objective.id (e.g., "O2" → 2)
    const objNumMatch = this.objective.id.match(/O(\d+)/i);
    const objNum = objNumMatch ? parseInt(objNumMatch[1], 10) : 1;

    // Get existing KRs for this objective
    const existingKRs =
      await this.plugin.taskDatabase.readKeyResults(
        this.objective.id
      );

    // Find max KR sequence number for this objective
    let maxSeq = 0;
    const krPattern = new RegExp(`^KR${objNum}\\.(\\d+)$`, 'i');
    for (const kr of existingKRs) {
      const match = kr.id.match(krPattern);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }

    return `KR${objNum}.${maxSeq + 1}`;
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ───── ObjectivePickerModal ─────

class ObjectivePickerModal extends Modal {
  private plugin: TaskListPlugin;
  private onSelect: (uuid: string, title: string) => Promise<void>;
  private objectives: Objective[] = [];

  constructor(
    app: App,
    plugin: TaskListPlugin,
    onSelect: (uuid: string, title: string) => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.onSelect = onSelect;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tasklist-modal');
    contentEl.createEl('h3', { text: t('okr.selectObjectiveTitle') });

    this.objectives =
      await this.plugin.taskDatabase.readAllObjectives();

    if (this.objectives.length === 0) {
      contentEl.createDiv({
        text: t('okr.noObjectivesInDb'),
        cls: 'tasklist-add-empty',
      });
      const btnContainer = contentEl.createDiv({
        cls: 'tasklist-modal-buttons',
      });
      const cancelBtn = btnContainer.createEl('button', {
        text: t('common.cancel'),
      });
      cancelBtn.addEventListener('click', () => this.close());
      return;
    }

    const listEl = contentEl.createDiv({
      cls: 'tasklist-add-list',
    });

    for (const obj of this.objectives) {
      const row = listEl.createDiv({ cls: 'tasklist-add-row' });

      row.createSpan({
        text: obj.title || obj.text,
        cls: 'tasklist-add-row-title',
      });

      row.createSpan({
        text: `${obj.year} Q${obj.quarter}`,
        cls: 'tasklist-add-row-priority',
      });

      row.addEventListener('click', () => {
        void (async () => {
          await this.onSelect(obj.uuid, obj.title);
          this.close();
        })();
      });
    }

    const btnContainer = contentEl.createDiv({
      cls: 'tasklist-modal-buttons',
    });
    const cancelBtn = btnContainer.createEl('button', {
      text: t('common.cancel'),
    });
    cancelBtn.addEventListener('click', () => this.close());
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ───── ObjectiveCreateModal ─────

class ObjectiveCreateModal extends Modal {
  private plugin: TaskListPlugin;
  private onCreated: (uuid: string, title: string) => Promise<void>;
  private yearInput!: HTMLInputElement;
  private quarterSelect!: HTMLSelectElement;
  private objIdInput!: HTMLInputElement;
  private objTextInput!: HTMLInputElement;
  private objTitleInput!: HTMLInputElement;

  constructor(
    app: App,
    plugin: TaskListPlugin,
    onCreated: (uuid: string, title: string) => Promise<void>
  ) {
    super(app);
    this.plugin = plugin;
    this.onCreated = onCreated;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('tasklist-modal');
    contentEl.createEl('h3', { text: t('okr.createObjectiveTitle') });

    // Auto-suggest next Objective ID
    const suggestedId = await this.suggestObjectiveId();

    // Year + Quarter
    const yqRow = contentEl.createDiv({
      cls: 'tasklist-modal-row',
    });

    const yearGroup = yqRow.createDiv({
      cls: 'tasklist-modal-setting tasklist-setting-flex',
    });
    yearGroup.createEl('label', { text: t('okr.year') });
    this.yearInput = yearGroup.createEl('input', {
      type: 'number',
      value: String(new Date().getFullYear()),
      cls: 'tasklist-modal-title',
    });

    const quarterGroup = yqRow.createDiv({
      cls: 'tasklist-modal-setting tasklist-setting-flex',
    });
    quarterGroup.createEl('label', { text: t('okr.quarter') });
    this.quarterSelect = quarterGroup.createEl('select', {
      cls: 'tasklist-add-filter-select',
    });
    for (let q = 1; q <= 4; q++) {
      this.quarterSelect.createEl('option', {
        text: `Q${q}`,
        value: String(q),
      });
    }
    this.quarterSelect.value = String(
      this.plugin.settings.defaultQuarter
    );

    // Objective ID (auto-suggested, editable)
    const idGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    idGroup.createEl('label', { text: t('okr.objectiveId') });
    this.objIdInput = idGroup.createEl('input', {
      type: 'text',
      value: suggestedId,
      cls: 'tasklist-modal-title',
    });

    // Title
    const titleGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    titleGroup.createEl('label', { text: t('okr.title') });
    this.objTitleInput = titleGroup.createEl('input', {
      type: 'text',
      placeholder: 'e.g. Q2 核心目标',
      cls: 'tasklist-modal-title',
    });

    // Text
    const textGroup = contentEl.createDiv({
      cls: 'tasklist-modal-setting',
    });
    textGroup.createEl('label', { text: t('okr.text') });
    this.objTextInput = textGroup.createEl('input', {
      type: 'text',
      placeholder: 'Describe the objective...',
      cls: 'tasklist-modal-title',
    });

    // Buttons
    const btnContainer = contentEl.createDiv({
      cls: 'tasklist-modal-buttons',
    });

    const saveBtn = btnContainer.createEl('button', {
      text: t('common.create'),
      cls: 'mod-cta',
    });
    saveBtn.addEventListener('click', () => {
      void (async () => {
        await this.handleSave();
      })();
    });

    const cancelBtn = btnContainer.createEl('button', {
      text: t('common.cancel'),
    });
    cancelBtn.addEventListener('click', () => this.close());
  }

  private async handleSave() {
    const objId = this.objIdInput.value.trim();
    const objText = this.objTextInput.value.trim();
    const objTitle = this.objTitleInput.value.trim();
    const year = parseInt(this.yearInput.value, 10);
    const quarter = parseInt(this.quarterSelect.value, 10);

    if (!objId) {
      new Notice(t('okr.notices.objectiveIdRequired'));
      return;
    }
    if (!objText) {
      new Notice(t('okr.notices.objectiveTextRequired'));
      return;
    }
    if (isNaN(year) || year < 2000 || year > 2100) {
      new Notice(t('okr.notices.invalidYear'));
      return;
    }

    await this.plugin.taskDatabase.upsertObjective({
      id: objId,
      year,
      quarter,
      text: objText,
      title: objTitle || undefined,
    });

    // Read back to get the UUID
    const objectives =
      await this.plugin.taskDatabase.readObjectives(year, quarter);
    const created = objectives.find((o) => o.id === objId);
    const uuid = created?.uuid || '';

    await this.onCreated(uuid, objTitle);
    this.close();
  }

  /**
   * Auto-suggest next Objective ID (O1, O2, ...).
   */
  private async suggestObjectiveId(): Promise<string> {
    const objectives =
      await this.plugin.taskDatabase.readAllObjectives();
    let maxNum = 0;
    for (const obj of objectives) {
      const match = obj.id.match(/O(\d+)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    return `O${maxNum + 1}`;
  }

  onClose() {
    this.contentEl.empty();
  }
}
