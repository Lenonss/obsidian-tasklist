import type { McpContext, TaskRow } from '../types.js';

export interface TaskItem {
  id: string;
  title: string;
  content: string;
  status: string;
  priority: string;
  date: string;
  dateEnd: string;
  type: string;
  sourceFile: string;
}

export interface TaskStats {
  total: number;
  done: number;
  blocked: number;
  inProgress: number;
  completionRate: number;
  trend: { date: string; done: number }[];
}

function rowToTask(row: TaskRow): TaskItem {
  return {
    id: row.id,
    title: row.title,
    content: row.content || '',
    status: row.status || 'pending',
    priority: row.priority || 'medium',
    date: row.date || '',
    dateEnd: row.date_end || '',
    type: row.type || 'todo',
    sourceFile: row.source_file || '',
  };
}

export function getTasksByDateRange(
  ctx: McpContext,
  startDate: string,
  endDate: string,
  taskType?: string
): TaskItem[] {
  let sql = `
    SELECT id, title, content, status, priority, created_at, updated_at,
           date, date_end, type, source_file
    FROM tasks
    WHERE date != '' AND date <= ?
      AND (date_end = '' AND date >= ? OR date_end != '' AND date_end >= ?)
  `;
  const params: string[] = [endDate, startDate, startDate];

  if (taskType) {
    sql += ' AND type = ?';
    params.push(taskType);
  }

  sql += ' ORDER BY date ASC, priority ASC, updated_at DESC';

  const stmt = ctx.db.prepare(sql);
  stmt.bind(params);

  const tasks: TaskItem[] = [];
  while (stmt.step()) {
    tasks.push(rowToTask(stmt.getAsObject() as unknown as TaskRow));
  }
  stmt.free();

  return tasks;
}

export function getTaskStats(
  ctx: McpContext,
  startDate: string,
  endDate: string
): TaskStats {
  const allTasks = getTasksByDateRange(ctx, startDate, endDate);
  const done = allTasks.filter(
    t => t.status === 'done' || t.type === 'achievement'
  ).length;
  const blocked = allTasks.filter(t => t.type === 'blocker').length;
  const inProgress = allTasks.filter(
    t => t.status === 'in-progress' && t.type !== 'blocker'
  ).length;
  const nonBlocked = allTasks.length - blocked;
  const completionRate = nonBlocked > 0 ? Math.round((done / nonBlocked) * 100) : 0;

  // Build daily trend
  const trendMap = new Map<string, number>();
  for (const t of allTasks) {
    if (!t.date) continue;
    if (t.status === 'done' || t.type === 'achievement') {
      trendMap.set(t.date, (trendMap.get(t.date) || 0) + 1);
    }
  }
  const trend: { date: string; done: number }[] = [];
  for (const [date, done] of trendMap) {
    trend.push({ date, done });
  }
  trend.sort((a, b) => a.date.localeCompare(b.date));

  return {
    total: allTasks.length,
    done,
    blocked,
    inProgress,
    completionRate,
    trend,
  };
}
