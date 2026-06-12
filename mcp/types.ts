import type { Database as SqlDatabase, SqlJsStatic } from 'sql.js';

export interface McpContext {
  db: SqlDatabase;
  rootPath: string;
  SQL: SqlJsStatic;
}

export interface TaskRow {
  id: string;
  title: string;
  content: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  date: string;
  date_end: string;
  type: string;
  source_file: string;
}

export interface ObjectiveRow {
  id: string;
  uuid: string;
  year: number;
  quarter: number;
  text: string;
  title: string;
  progress: number;
  score: number;
  weight: number;
  source_file: string;
  created_at: string;
  updated_at: string;
}

export interface KeyResultRow {
  id: string;
  uuid: string;
  objective_id: string;
  text: string;
  title: string;
  target: string;
  progress: number;
  score: number;
  weight: number;
  today: string;
  owner: string;
  source_file: string;
  created_at: string;
  updated_at: string;
}
