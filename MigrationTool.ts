import { TFile, Notice, normalizePath } from 'obsidian';
import type TaskListPlugin from './main';
import { t } from './i18n';

interface MigrationStats {
  objectives: number;
  keyResults: number;
  krProgressUpdates: number;
}

export class MigrationTool {
  private plugin: TaskListPlugin;

  constructor(plugin: TaskListPlugin) {
    this.plugin = plugin;
  }

  /**
   * Get the active project's root path for scoping migrations.
   */
  private getActiveRootPath(): string {
    const activeId = this.plugin.settings.activeProjectId;
    const project = this.plugin.settings.projects.find(p => p.id === activeId);
    return project?.rootPath || '文档库/模块/工作项目';
  }

  /**
   * Run full sync: OKR files + OKR progress.
   * Daily report frontmatter sync has been removed — tasks now
   * live in SQLite with dates set at creation time.
   */
  async migrateAll(year: number): Promise<MigrationStats> {
    const stats: MigrationStats = {
      objectives: 0,
      keyResults: 0,
      krProgressUpdates: 0,
    };

    new Notice('TaskList: ' + t('notices.syncingOkr'));
    await this.migrateOkrFiles(year, stats);

    new Notice('TaskList: Syncing OKR progress...');
    await this.syncOkrProgress(year, stats);

    const summary = `${t('notices.syncComplete')}: ${stats.objectives} objectives, ${stats.keyResults} key results, ${stats.krProgressUpdates} KR progress updates`;
    new Notice(summary, 8000);
    console.log('TaskList Migration:', summary);
    return stats;
  }

  /**
   * Incrementally sync a single changed OKR file.
   * Daily reports are no longer parsed for frontmatter sync.
   */
  async syncFile(file: TFile): Promise<void> {
    const filePath = file.path;
    const rootPath = this.getActiveRootPath();
    const escapedRoot = rootPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // OKR pattern: {rootPath}/{year}/OKR/{year}-Q{n}-OKR.md
    const pattern = new RegExp(
      `${escapedRoot}\\/(\\d{4})\\/OKR\\/\\d{4}-Q[1-4]-OKR\\.md$`
    );
    const okrMatch = filePath.match(pattern);
    if (!okrMatch) return; // Not a tracked file — silently skip

    const fm = this.getFileFrontmatter(file);
    if (!fm) return;

    await this.upsertOkrFileData(fm, filePath);
  }

