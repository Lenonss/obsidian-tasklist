import {
  ItemView,
  WorkspaceLeaf,
  TFile,
  setIcon,
  Notice,
} from 'obsidian';
import type TaskListPlugin from './main';
import type {
  WorkboardConfig,
  Task,
  KeyResult,
} from './types';
import { VIEW_TYPE_WORKBOARD } from './types';
import {
  toDateStr,
  parseDateStr,
  getWeekStart,
  getWeekEnd,
  getMonthStart,
  getMonthEnd,
  getQuarterStart,
  getQuarterEnd,
  getYearStart,
  getYearEnd,
  getDaysInRange,
  getMonthCalendarWeeks,
  getISOWeekNumber,
  formatDateLabel,
} from './utils';
import { t } from './i18n';

const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'];

const DOT_COLORS: Record<string, string> = {
  todo: 'var(--text-muted)',
  inProgress: 'var(--color-blue)',
  done: 'var(--color-green)',
  blocked: 'var(--text-error)',
  next: 'var(--text-muted)',
  achievement: 'var(--color-green)',
};

type DayCell = {
  date: string;
  isToday: boolean;
  isCurrentMonth?: boolean;
  dayName: string;
  dayOfMonth: number;
};

export class WorkboardView extends ItemView {
  private plugin: TaskListPlugin;
  private config!: WorkboardConfig;
  private file!: TFile;

  // State
  private navOffset = 0;
  private allTasks: Task[] = [];
  private okrItems: KeyResult[] = [];
  private loading = true;
  private currentProjectId: string = '';

