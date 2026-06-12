import * as fs from 'node:fs';
import * as path from 'node:path';
import type { McpContext } from '../types.js';

export interface DailyReport {
  date: string;
  filePath: string;
  content: string;
  achievements: string[];
  blockers: string[];
}

export interface ProjectInfo {
  name: string;
  rootPath: string;
  taskCount: number;
  krCount: number;
}

/**
 * Read daily report markdown files for a date range.
 * Scans the rootPath/{year}/日报/{MM-Mon}/ directory structure.
 */
export function getDailyReports(
  ctx: McpContext,
  startDate: string,
  endDate: string
): DailyReport[] {
  const results: DailyReport[] = [];

  // Parse date range
  const start = new Date(startDate);
  const end = new Date(endDate);
  const cursor = new Date(start);

  const monthNames = [
    '01-Jan', '02-Feb', '03-Mar', '04-Apr', '05-May', '06-Jun',
    '07-Jul', '08-Aug', '09-Sep', '10-Oct', '11-Nov', '12-Dec',
  ];

  while (cursor <= end) {
    const year = cursor.getFullYear();
    const monthIdx = cursor.getMonth(); // 0-based
    const monthDir = monthNames[monthIdx];
    const dateStr = cursor.toISOString().split('T')[0]; // YYYY-MM-DD
    const fileName = `${dateStr}.md`;

    const filePath = path.join(
      ctx.rootPath,
      String(year),
      '日报',
      monthDir,
      fileName
    );

    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const report = parseDailyReport(dateStr, filePath, content);
        results.push(report);
      }
    } catch {
      // File doesn't exist or can't be read - skip
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return results;
}

function parseDailyReport(
  date: string,
  filePath: string,
  content: string
): DailyReport {
  const achievements: string[] = [];
  const blockers: string[] = [];

  // Parse ## 今日成果 section
  const achievementMatch = content.match(/##\s*今日成果\s*\n([\s\S]*?)(?=\n##|$)/);
  if (achievementMatch) {
    const lines = achievementMatch[1].trim().split('\n');
    for (const line of lines) {
      const item = line.replace(/^-\s*\[x\]\s*/i, '').trim();
      if (item && item !== '-') {
        achievements.push(item);
      }
    }
  }

  // Parse ## 阻塞项 section
  const blockerMatch = content.match(/##\s*阻塞项\s*\n([\s\S]*?)(?=\n##|$)/);
  if (blockerMatch) {
    const lines = blockerMatch[1].trim().split('\n');
    for (const line of lines) {
      const item = line.replace(/^-\s*/, '').trim();
      if (item && item !== '-') {
        blockers.push(item);
      }
    }
  }

  return { date, filePath, content, achievements, blockers };
}

/**
 * Get project metadata for connection verification.
 */
export function getProjectInfo(ctx: McpContext): ProjectInfo {
  const taskCountStmt = ctx.db.prepare('SELECT COUNT(*) as cnt FROM tasks');
  let taskCount = 0;
  if (taskCountStmt.step()) {
    taskCount = (taskCountStmt.getAsObject() as { cnt: number }).cnt || 0;
  }
  taskCountStmt.free();

  const krCountStmt = ctx.db.prepare('SELECT COUNT(*) as cnt FROM key_results');
  let krCount = 0;
  if (krCountStmt.step()) {
    krCount = (krCountStmt.getAsObject() as { cnt: number }).cnt || 0;
  }
  krCountStmt.free();

  // Extract project name from rootPath
  const name = path.basename(ctx.rootPath) || ctx.rootPath;

  return {
    name,
    rootPath: ctx.rootPath,
    taskCount,
    krCount,
  };
}
