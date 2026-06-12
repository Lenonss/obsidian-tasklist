import type { McpContext, ObjectiveRow, KeyResultRow } from '../types.js';

export interface OkrObjective {
  id: string;
  uuid: string;
  year: number;
  quarter: number;
  text: string;
  title: string;
  progress: number;
  score: number;
  weight: number;
  sourceFile: string;
  keyResults: OkrKeyResult[];
}

export interface OkrKeyResult {
  id: string;
  uuid: string;
  text: string;
  title: string;
  target: string;
  progress: number;
  score: number;
  weight: number;
  today: string;
  owner: string;
  sourceFile: string;
}

export interface KrHistoryEntry {
  date: string;
  progress: number;
  today: string;
}

export function getOkrProgress(
  ctx: McpContext,
  year: number,
  quarter: number
): OkrObjective[] {
  const objStmt = ctx.db.prepare(`
    SELECT id, uuid, year, quarter, text, title, progress, score, weight,
           source_file, created_at, updated_at
    FROM objectives
    WHERE year = ? AND quarter = ?
    ORDER BY id
  `);
  objStmt.bind([year, quarter]);

  const objectives: OkrObjective[] = [];
  while (objStmt.step()) {
    const row = objStmt.getAsObject() as unknown as ObjectiveRow;
    const keyResults = getKeyResultsForObjective(ctx, row.id);
    objectives.push({
      id: row.id,
      uuid: row.uuid,
      year: row.year,
      quarter: row.quarter,
      text: row.text,
      title: row.title || row.text,
      progress: row.progress,
      score: row.score,
      weight: row.weight,
      sourceFile: row.source_file || '',
      keyResults,
    });
  }
  objStmt.free();

  return objectives;
}

function getKeyResultsForObjective(
  ctx: McpContext,
  objectiveId: string
): OkrKeyResult[] {
  const stmt = ctx.db.prepare(`
    SELECT id, uuid, objective_id, text, title, target, progress, score,
           weight, today, owner, source_file, created_at, updated_at
    FROM key_results
    WHERE objective_id = ?
    ORDER BY id
  `);
  stmt.bind([objectiveId]);

  const results: OkrKeyResult[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as KeyResultRow;
    results.push({
      id: row.id,
      uuid: row.uuid,
      text: row.text,
      title: row.title || row.text,
      target: row.target || '',
      progress: row.progress,
      score: row.score,
      weight: row.weight,
      today: row.today || '',
      owner: row.owner || '',
      sourceFile: row.source_file || '',
    });
  }
  stmt.free();
  return results;
}

export function getKrHistory(
  ctx: McpContext,
  krId: string
): KrHistoryEntry[] {
  // KR progress history comes from daily report frontmatter.
  // Since we don't have a dedicated history table, we return the
  // current progress as a single-entry history.
  // In the future, this could be enhanced by scanning daily report files.
  const stmt = ctx.db.prepare(`
    SELECT progress, today, updated_at FROM key_results WHERE id = ?
  `);
  stmt.bind([krId]);

  const entries: KrHistoryEntry[] = [];
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as KeyResultRow;
    entries.push({
      date: row.updated_at?.split('T')[0] || '',
      progress: row.progress || 0,
      today: row.today || '',
    });
  }
  stmt.free();
  return entries;
}