  // DOM refs
  private rootEl!: HTMLElement;
  private dateLabelEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: TaskListPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_WORKBOARD;
  }

  getDisplayText(): string {
    return this.file?.basename || 'Workboard';
  }

  getIcon(): string {
    return 'calendar-days';
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();

    const viewState = this.leaf.getViewState();
    const filePath = (viewState as { state?: { file?: string } }).state?.file;
    if (filePath) {
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile && file.extension === 'workboard') {
        await this.onLoadFile(file);
        return;
      }
    }

    container.createDiv({
      text: t('workboard.opening'),
      cls: 'workproject--Loading',
    });
  }

  setState(state: unknown, result: unknown): Promise<void> {
    const s = state as { file?: string } | undefined;
    if (s?.file) {
      const file = this.plugin.app.vault.getAbstractFileByPath(s.file);
      if (file instanceof TFile) {
        void this.onLoadFile(file);
      }
    }
    return super.setState(state, result as import('obsidian').ViewStateResult);
  }

  getState(): Record<string, unknown> {
    return { file: this.file?.path };
  }

  async onLoadFile(file: TFile) {
    this.file = file;
    await this.loadConfig();

    // Priority: config.projectId > auto-detect > global fallback
    if (this.config.projectId) {
      const project = this.plugin.settings.projects.find(
        (p) => p.id === this.config.projectId && p.enabled
      );
      if (project) {
        this.currentProjectId = project.id;
      } else {
        // Bound project deleted/disabled — fall back
        this.currentProjectId = '';
        this.config.projectId = undefined;
        new Notice(t('workboard.projectNotFound'));
      }
    }

    if (!this.currentProjectId) {
      const detected = this.plugin.detectProjectFromActiveFile();
      if (detected) {
        this.currentProjectId = detected.id;
        this.config.projectId = detected.id;
        await this.saveConfig();
      }
    }

    await this.loadData();
    this.render();
  }

  // ───── Config ─────

  private async loadConfig() {
    try {
      const content = await this.plugin.app.vault.read(this.file);
      this.config = JSON.parse(content) as WorkboardConfig;
    } catch {
      this.config = {
        version: 1,
        year: new Date().getFullYear(),
        timeRange: 'week',
        showDashboard: true,
        maxCards: 20,
        activeTab: 'calendar',
      };
      await this.saveConfig();
    }
  }

  private async saveConfig() {
    this.config.data = this.config.data || {};
    try {
      await this.plugin.app.vault.modify(
        this.file,
        JSON.stringify(this.config, null, 2)
      );
    } catch (err) {
      console.error('Workboard: Failed to save config:', err);
    }
  }

  // ───── Data ─────

  private getDateRange(): { start: Date; end: Date; label: string } {
    const now = new Date();
    const offsetDate = new Date(now);
    const { timeRange } = this.config;

    if (timeRange === 'week') {
      offsetDate.setDate(offsetDate.getDate() + this.navOffset * 7);
      return {
        start: getWeekStart(offsetDate),
        end: getWeekEnd(offsetDate),
        label: formatDateLabel('week', now, now, this.navOffset),
      };
    } else if (timeRange === 'month') {
      offsetDate.setMonth(offsetDate.getMonth() + this.navOffset);
      return {
        start: getMonthStart(offsetDate),
        end: getMonthEnd(offsetDate),
        label: formatDateLabel('month', now, now, this.navOffset),
      };
    } else if (timeRange === 'quarter') {
      offsetDate.setMonth(offsetDate.getMonth() + this.navOffset * 3);
      return {
        start: getQuarterStart(offsetDate),
        end: getQuarterEnd(offsetDate),
        label: formatDateLabel('quarter', now, now, this.navOffset),
      };
    } else {
      offsetDate.setFullYear(offsetDate.getFullYear() + this.navOffset);
      return {
        start: getYearStart(offsetDate),
        end: getYearEnd(offsetDate),
        label: formatDateLabel('year', now, now, this.navOffset),
      };
    }
  }

  async loadData() {
    this.loading = true;
    const range = this.getDateRange();
    const startStr = toDateStr(range.start);
    const endStr = toDateStr(range.end);

    try {
      this.allTasks =
        await this.getCurrentDb().readTasksByDateRange(
          startStr,
          endStr
        );
    } catch (err) {
      console.error('Workboard: Failed to load tasks:', err);
      this.allTasks = [];
    }

    try {
      const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;
      const objectives =
        await this.getCurrentDb().readObjectives(
          this.config.year,
          currentQuarter
        );
      const krs: KeyResult[] = [];
      for (const obj of objectives) {
        const objKrs =
          await this.getCurrentDb().readKeyResults(obj.id);
        for (const kr of objKrs) {
          kr._objectiveText = obj.text;
          if (!kr.sourceFile && obj.sourceFile) {
            kr.sourceFile = obj.sourceFile;
          }
        }
        krs.push(...objKrs);
      }
      this.okrItems = krs;
    } catch {
      this.okrItems = [];
    }

    this.loading = false;
  }

  // ───── Main Render ─────

  render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('workproject--Root');

    const range = this.getDateRange();

    if (this.loading) {
      container.createDiv({
        text: t('workboard.loading'),
        cls: 'workproject--Loading',
      });
      return;
    }

    const currentQuarter = Math.floor(new Date().getMonth() / 3) + 1;

    // ── Header ──
    const header = container.createDiv({ cls: 'workproject--Header' });
    const headerLeft = header.createDiv({ cls: 'workproject--HeaderLeft' });
    headerLeft.createEl('h2', {
      text: `${t('workboard.title')} · Q${currentQuarter}`,
      cls: 'workproject--Title',
    });
    this.dateLabelEl = headerLeft.createSpan({
      text: range.label,
      cls: 'workproject--DateLabel',
    });

    const headerRight = header.createDiv({
      cls: 'workproject--HeaderRight',
    });

    this.renderProjectSelector(headerRight);

    const prevLabel = this.getPrevLabel();
    const nextLabel = this.getNextLabel();
    const prevBtn = headerRight.createEl('button', {
      text: prevLabel,
      cls: 'workproject--NavBtn',
    });
    prevBtn.addEventListener('click', () => {
      this.navOffset--;
      void this.refresh();
    });

    const todayBtn = headerRight.createEl('button', {
      text: t('workboard.today'),
      cls: 'workproject--NavBtn workproject--NavBtnToday',
    });
    todayBtn.addEventListener('click', () => {
      this.navOffset = 0;
      void this.refresh();
    });

    const nextBtn = headerRight.createEl('button', {
      text: nextLabel,
      cls: 'workproject--NavBtn',
    });
    nextBtn.addEventListener('click', () => {
      this.navOffset++;
      void this.refresh();
    });

    const refreshBtn = headerRight.createEl('button', {
      cls: 'workproject--RefreshBtn',
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', () => { void this.refresh(); });

    // ── Stats Bar ──
    this.renderStatsBar(container);

    // ── Tab Bar ──
    this.renderTabBar(container);

    // ── Tab Content ──
    const tabContent = container.createDiv({ cls: 'workproject--TabContent' });

    const activeTab = this.config.activeTab || 'calendar';
    if (activeTab === 'calendar') {
      this.renderCalendarBoard(tabContent);
    } else if (activeTab === 'overview') {
      this.renderOverview(tabContent);
    } else if (activeTab === 'okr') {
      this.renderOkrTab(tabContent);
    }
  }

  async refresh() {
    await this.loadData();
    this.render();
  }

  private getCurrentDb() {
    if (this.currentProjectId) {
      return this.plugin.getProjectDatabase(this.currentProjectId);
    }
    return this.plugin.taskDatabase;
  }

  private getNavLabel(): string {
    const { timeRange } = this.config;
    if (timeRange === 'week') return t('workboard.weekLabel');
    if (timeRange === 'month') return t('workboard.monthLabel');
    if (timeRange === 'quarter') return t('workboard.quarterLabel');
    return t('workboard.yearLabel');
  }

  private getPrevLabel(): string {
    const { timeRange } = this.config;
    if (timeRange === 'week') return t('workboard.prevWeek');
    if (timeRange === 'month') return t('workboard.prevMonth');
    if (timeRange === 'quarter') return t('workboard.prevQuarter');
    return t('workboard.prevYear');
  }

  private getNextLabel(): string {
    const { timeRange } = this.config;
    if (timeRange === 'week') return t('workboard.nextWeek');
    if (timeRange === 'month') return t('workboard.nextMonth');
    if (timeRange === 'quarter') return t('workboard.nextQuarter');
    return t('workboard.nextYear');
  }

  // ───── Project Selector ─────

  private renderProjectSelector(headerRight: HTMLElement) {
    const enabledProjects = this.plugin.settings.projects.filter(
      (p) => p.enabled
    );
    if (enabledProjects.length <= 1) return;

    const select = headerRight.createEl('select', {
      cls: 'workproject--ProjectSelect',
    });

    let i = 0;
    for (const proj of enabledProjects) {
      const option = select.createEl('option', {
        text: proj.name,
        value: proj.id,
      });
      if (proj.id === this.currentProjectId || (!this.currentProjectId && i === 0)) {
        option.selected = true;
      }
      i++;
    }

    select.addEventListener('change', () => {
      void (async () => {
        const newId = select.value;
        if (newId === this.currentProjectId) return;
        this.currentProjectId = newId;
        this.config.projectId = newId;
        await this.saveConfig();
        await this.refresh();
      })();
    });
  }

  // ───── Stats Bar ─────

  private renderStatsBar(container: HTMLElement) {
    const bar = container.createDiv({ cls: 'workproject--StatsBar' });

    const totalTasks = this.allTasks.length;
    const doneTasks = this.allTasks.filter(
      (t) =>
        t.status === 'done' || t.type === 'achievement'
    ).length;
    const blockedTasks = this.allTasks.filter(
      (t) => t.type === 'blocker'
    ).length;
    const rate =
      totalTasks > 0
        ? Math.round(
            (doneTasks / Math.max(totalTasks - blockedTasks, 1)) *
              100
          )
        : 0;

    const stats = [
      { label: t('workboard.stats.total'), value: String(totalTasks) },
      { label: t('workboard.stats.done'), value: String(doneTasks) },
      { label: t('workboard.stats.blocked'), value: String(blockedTasks) },
      { label: t('workboard.stats.completionRate'), value: `${rate}%` },
    ];

    for (const s of stats) {
      const span = bar.createSpan({ cls: 'workproject--Stat' });
      span.createSpan({ text: s.label + ' ' });
      span.createEl('strong', { text: s.value });
    }
  }

  // ───── Tab Bar ─────

  private renderTabBar(container: HTMLElement) {
    const tabBar = container.createDiv({ cls: 'workproject--TabBar' });

    const tabs: { id: 'calendar' | 'overview' | 'okr'; icon: string; label: string }[] = [
      { id: 'calendar', icon: 'calendar-days', label: t('workboard.tabs.calendar') },
      { id: 'overview', icon: 'bar-chart-3', label: t('workboard.tabs.overview') },
      { id: 'okr', icon: 'target', label: t('workboard.tabs.okr') },
    ];

    const activeTab = this.config.activeTab || 'calendar';

    for (const tab of tabs) {
      const btn = tabBar.createEl('button', {
        cls: `workproject--TabBtn${tab.id === activeTab ? ' active' : ''}`,
      });
      setIcon(btn, tab.icon);
      btn.createSpan({ text: tab.label });
      btn.addEventListener('click', () => {
        if (this.config.activeTab !== tab.id) {
          void this.switchTab(tab.id);
        }
      });
    }
  }

  private async switchTab(tab: 'calendar' | 'overview' | 'okr') {
    this.config.activeTab = tab;
    await this.saveConfig();
    this.render();
  }

  // ───── Overview Tab ─────

  private renderOverview(container: HTMLElement) {
    const wrapper = container.createDiv({ cls: 'workproject--Overview' });

    this.renderStatCards(wrapper);

    const chartsRow = wrapper.createDiv({
      cls: 'workproject--ChartsRow',
    });
    this.renderTrendChart(chartsRow.createDiv({ cls: 'workproject--ChartCol' }));
    this.renderDistChart(chartsRow.createDiv({ cls: 'workproject--ChartCol' }));

    this.renderDailyBarChart(
      wrapper.createDiv({ cls: 'workproject--DailyBarRow' })
    );
  }

  // ───── OKR Tab ─────

  private renderOkrTab(container: HTMLElement) {
    const body = container.createDiv({ cls: 'workproject--OkrTabBody' });

    if (this.okrItems.length === 0) {
      body.createDiv({
        text: t('workboard.okr.empty'),
        cls: 'workproject--EmptyOkr',
      });
      return;
    }

    for (const kr of this.okrItems) {
      this.renderOkrCard(body, kr);
    }
  }

  private renderStatCards(container: HTMLElement) {
    const row = container.createDiv({
      cls: 'workproject--StatCardsRow',
    });

    const totalTasks = this.allTasks.length;
    const doneTasks = this.allTasks.filter(
      (t) =>
        t.status === 'done' || t.type === 'achievement'
    ).length;
    const blockedTasks = this.allTasks.filter(
      (t) => t.type === 'blocker'
    ).length;
    const inProg = totalTasks - doneTasks - blockedTasks;
    const rate =
      totalTasks > 0
        ? Math.round(
            (doneTasks /
              Math.max(totalTasks - blockedTasks, 1)) *
            100
          )
        : 0;

    const todayStr = toDateStr(new Date());
    const todayDone = this.allTasks.filter(
      (t) =>
        t.date === todayStr &&
        (t.status === 'done' || t.type === 'achievement')
    ).length;

    const cards = [
      { label: t('workboard.dashboard.todayDone'), value: String(todayDone), color: 'var(--color-green)' },
      { label: t('workboard.dashboard.inProgress'), value: String(Math.max(0, inProg)), color: 'var(--color-blue)' },
      { label: t('workboard.stats.completionRate'), value: `${rate}%`, color: 'var(--color-cyan)' },
      { label: t('workboard.dashboard.totalTasks'), value: String(totalTasks), color: 'var(--text-muted)' },
    ];

    for (const card of cards) {
      const c = row.createDiv({ cls: 'workproject--StatCard' });
      const statVal = c.createDiv({
        text: card.value,
        cls: 'workproject--StatCardValue',
      });
      statVal.setCssProps({ '--stat-color': card.color });
      c.createDiv({
        text: card.label,
        cls: 'workproject--StatCardLabel',
      });
    }
  }

  // ───── SVG Charts ─────

  private renderTrendChart(container: HTMLElement) {
    const card = container.createDiv({
      cls: 'workproject--DashboardCard',
    });
    card.createDiv({
      text: t('workboard.dashboard.doneTrend'),
      cls: 'workproject--DashboardCardTitle',
    });

    const timeRange = this.config.timeRange;

    const buckets: { key: string; label: string; done: number }[] = [];
    const range = this.getDateRange();
    const cursor = new Date(range.start);

    while (cursor <= range.end) {
      let key: string, label: string;
      if (timeRange === 'week') {
        const isoDay = cursor.getDay();
        key = DAY_NAMES[isoDay === 0 ? 6 : isoDay - 1];
        label = key;
      } else if (timeRange === 'month') {
        key = `W${getISOWeekNumber(cursor)}`;
        label = key;
      } else if (timeRange === 'quarter') {
        key = `${cursor.getMonth() + 1}月`;
        label = key;
      } else {
        const q = Math.floor(cursor.getMonth() / 3) + 1;
        key = `Q${q}`;
        label = key;
      }

      if (!buckets.find((b) => b.key === key)) {
        buckets.push({ key, label, done: 0 });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    for (const t of this.allTasks) {
      if (!t.date) continue;
      const d = parseDateStr(t.date);
      let key: string;
      if (timeRange === 'week') {
        const isoDay = d.getDay();
        key = DAY_NAMES[isoDay === 0 ? 6 : isoDay - 1];
      } else if (timeRange === 'month') {
        key = `W${getISOWeekNumber(d)}`;
      } else if (timeRange === 'quarter') {
        key = `${d.getMonth() + 1}月`;
      } else {
        key = `Q${Math.floor(d.getMonth() / 3) + 1}`;
      }
      const bucket = buckets.find((b) => b.key === key);
      if (!bucket) continue;
      if (t.status === 'done' || t.type === 'achievement') {
        bucket.done++;
      }
    }

    if (buckets.length === 0) return;

    const width = 400;
    const height = 180;
    const pt = 20, pr = 20, pb = 30, pl = 40;
    const cw = width - pl - pr;
    const ch = height - pt - pb;
    const maxVal = Math.max(1, ...buckets.map((b) => b.done));

    const svg = activeDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    );
    svg.setAttribute('width', '100%');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.classList.add('workproject--Chart');

    for (let i = 0; i < buckets.length; i++) {
      const x = pl + (i / Math.max(buckets.length - 1, 1)) * cw;
      const text = activeDocument.createElementNS(
        'http://www.w3.org/2000/svg',
        'text'
      );
      text.setAttribute('x', String(x));
      text.setAttribute('y', String(height - 5));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('fill', 'var(--text-muted)');
      text.textContent = buckets[i].label;
      svg.appendChild(text);
    }

    let pathD = '';
    for (let i = 0; i < buckets.length; i++) {
      const x = pl + (i / Math.max(buckets.length - 1, 1)) * cw;
      const y = pt + ch - (buckets[i].done / maxVal) * ch;
      pathD += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;

      const circle = activeDocument.createElementNS(
        'http://www.w3.org/2000/svg',
        'circle'
      );
      circle.setAttribute('cx', x.toFixed(1));
      circle.setAttribute('cy', y.toFixed(1));
      circle.setAttribute('r', '3.5');
      circle.setAttribute('fill', 'var(--color-green)');
      svg.appendChild(circle);
    }

    const path = activeDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'path'
    );
    path.setAttribute('d', pathD);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'var(--color-green)');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);

    card.appendChild(svg);
  }

  private renderDistChart(container: HTMLElement) {
    const card = container.createDiv({
      cls: 'workproject--DashboardCard',
    });
    card.createDiv({
      text: t('workboard.dashboard.taskDistribution'),
      cls: 'workproject--DashboardCardTitle',
    });

    const types = [
      { key: 'todo', label: t('workboard.dashboard.todo') },
      { key: 'done', label: t('workboard.dashboard.done') },
      { key: 'blocked', label: t('workboard.dashboard.blocked') },
    ];

    const counts: Record<string, number> = {};
    for (const t of this.allTasks) {
      if (t.type === 'achievement' || t.status === 'done') {
        counts.done = (counts.done || 0) + 1;
      } else if (t.type === 'blocker') {
        counts.blocked = (counts.blocked || 0) + 1;
      } else {
        counts.todo = (counts.todo || 0) + 1;
      }
    }

    const width = 300;
    const height = 180;
    const pt = 20, pb = 30, pl = 20, pr = 20;
    const cw = width - pl - pr;
    const ch = height - pt - pb;
    const barCount = types.length;
    const barGap = 10;
    const barW = (cw - barGap * (barCount - 1)) / barCount;
    const maxVal = Math.max(1, ...types.map((t) => counts[t.key] || 0));

    const colors: Record<string, string> = {
      todo: 'var(--text-muted)',
      done: 'var(--color-green)',
      blocked: 'var(--text-error)',
    };

    const svg = activeDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    );
    svg.setAttribute('width', '100%');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.classList.add('workproject--Chart');

    for (let i = 0; i < types.length; i++) {
      const count = counts[types[i].key] || 0;
      const barH = ch * (count / maxVal);
      const x = pl + i * (barW + barGap);
      const y = pt + ch - barH;

      const rect = activeDocument.createElementNS(
        'http://www.w3.org/2000/svg',
        'rect'
      );
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(barW));
      rect.setAttribute('height', String(Math.max(barH, 0)));
      rect.setAttribute('fill', colors[types[i].key]);
      rect.setAttribute('rx', '3');
      svg.appendChild(rect);

      const valText = activeDocument.createElementNS(
        'http://www.w3.org/2000/svg',
        'text'
      );
      valText.setAttribute('x', String(x + barW / 2));
      valText.setAttribute('y', String(Math.max(y - 5, 10)));
      valText.setAttribute('text-anchor', 'middle');
      valText.setAttribute('font-size', '12');
      valText.setAttribute('font-weight', 'bold');
      valText.setAttribute('fill', 'var(--text-normal)');
      valText.textContent = String(count);
      svg.appendChild(valText);

      const labelText = activeDocument.createElementNS(
        'http://www.w3.org/2000/svg',
        'text'
      );
      labelText.setAttribute('x', String(x + barW / 2));
      labelText.setAttribute('y', String(height - 8));
      labelText.setAttribute('text-anchor', 'middle');
      labelText.setAttribute('font-size', '10');
      labelText.setAttribute('fill', 'var(--text-muted)');
      labelText.textContent = types[i].label;
      svg.appendChild(labelText);
    }

    card.appendChild(svg);
  }

  private renderDailyBarChart(container: HTMLElement) {
    const timeRange = this.config.timeRange;

    const buckets: { key: string; label: string; done: number }[] = [];
    const range = this.getDateRange();
    const cursor = new Date(range.start);

    while (cursor <= range.end) {
      let key: string, label: string;
      if (timeRange === 'week') {
        const isoDay = cursor.getDay();
        key = DAY_NAMES[isoDay === 0 ? 6 : isoDay - 1];
        label = key;
      } else if (timeRange === 'month') {
        key = `W${getISOWeekNumber(cursor)}`;
        label = key;
      } else if (timeRange === 'quarter') {
        key = `${cursor.getMonth() + 1}月`;
        label = key;
      } else {
        const q = Math.floor(cursor.getMonth() / 3) + 1;
        key = `Q${q}`;
        label = key;
      }
      if (!buckets.find((b) => b.key === key)) {
        buckets.push({ key, label, done: 0 });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    for (const t of this.allTasks) {
      if (!t.date) continue;
      const d = parseDateStr(t.date);
      let key: string;
      if (timeRange === 'week') {
        const isoDay = d.getDay();
        key = DAY_NAMES[isoDay === 0 ? 6 : isoDay - 1];
      } else if (timeRange === 'month') {
        key = `W${getISOWeekNumber(d)}`;
      } else if (timeRange === 'quarter') {
        key = `${d.getMonth() + 1}月`;
      } else {
        key = `Q${Math.floor(d.getMonth() / 3) + 1}`;
      }
      const bucket = buckets.find((b) => b.key === key);
      if (!bucket) continue;
      if (t.status === 'done' || t.type === 'achievement') {
        bucket.done++;
      }
    }

    if (buckets.length === 0) return;

    const card = container.createDiv({
      cls: 'workproject--DashboardCard',
    });
    card.createDiv({
      text: t('workboard.dashboard.dailyDetail'),
      cls: 'workproject--DashboardCardTitle',
    });

    const width = 400;
    const barH = 18;
    const barGap = 6;
    const pl = 45;
    const pr = 35;
    const cw = width - pl - pr;
    const height = 20 + buckets.length * (barH + barGap);
    const maxVal = Math.max(1, ...buckets.map((b) => b.done));

    const svg = activeDocument.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    );
    svg.setAttribute('width', '100%');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.classList.add('workproject--Chart');

    for (let i = 0; i < buckets.length; i++) {
      const bw = (buckets[i].done / maxVal) * cw;
      const y = 10 + i * (barH + barGap);

      const labelText = activeDocument.createElementNS(
        'http://www.w3.org/2000/svg',
        'text'
      );
      labelText.setAttribute('x', String(pl - 5));
      labelText.setAttribute('y', String(y + barH - 4));
      labelText.setAttribute('text-anchor', 'end');
      labelText.setAttribute('font-size', '10');
      labelText.setAttribute('fill', 'var(--text-muted)');
      labelText.textContent = buckets[i].label;
      svg.appendChild(labelText);

      const rect = activeDocument.createElementNS(
        'http://www.w3.org/2000/svg',
        'rect'
      );
      rect.setAttribute('x', String(pl));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(Math.max(bw, 0)));
      rect.setAttribute('height', String(barH));
      rect.setAttribute('fill', 'var(--color-green)');
      rect.setAttribute('rx', '2');
      rect.setAttribute('opacity', '0.8');
      svg.appendChild(rect);

      if (buckets[i].done > 0) {
        const valText = activeDocument.createElementNS(
          'http://www.w3.org/2000/svg',
          'text'
        );
        valText.setAttribute('x', String(pl + bw + 4));
        valText.setAttribute('y', String(y + barH - 4));
        valText.setAttribute('font-size', '10');
        valText.setAttribute('fill', 'var(--text-muted)');
        valText.textContent = String(buckets[i].done);
        svg.appendChild(valText);
      }
    }

    card.appendChild(svg);
  }

  private renderOkrCard(container: HTMLElement, kr: KeyResult) {
    const source =
      kr.sourceFile ||
      `文档库/模块/工作项目/${this.config.year}/OKR/`;

    const card = container.createDiv({
      cls: 'workproject--OkrCard',
      title: `${kr._objectiveText || ''} → ${kr.text}`,
    });

    card.addEventListener('click', () => {
      const file =
        this.plugin.app.vault.getAbstractFileByPath(source);
      if (file instanceof TFile) {
        this.plugin.app.workspace.getLeaf(false).openFile(file);
      }
    });

    card.createSpan({
      text: kr.id,
      cls: 'workproject--OkrCardId',
    });

    card.createDiv({
      text: kr.text,
      cls: 'workproject--OkrCardText',
    });

    const pct = kr.progress || 0;
    const pColor =
      pct >= 80
        ? 'var(--color-green)'
        : pct >= 50
          ? 'var(--color-orange)'
          : 'var(--text-error)';

    const progressWrap = card.createDiv({
      cls: 'workproject--OkrProgressWrap',
    });

    const bar = progressWrap.createDiv({
      cls: 'workproject--OkrProgressBar',
    });
    const fillBar = bar.createDiv({
      cls: 'workproject--OkrProgressFill',
    });
    fillBar.setCssProps({
      '--progress-width': `${pct}%`,
      '--progress-color': pColor,
    });

    progressWrap.createSpan({
      text: `${pct}%`,
      cls: 'workproject--OkrProgressLabel',
    });

    if (kr.today) {
      card.createDiv({
        text: kr.today,
        cls: 'workproject--OkrToday',
      });
    }
  }

  // ───── Calendar Board ─────

  private renderCalendarBoard(container: HTMLElement) {
    const board = container.createDiv({
      cls: 'workproject--CalendarBoard',
    });

    const timeRange = this.config.timeRange;

    const dayItems: Record<string, Task[]> = {};
    for (const t of this.allTasks) {
      if (!t.date) continue;
      if (t.dateEnd && t.dateEnd !== t.date) {
        const endDate = parseDateStr(t.dateEnd);
        const cursor = parseDateStr(t.date);
        while (cursor <= endDate) {
          const dayStr = toDateStr(cursor);
          if (!dayItems[dayStr]) dayItems[dayStr] = [];
          dayItems[dayStr].push(t);
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        if (!dayItems[t.date]) dayItems[t.date] = [];
        dayItems[t.date].push(t);
      }
    }

    if (timeRange === 'week') {
      this.renderWeekView(board, dayItems);
    } else {
      this.renderMonthGridView(board, dayItems);
    }
  }

  private renderWeekView(
    board: HTMLElement,
    dayItems: Record<string, Task[]>
  ) {
    const range = this.getDateRange();
    const days = getDaysInRange(range.start, range.end);
    const grid = board.createDiv({
      cls: 'workproject--CalendarGrid workproject--CalendarGridWeek',
    });

    for (const day of days) {
      this.renderDayColumn(grid, day, dayItems);
    }
  }

  private renderMonthGridView(
    board: HTMLElement,
    dayItems: Record<string, Task[]>
  ) {
    const range = this.getDateRange();
    const weeks = getMonthCalendarWeeks(
      range.start.getFullYear(),
      range.start.getMonth()
    );

    const header = board.createDiv({
      cls: 'workproject--CalendarMonthHeader',
    });
    for (const name of DAY_NAMES) {
      header.createDiv({
        text: name,
        cls: 'workproject--CalendarWeekdayHeader',
      });
    }

    const grid = board.createDiv({
      cls: 'workproject--CalendarGrid workproject--CalendarGridMonth',
    });

    for (const week of weeks) {
      const weekRow = grid.createDiv({
        cls: 'workproject--CalendarWeekRow',
      });
      for (const day of week) {
        this.renderDayCell(weekRow, day, dayItems);
      }
    }
  }

  private renderDayColumn(
    container: HTMLElement,
    day: DayCell,
    dayItems: Record<string, Task[]>
  ) {
    const maxPerDay = this.config.maxCards;
    const items = dayItems[day.date] || [];
    const displayItems = items.slice(0, maxPerDay);
    const moreCount = items.length - maxPerDay;

    let cls = 'workproject--CalendarDay';
    if (day.isToday) cls += ' workproject--CalendarDayToday';

    const dayEl = container.createDiv({ cls });

    const dayHeader = dayEl.createDiv({
      cls: 'workproject--CalendarDayHeader',
    });
    dayHeader.createSpan({
      text: day.dayName,
      cls: 'workproject--CalendarDayName',
    });
    dayHeader.createSpan({
      text: `${new Date(day.date).getMonth() + 1}/${day.dayOfMonth}`,
      cls: 'workproject--CalendarDayDate',
    });

    const dayBody = dayEl.createDiv({
      cls: 'workproject--CalendarDayBody',
    });

    if (items.length === 0) {
      dayBody.createDiv({
        text: '—',
        cls: 'workproject--CalendarDayEmpty',
      });
      return;
    }

    for (const item of displayItems) {
      this.renderTaskCard(dayBody, item, false);
    }

    if (moreCount > 0) {
      dayBody.createDiv({
        text: t('workboard.dayMore').replace('{{count}}', String(moreCount)),
        cls: 'workproject--CalendarDayMore',
      });
    }
  }

  private renderDayCell(
    container: HTMLElement,
    day: DayCell,
    dayItems: Record<string, Task[]>
  ) {
    const items = dayItems[day.date] || [];
    const displayItems = items.slice(0, 3);
    const moreCount = items.length - 3;

    let cls = 'workproject--CalendarDay';
    if (day.isToday) cls += ' workproject--CalendarDayToday';
    if (!day.isCurrentMonth) cls += ' workproject--CalendarDayOtherMonth';

    const dayEl = container.createDiv({ cls });

    const dayHeader = dayEl.createDiv({
      cls: 'workproject--CalendarDayHeader',
    });
    dayHeader.createSpan({
      text: String(day.dayOfMonth),
      cls: 'workproject--CalendarDayDate',
    });

    const dayBody = dayEl.createDiv({
      cls: 'workproject--CalendarDayBody',
    });

    for (const item of displayItems) {
      this.renderTaskCard(dayBody, item, true);
    }

    if (moreCount > 0) {
      dayBody.createDiv({
        text: t('workboard.monthMore').replace('{{count}}', String(moreCount)),
        cls: 'workproject--CalendarDayMore',
      });
    }
  }

  // ───── Task Card ─────

  private renderTaskCard(
    container: HTMLElement,
    task: Task,
    isMonthView: boolean
  ) {
    const statusType = task.type || 'todo';
    const dotColor = DOT_COLORS[statusType] || 'var(--text-muted)';
    const title = task.title || t('workboard.unnamedTask');

    let cls = 'workproject--CalendarCard';
    if (task.type === 'achievement')
      cls += ' workproject--CalendarCardAchievement';
    if (task.type === 'blocker')
      cls += ' workproject--CalendarCardBlocker';
    if (task.dateEnd && task.dateEnd !== task.date)
      cls += ' workproject--CalendarCardRange';
    if (isMonthView) cls += ' workproject--CalendarCardMonth';

    const card = container.createDiv({
      cls,
      title: `${t('common.source')}: ${task.sourceFile || ''}\n${task.content || ''}`,
    });

    card.addEventListener('click', () => {
      if (task.sourceFile) {
        const file =
          this.plugin.app.vault.getAbstractFileByPath(
            task.sourceFile
          );
        if (file instanceof TFile) {
          this.plugin.app.workspace.getLeaf(false).openFile(file);
        }
      }
    });

    const dot = card.createSpan({
      cls: 'workproject--CalendarCardDot',
    });
    dot.setCssProps({ '--dot-color': dotColor });

    card.createSpan({
      text: title,
      cls: 'workproject--CalendarCardTitle',
    });
  }

  async onClose() {
    this.containerEl.empty();
  }
}