  /**
   * Scan OKR files and upsert objectives + key results.
   */
  private async migrateOkrFiles(
    year: number,
    stats: MigrationStats
  ): Promise<void> {
    const rootPath = this.getActiveRootPath();
    const basePath = normalizePath(
      `${rootPath}/${year}/OKR`
    );

    for (let q = 1; q <= 4; q++) {
      const fileName = `${year}-Q${q}-OKR.md`;
      const filePath = normalizePath(`${basePath}/${fileName}`);
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) continue;

      try {
        const fm = this.getFileFrontmatter(file);
        if (!fm || !fm.objectives) continue;

        const objectives = fm.objectives as any[];
        for (const obj of objectives) {
          if (!obj.id || !obj.text) continue;
          // Skip template placeholders
          if (obj.text.indexOf('{{') !== -1) continue;

          await this.plugin.taskDatabase.upsertObjective({
            id: obj.id,
            year,
            quarter: q,
            text: obj.text,
            sourceFile: filePath,
          });
          stats.objectives++;

          if (obj.key_results) {
            for (const kr of obj.key_results) {
              if (!kr.id || !kr.text) continue;
              if (kr.text.indexOf('{{') !== -1) continue;

              await this.plugin.taskDatabase.upsertKeyResult({
                id: kr.id,
                objectiveId: obj.id,
                text: kr.text,
                target: kr.target || '',
                owner: kr.owner || '',
                sourceFile: filePath,
              });
              stats.keyResults++;
            }
          }
        }
      } catch (err) {
        console.error(`TaskList: Failed to migrate OKR ${filePath}:`, err);
      }
    }
  }

  /**
   * Scan daily report okr frontmatter fields and update KR progress in DB.
   * Kept because daily reports still serve as narrative journals where
   * users can update KR progress text.
   */
  private async syncOkrProgress(
    year: number,
    stats: MigrationStats
  ): Promise<void> {
    const rootPath = this.getActiveRootPath();
    const basePath = normalizePath(
      `${rootPath}/${year}/日报`
    );

    const months = [
      '01-Jan', '02-Feb', '03-Mar', '04-Apr', '05-May', '06-Jun',
      '07-Jul', '08-Aug', '09-Sep', '10-Oct', '11-Nov', '12-Dec',
    ];

    // Track latest progress per KR (use most recent date)
    const latestKrProgress = new Map<
      string,
      { progress: number; today: string; date: string }
    >();

    for (const month of months) {
      const folderPath = normalizePath(`${basePath}/${month}`);
      const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
      if (!folder || !(folder as any).children) continue;

      const children = (folder as any).children as TFile[];
      for (const file of children) {
        if (file.extension !== 'md') continue;

        try {
          const fm = this.getFileFrontmatter(file);
          if (!fm || !fm.okr || !Array.isArray(fm.okr)) continue;

          const fileDate = fm.date || '';

          for (const entry of fm.okr) {
            const krText =
              typeof entry === 'string' ? entry : entry.kr || '';
            const match = krText.match(/KR\s*\d+\.\d+/i);
            const key = match ? match[0].toUpperCase() : krText;
            if (!key) continue;

            const progress =
              typeof entry === 'object' ? entry.progress || 0 : 0;
            const today =
              typeof entry === 'object' ? entry.today || '' : '';

            const existing = latestKrProgress.get(key);
            if (
              !existing ||
              (fileDate && fileDate > existing.date)
            ) {
              latestKrProgress.set(key, {
                progress,
                today,
                date: fileDate,
              });
            }
          }
        } catch (err) {
          // Skip files that can't be parsed
        }
      }
    }

    // Apply latest progress to database
    for (const [krId, data] of latestKrProgress) {
      try {
        await this.plugin.taskDatabase.updateKRProgress(
          krId,
          data.progress,
          data.today
        );
        stats.krProgressUpdates++;
      } catch {
        // KR may not exist in DB yet — skip
      }
    }
  }

  /**
   * Get frontmatter from a TFile using Obsidian's metadata cache.
   */
  private getFileFrontmatter(
    file: TFile
  ): Record<string, any> | null {
    try {
      const cache =
        this.plugin.app.metadataCache.getFileCache(file);
      return cache?.frontmatter || null;
    } catch {
      return null;
    }
  }

  /**
   * Parse OKR frontmatter and upsert objectives + key results.
   */
  private async upsertOkrFileData(
    fm: Record<string, any>,
    filePath: string
  ): Promise<void> {
    if (!fm.objectives) return;

    const yearMatch = filePath.match(/(\d{4})/);
    const quarterMatch = filePath.match(/Q([1-4])/);
    const year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
    const quarter = quarterMatch ? parseInt(quarterMatch[1], 10) : 1;

    const objectives = fm.objectives as any[];
    for (const obj of objectives) {
      if (!obj.id || !obj.text) continue;
      if (obj.text.indexOf('{{') !== -1) continue;

      await this.plugin.taskDatabase.upsertObjective({
        id: obj.id,
        year,
        quarter,
        text: obj.text,
        sourceFile: filePath,
      });

      if (obj.key_results) {
        for (const kr of obj.key_results) {
          if (!kr.id || !kr.text) continue;
          if (kr.text.indexOf('{{') !== -1) continue;

          await this.plugin.taskDatabase.upsertKeyResult({
            id: kr.id,
            objectiveId: obj.id,
            text: kr.text,
            target: kr.target || '',
            owner: kr.owner || '',
            sourceFile: filePath,
          });
        }
      }
    }
  }
}
