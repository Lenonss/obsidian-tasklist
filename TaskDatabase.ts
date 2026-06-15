import { normalizePath, DataAdapter } from 'obsidian';
import { Task, TaskStatus, Objective, KeyResult } from './types';
import { generateUUID, getNowISO } from './utils';
import { initSqlWithWasm } from './wasm-embed';
import type { Database as SqlDatabase, SqlJsStatic } from 'sql.js';

// Schema
const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    priority TEXT DEFAULT 'medium',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at);`,
].join('\n');

// Schema v2: daily report fields + OKR tables
const SCHEMA_V2_SQL = [
  // Extend tasks table (idempotent: errors on duplicate columns are caught)
  `ALTER TABLE tasks ADD COLUMN date TEXT DEFAULT '';`,
  `ALTER TABLE tasks ADD COLUMN type TEXT DEFAULT 'todo';`,
  `ALTER TABLE tasks ADD COLUMN source_file TEXT DEFAULT '';`,
  // OKR tables
  `CREATE TABLE IF NOT EXISTS objectives (
    id TEXT PRIMARY KEY,
    year INTEGER NOT NULL,
    quarter INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS key_results (
    id TEXT PRIMARY KEY,
    objective_id TEXT NOT NULL,
    text TEXT NOT NULL,
    target TEXT DEFAULT '',
    progress INTEGER DEFAULT 0,
    today TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (objective_id) REFERENCES objectives(id)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(type);`,
  `CREATE INDEX IF NOT EXISTS idx_kr_objective ON key_results(objective_id);`,
].join('\n');

// Schema v3: source_file columns + composite index
const SCHEMA_V3_SQL = [
  `ALTER TABLE objectives ADD COLUMN source_file TEXT DEFAULT '';`,
  `ALTER TABLE key_results ADD COLUMN source_file TEXT DEFAULT '';`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_date_type ON tasks(date, type);`,
].join('\n');

// Schema v4: date_end column for task date ranges
const SCHEMA_V4_SQL = [
  `ALTER TABLE tasks ADD COLUMN date_end TEXT DEFAULT '';`,
].join('\n');

// Schema v5: UUID + title + score + weight for OKR tables
const SCHEMA_V5_SQL = [
  `ALTER TABLE objectives ADD COLUMN uuid TEXT DEFAULT '';`,
  `ALTER TABLE objectives ADD COLUMN title TEXT DEFAULT '';`,
  `ALTER TABLE objectives ADD COLUMN progress INTEGER DEFAULT 0;`,
  `ALTER TABLE objectives ADD COLUMN score REAL DEFAULT 0;`,
  `ALTER TABLE objectives ADD COLUMN weight REAL DEFAULT 0;`,
  `ALTER TABLE key_results ADD COLUMN uuid TEXT DEFAULT '';`,
  `ALTER TABLE key_results ADD COLUMN title TEXT DEFAULT '';`,
  `ALTER TABLE key_results ADD COLUMN score REAL DEFAULT 0;`,
  `ALTER TABLE key_results ADD COLUMN weight REAL DEFAULT 0;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_objectives_uuid ON objectives(uuid);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_keyresults_uuid ON key_results(uuid);`,
].join('\n');

// Schema v6: task types + parent-child hierarchy
const SCHEMA_V6_SQL = [
  `ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'text';`,
  `ALTER TABLE tasks ADD COLUMN progress_value INTEGER DEFAULT 0;`,
  `CREATE TABLE IF NOT EXISTS task_relations (
    id TEXT PRIMARY KEY,
    parent_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    child_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0
  );`,
  `CREATE INDEX IF NOT EXISTS idx_task_relations_parent ON task_relations(parent_id);`,
  `CREATE INDEX IF NOT EXISTS idx_task_relations_child ON task_relations(child_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_task_relations_pair ON task_relations(parent_id, child_id);`,
].join('\n');

// Schema version meta table
const SCHEMA_META_SQL = [
  `CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );`,
  `INSERT OR IGNORE INTO schema_meta (key, value) VALUES ('version', '1');`,
].join('\n');

export class TaskDatabase {
  private dbPath: string;
  private vaultAdapter: DataAdapter;
  private SQL: SqlJsStatic | null = null;
  private db: SqlDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(dbPath: string, vaultAdapter: DataAdapter) {
    this.dbPath = dbPath;
    this.vaultAdapter = vaultAdapter;
  }

  /**
   * Initialize the SQLite database: load WASM, open/create DB, run schema.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  private async ensureInit(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    try {
      // 1. Initialize SQL.js with embedded WASM (no external file needed)
      const sql: SqlJsStatic = await initSqlWithWasm();
      this.SQL = sql;

      // 2. Load or create the database file
      const dbPath = this.getDatabasePath();
      try {
        const existingData =
          await this.vaultAdapter.readBinary(dbPath);
        this.db = new this.SQL!.Database(new Uint8Array(existingData));
      } catch {
        // File doesn't exist or can't be read — create a new database
        await this.ensureDatabaseParentDir(dbPath);
        this.db = new this.SQL!.Database();
      }

      // 3. Create schema (idempotent: IF NOT EXISTS)
      this.db.run(SCHEMA_SQL);

      // 3b. Schema meta tracking (always run)
      this.db.run(SCHEMA_META_SQL);

      // 3c. Auto-migrate to v2 if needed
      await this.migrateSchemaV2();

      // 3d. Auto-migrate to v3 if needed
      await this.migrateSchemaV3();

      // 3e. Auto-migrate to v4 if needed
      await this.migrateSchemaV4();

      // 3f. Auto-migrate to v5 if needed
      await this.migrateSchemaV5();

      // 3g. Auto-migrate to v6 if needed
      await this.migrateSchemaV6();

      // 5. Persist the initial database file if it was just created
      await this.persistDatabase();
    } catch (error) {
      console.error('TaskList: Failed to initialize database:', error);
      this.initPromise = null;
      this.db = null;
      this.SQL = null;
      throw error;
    }
  }

  /**
   * Persist the in-memory SQLite database to the vault file.
   */
  private async persistDatabase(): Promise<void> {
    if (!this.db) return;

    const dbPath = this.getDatabasePath();
    const data = this.db.export();
    // Convert Uint8Array to a properly-sized ArrayBuffer
    const buffer = new Uint8Array(data).buffer;

    await this.vaultAdapter.writeBinary(dbPath, buffer);
  }

  // ───── Public API ─────

  /**
   * Read all tasks from the database.
   */
  async readTasks(): Promise<Task[]> {
    await this.ensureInit();
    if (!this.db) return [];

    const stmt = this.db.prepare(
      'SELECT id, title, content, task_type, progress_value, status, priority, created_at, updated_at, date, date_end, type, source_file FROM tasks ORDER BY priority ASC, updated_at DESC'
    );

    const tasks: Task[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      tasks.push(this.rowToTask(row));
    }
    stmt.free();

    return tasks;
  }

  /**
   * Add a new task. Returns the created task with auto-generated ID and timestamps.
   */
  async addTask(
    input: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Task> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    const task: Task = {
      ...input,
      id: generateUUID(),
      createdAt: getNowISO(),
      updatedAt: getNowISO(),
    };

    this.db.run(
      'INSERT INTO tasks (id, title, content, task_type, progress_value, status, priority, date, date_end, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        task.id,
        task.title,
        task.content,
        task.taskType || 'text',
        task.progressValue ?? 0,
        task.status,
        task.priority,
        task.date || '',
        task.dateEnd || '',
        task.createdAt,
        task.updatedAt,
      ]
    );

    await this.persistDatabase();
    return task;
  }

  /**
   * Update an existing task by ID. Returns true if the task was found and updated.
   */
  async updateTask(task: Task): Promise<boolean> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    const now = getNowISO();
    this.db.run(
      'UPDATE tasks SET title = ?, content = ?, task_type = ?, progress_value = ?, status = ?, priority = ?, updated_at = ? WHERE id = ?',
      [task.title, task.content, task.taskType || 'text', task.progressValue ?? 0, task.status, task.priority, now, task.id]
    );

    const changes = this.db.getRowsModified();
    if (changes > 0) {
      await this.persistDatabase();
      return true;
    }

    return false;
  }

  /**
   * Delete a task by ID. Returns true if the task was found and deleted.
   */
  async deleteTask(taskId: string): Promise<boolean> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    // Cascade: remove relations first
    this.db.run('DELETE FROM task_relations WHERE parent_id = ? OR child_id = ?', [taskId, taskId]);

    this.db.run('DELETE FROM tasks WHERE id = ?', [taskId]);

    const changes = this.db.getRowsModified();
    if (changes > 0) {
      await this.persistDatabase();
      return true;
    }

    return false;
  }

  // ───── Task Relations ─────

  /**
   * Add a parent-child relation between two tasks.
   */
  async addRelation(parentId: string, childId: string, sortOrder?: number): Promise<void> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    const id = generateUUID();
    const order = sortOrder ?? 0;
    this.db.run(
      'INSERT OR IGNORE INTO task_relations (id, parent_id, child_id, sort_order) VALUES (?, ?, ?, ?)',
      [id, parentId, childId, order]
    );
    await this.persistDatabase();
  }

  /**
   * Remove a parent-child relation by relation ID.
   */
  async removeRelation(relationId: string): Promise<void> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    this.db.run('DELETE FROM task_relations WHERE id = ?', [relationId]);
    await this.persistDatabase();
  }

  /**
   * Find the relation ID for a parent-child pair.
   */
  async getRelationId(parentId: string, childId: string): Promise<string | null> {
    await this.ensureInit();
    if (!this.db) return null;

    const stmt = this.db.prepare(
      'SELECT id FROM task_relations WHERE parent_id = ? AND child_id = ?',
      [parentId, childId]
    );
    if (stmt.step()) {
      const id = stmt.getAsObject().id as string;
      stmt.free();
      return id;
    }
    stmt.free();
    return null;
  }

  /**
   * Get all child tasks of a parent, ordered by sort_order.
   */
  async getChildren(parentId: string): Promise<Task[]> {
    await this.ensureInit();
    if (!this.db) return [];

    const stmt = this.db.prepare(
      `SELECT t.id, t.title, t.content, t.task_type, t.progress_value,
              t.status, t.priority, t.created_at, t.updated_at,
              t.date, t.date_end, t.type, t.source_file
       FROM task_relations tr
       JOIN tasks t ON t.id = tr.child_id
       WHERE tr.parent_id = ?
       ORDER BY tr.sort_order ASC`,
      [parentId]
    );

    const tasks: Task[] = [];
    while (stmt.step()) {
      tasks.push(this.rowToTask(stmt.getAsObject()));
    }
    stmt.free();
    return tasks;
  }

  /**
   * Get the parent task of a child, or null if it has no parent.
   */
  async getParent(childId: string): Promise<Task | null> {
    await this.ensureInit();
    if (!this.db) return null;

    const stmt = this.db.prepare(
      `SELECT t.id, t.title, t.content, t.task_type, t.progress_value,
              t.status, t.priority, t.created_at, t.updated_at,
              t.date, t.date_end, t.type, t.source_file
       FROM task_relations tr
       JOIN tasks t ON t.id = tr.parent_id
       WHERE tr.child_id = ?
       LIMIT 1`,
      [childId]
    );

    if (stmt.step()) {
      const task = this.rowToTask(stmt.getAsObject());
      stmt.free();
      return task;
    }
    stmt.free();
    return null;
  }

  /**
   * Get all ancestor IDs of a task, ordered from direct parent to root.
   * Used for depth checking. Stops if it encounters stopAtId (cycle detection).
   */
  async getAncestorIds(taskId: string, stopAtId?: string): Promise<string[]> {
    await this.ensureInit();
    if (!this.db) return [];

    const ancestors: string[] = [];
    const visited = new Set<string>([taskId]);
    let currentId = taskId;

    while (true) {
      const stmt = this.db.prepare(
        'SELECT parent_id FROM task_relations WHERE child_id = ? LIMIT 1',
        [currentId]
      );
      if (!stmt.step()) {
        stmt.free();
        break;
      }
      const parentId = stmt.getAsObject().parent_id as string;
      stmt.free();

      if (stopAtId && parentId === stopAtId) break;
      if (visited.has(parentId)) break; // cycle detection
      visited.add(parentId);
      ancestors.push(parentId);
      currentId = parentId;
    }

    return ancestors;
  }

  /**
   * Get all child relation IDs for a parent, ordered by sort_order.
   * Returns array of {id, childId, sortOrder}.
   */
  async getChildRelations(parentId: string): Promise<{ id: string; childId: string; sortOrder: number }[]> {
    await this.ensureInit();
    if (!this.db) return [];

    const stmt = this.db.prepare(
      'SELECT id, child_id, sort_order FROM task_relations WHERE parent_id = ? ORDER BY sort_order ASC',
      [parentId]
    );

    const results: { id: string; childId: string; sortOrder: number }[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row['id'] as string,
        childId: row['child_id'] as string,
        sortOrder: row['sort_order'] as number,
      });
    }
    stmt.free();
    return results;
  }

  /**
   * Swap sort_order of two sibling relations (for up/down reordering).
   */
  async swapSortOrder(relationId1: string, relationId2: string): Promise<void> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    const getOrder = (id: string): number | null => {
      const stmt = this.db!.prepare('SELECT sort_order FROM task_relations WHERE id = ?', [id]);
      if (stmt.step()) {
        const val = stmt.getAsObject().sort_order as number;
        stmt.free();
        return val;
      }
      stmt.free();
      return null;
    };

    const order1 = getOrder(relationId1);
    const order2 = getOrder(relationId2);
    if (order1 === null || order2 === null) return;

    this.db.run('UPDATE task_relations SET sort_order = ? WHERE id = ?', [order2, relationId1]);
    this.db.run('UPDATE task_relations SET sort_order = ? WHERE id = ?', [order1, relationId2]);
    await this.persistDatabase();
  }

  /**
   * Delete all relations where a task is the parent.
   */
  async deleteChildrenByParentId(parentId: string): Promise<void> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    this.db.run('DELETE FROM task_relations WHERE parent_id = ?', [parentId]);
    await this.persistDatabase();
  }

  /**
   * Calculate and update the progress_value of a parent task
   * based on the completion rate of its children.
   * Cascades upward to ancestor parents.
   */
  async calculateParentProgress(parentId: string): Promise<void> {
    await this.ensureInit();
    if (!this.db) return;

    const children = await this.getChildren(parentId);
    const total = children.length;
    const done = children.filter(c => c.status === 'done').length;
    const progress = total === 0 ? 0 : Math.round((done / total) * 100);

    this.db.run(
      'UPDATE tasks SET progress_value = ?, updated_at = ? WHERE id = ?',
      [progress, getNowISO(), parentId]
    );

    // Cascade upward: if this parent has a parent, update it too
    const grandParent = await this.getParent(parentId);
    if (grandParent) {
      await this.calculateParentProgress(grandParent.id);
    }

    await this.persistDatabase();
  }

  /**
   * Cycle task status: pending → in-progress → done → pending.
   */
  async cycleTaskStatus(taskId: string): Promise<boolean> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    // Read current status
    const stmt = this.db.prepare(
      'SELECT status FROM tasks WHERE id = ?',
      [taskId]
    );
    if (!stmt.step()) {
      stmt.free();
      return false;
    }
    const currentStatus = stmt.getAsObject().status as TaskStatus;
    stmt.free();

    // Compute next status
    let newStatus: TaskStatus;
    switch (currentStatus) {
      case 'pending':
        newStatus = 'in-progress';
        break;
      case 'in-progress':
        newStatus = 'done';
        break;
      case 'done':
        newStatus = 'pending';
        break;
      default:
        newStatus = 'pending';
    }

    // Update
    const now = getNowISO();
    this.db.run(
      'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?',
      [newStatus, now, taskId]
    );

    if (this.db.getRowsModified() > 0) {
      await this.persistDatabase();
      return true;
    }

    return false;
  }

  /**
   * Close the database and free resources.
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.persistDatabase();
      this.db.close();
      this.db = null;
      this.SQL = null;
      this.initPromise = null;
    }
  }

  /**
   * Auto-migrate schema from v1 to v2.
   * Runs SCHEMA_V2_SQL idempotently (ALTER TABLE may fail if columns exist, caught).
   */
  private async migrateSchemaV2(): Promise<void> {
    if (!this.db) return;

    // Check current version
    const versionStmt = this.db.prepare(
      "SELECT value FROM schema_meta WHERE key = 'version'"
    );
    let currentVersion = '1';
    if (versionStmt.step()) {
      currentVersion = versionStmt.getAsObject().value as string;
    }
    versionStmt.free();

    if (currentVersion !== '2') {
      try {
        // Run v2 schema statements individually (ALTER may fail on existing columns)
        const stmts = SCHEMA_V2_SQL.split(';\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const sql of stmts) {
          try {
            this.db.run(sql + ';');
          } catch {
            // Column may already exist — ignore and continue
          }
        }
        this.db.run(
          "UPDATE schema_meta SET value = '2' WHERE key = 'version'"
        );
        await this.persistDatabase();
        console.log('TaskList: Schema migrated to v2');
      } catch (error) {
        console.error('TaskList: Schema v2 migration failed:', error);
      }
    }
  }

  /**
   * Auto-migrate schema from v2 to v3.
   * Adds source_file to objectives/key_results, composite index on tasks(date, type).
   */
  private async migrateSchemaV3(): Promise<void> {
    if (!this.db) return;

    const versionStmt = this.db.prepare(
      "SELECT value FROM schema_meta WHERE key = 'version'"
    );
    let currentVersion = '1';
    if (versionStmt.step()) {
      currentVersion = versionStmt.getAsObject().value as string;
    }
    versionStmt.free();

    if (currentVersion !== '3') {
      try {
        const stmts = SCHEMA_V3_SQL.split(';\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const sql of stmts) {
          try {
            this.db.run(sql + ';');
          } catch {
            // Column may already exist — ignore and continue
          }
        }
        this.db.run(
          "UPDATE schema_meta SET value = '3' WHERE key = 'version'"
        );
        await this.persistDatabase();
        console.log('TaskList: Schema migrated to v3');
      } catch (error) {
        console.error('TaskList: Schema v3 migration failed:', error);
      }
    }
  }

  /**
   * Auto-migrate schema from v3 to v4.
   * Adds date_end column for task date ranges.
   */
  private async migrateSchemaV4(): Promise<void> {
    if (!this.db) return;

    const versionStmt = this.db.prepare(
      "SELECT value FROM schema_meta WHERE key = 'version'"
    );
    let currentVersion = '1';
    if (versionStmt.step()) {
      currentVersion = versionStmt.getAsObject().value as string;
    }
    versionStmt.free();

    if (currentVersion !== '4') {
      try {
        const stmts = SCHEMA_V4_SQL.split(';\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const sql of stmts) {
          try {
            this.db.run(sql + ';');
          } catch {
            // Column may already exist — ignore and continue
          }
        }
        this.db.run(
          "UPDATE schema_meta SET value = '4' WHERE key = 'version'"
        );
        await this.persistDatabase();
        console.log('TaskList: Schema migrated to v4');
      } catch (error) {
        console.error('TaskList: Schema v4 migration failed:', error);
      }
    }
  }

  /**
   * Auto-migrate schema from v4 to v5.
   * Adds uuid, title, score, weight, progress to OKR tables + backfills UUIDs.
   */
  private async migrateSchemaV5(): Promise<void> {
    if (!this.db) return;

    const versionStmt = this.db.prepare(
      "SELECT value FROM schema_meta WHERE key = 'version'"
    );
    let currentVersion = '1';
    if (versionStmt.step()) {
      currentVersion = versionStmt.getAsObject().value as string;
    }
    versionStmt.free();

    if (currentVersion !== '5') {
      try {
        // Run v5 DDL statements
        const stmts = SCHEMA_V5_SQL.split(';\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const sql of stmts) {
          try {
            this.db.run(sql + ';');
          } catch {
            // Column may already exist — ignore and continue
          }
        }

        // Backfill UUIDs for existing objectives
        const objStmt = this.db.prepare(
          "SELECT id FROM objectives WHERE uuid = '' OR uuid IS NULL"
        );
        const objIds: string[] = [];
        while (objStmt.step()) {
          objIds.push(objStmt.getAsObject().id as string);
        }
        objStmt.free();

        for (const objId of objIds) {
          const uuid = generateUUID();
          this.db.run('UPDATE objectives SET uuid = ? WHERE id = ?', [uuid, objId]);
        }

        // Backfill UUIDs for existing KRs
        const krStmt = this.db.prepare(
          "SELECT id FROM key_results WHERE uuid = '' OR uuid IS NULL"
        );
        const krIds: string[] = [];
        while (krStmt.step()) {
          krIds.push(krStmt.getAsObject().id as string);
        }
        krStmt.free();

        for (const krId of krIds) {
          const uuid = generateUUID();
          this.db.run('UPDATE key_results SET uuid = ? WHERE id = ?', [uuid, krId]);
        }

        // Backfill title for objectives and KRs from text field
        this.db.run("UPDATE objectives SET title = text WHERE title = '' OR title IS NULL");
        this.db.run("UPDATE key_results SET title = text WHERE title = '' OR title IS NULL");

        this.db.run(
          "UPDATE schema_meta SET value = '5' WHERE key = 'version'"
        );
        await this.persistDatabase();
        console.log('TaskList: Schema migrated to v5');
      } catch (error) {
        console.error('TaskList: Schema v5 migration failed:', error);
      }
    }
  }

  /**
   * Auto-migrate schema from v5 to v6.
   * Adds task_type, progress_value columns and task_relations table.
   */
  private async migrateSchemaV6(): Promise<void> {
    if (!this.db) return;

    const versionStmt = this.db.prepare(
      "SELECT value FROM schema_meta WHERE key = 'version'"
    );
    let currentVersion = '1';
    if (versionStmt.step()) {
      currentVersion = versionStmt.getAsObject().value as string;
    }
    versionStmt.free();

    if (currentVersion !== '6') {
      try {
        const stmts = SCHEMA_V6_SQL.split(';\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const sql of stmts) {
          try {
            this.db.run(sql + ';');
          } catch {
            // Column may already exist — ignore and continue
          }
        }
        this.db.run(
          "UPDATE schema_meta SET value = '6' WHERE key = 'version'"
        );
        await this.persistDatabase();
        console.log('TaskList: Schema migrated to v6');
      } catch (error) {
        console.error('TaskList: Schema v6 migration failed:', error);
      }
    }
  }

  /**
   * Read tasks within a date range, optionally filtered by type.
   */
  async readTasksByDateRange(
    startDate: string,
    endDate: string,
    taskType?: string
  ): Promise<Task[]> {
    await this.ensureInit();
    if (!this.db) return [];

    let sql =
      'SELECT id, title, content, task_type, progress_value, status, priority, created_at, updated_at, date, date_end, type, source_file FROM tasks WHERE date != ? AND date <= ?';
    const params: string[] = ['', endDate];

    // Range-overlap logic:
    // Single-day tasks: date_end is empty, date must be >= startDate
    // Range tasks: date_end is set, date_end must be >= startDate
    // Both require date <= endDate (already in WHERE)
    sql += ' AND (date_end = ? AND date >= ? OR date_end != ? AND date_end >= ?)';
    params.push('', startDate, '', startDate);

    if (taskType) {
      sql += ' AND type = ?';
      params.push(taskType);
    }

    sql += ' ORDER BY date ASC, priority ASC, updated_at DESC';

    const stmt = this.db.prepare(sql);
    stmt.bind(params);

    const tasks: Task[] = [];
    while (stmt.step()) {
      tasks.push(this.rowToTask(stmt.getAsObject()));
    }
    stmt.free();

    return tasks;
  }

  /**
   * Read all tasks for a given date, all types.
   */
  async readTasksByDate(date: string): Promise<Task[]> {
    return this.readTasksByDateRange(date, date);
  }

  /**
   * Upsert a task from daily report (dedup by date + title + source_file + type).
   * Returns the task ID (existing or new).
   */
  async upsertDailyTask(task: {
    title: string;
    content: string;
    date: string;
    type: string;
    sourceFile: string;
    priority?: string;
    status?: string;
  }): Promise<string> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    // Check for existing task
    const existing = this.db.prepare(
      'SELECT id FROM tasks WHERE date = ? AND title = ? AND source_file = ? AND type = ?',
      [task.date, task.title, task.sourceFile, task.type]
    );
    const now = getNowISO();

    if (existing.step()) {
      const row = existing.getAsObject();
      const id = row.id as string;
      existing.free();

      // Update existing
      this.db.run(
        'UPDATE tasks SET content = ?, priority = ?, status = ?, updated_at = ? WHERE id = ?',
        [
          task.content,
          task.priority || 'medium',
          task.status || (task.type === 'achievement' ? 'done' : 'pending'),
          now,
          id,
        ]
      );
      await this.persistDatabase();
      return id;
    }
    existing.free();

    // Insert new
    const id = generateUUID();
    this.db.run(
      `INSERT INTO tasks (id, title, content, task_type, progress_value, status, priority, date, type, source_file, created_at, updated_at)
       VALUES (?, ?, ?, 'text', 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        task.title,
        task.content,
        task.status || (task.type === 'achievement' ? 'done' : 'pending'),
        task.priority || 'medium',
        task.date,
        task.type,
        task.sourceFile,
        now,
        now,
      ]
    );
    await this.persistDatabase();
    return id;
  }

  // ───── OKR CRUD ─────

  /**
   * Upsert an objective (dedup by id).
   */
  async upsertObjective(obj: {
    id: string;
    year: number;
    quarter: number;
    text: string;
    uuid?: string;
    title?: string;
    progress?: number;
    score?: number;
    weight?: number;
    sourceFile?: string;
  }): Promise<void> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');
    const now = getNowISO();

    const existing = this.db.prepare(
      'SELECT id, uuid FROM objectives WHERE id = ?',
      [obj.id]
    );
    if (existing.step()) {
      const row = existing.getAsObject();
      const existingUuid = (row.uuid as string) || '';
      existing.free();
      const newUuid = obj.uuid || existingUuid || generateUUID();
      this.db.run(
        'UPDATE objectives SET uuid = ?, year = ?, quarter = ?, text = ?, title = ?, progress = ?, score = ?, weight = ?, source_file = ?, updated_at = ? WHERE id = ?',
        [
          newUuid,
          obj.year,
          obj.quarter,
          obj.text,
          obj.title || obj.text,
          obj.progress ?? 0,
          obj.score ?? 0,
          obj.weight ?? 0,
          obj.sourceFile || '',
          now,
          obj.id,
        ]
      );
    } else {
      existing.free();
      const newUuid = obj.uuid || generateUUID();
      this.db.run(
        'INSERT INTO objectives (id, uuid, year, quarter, text, title, progress, score, weight, source_file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [obj.id, newUuid, obj.year, obj.quarter, obj.text, obj.title || obj.text, obj.progress ?? 0, obj.score ?? 0, obj.weight ?? 0, obj.sourceFile || '', now, now]
      );
    }
    await this.persistDatabase();
  }

  /**
   * Upsert a key result (dedup by id).
   */
  async upsertKeyResult(kr: {
    id: string;
    objectiveId: string;
    text: string;
    uuid?: string;
    title?: string;
    target?: string;
    score?: number;
    weight?: number;
    owner?: string;
    sourceFile?: string;
  }): Promise<void> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');
    const now = getNowISO();

    const existing = this.db.prepare(
      'SELECT id, uuid FROM key_results WHERE id = ?',
      [kr.id]
    );
    if (existing.step()) {
      const row = existing.getAsObject();
      const existingUuid = (row.uuid as string) || '';
      existing.free();
      const newUuid = kr.uuid || existingUuid || generateUUID();
      this.db.run(
        'UPDATE key_results SET uuid = ?, objective_id = ?, text = ?, title = ?, target = ?, score = ?, weight = ?, owner = ?, source_file = ?, updated_at = ? WHERE id = ?',
        [
          newUuid,
          kr.objectiveId,
          kr.text,
          kr.title || kr.text,
          kr.target || '',
          kr.score ?? 0,
          kr.weight ?? 0,
          kr.owner || '',
          kr.sourceFile || '',
          now,
          kr.id,
        ]
      );
    } else {
      existing.free();
      const newUuid = kr.uuid || generateUUID();
      this.db.run(
        `INSERT INTO key_results (id, uuid, objective_id, text, title, target, progress, score, weight, today, owner, source_file, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, '', ?, ?, ?, ?)`,
        [
          kr.id,
          newUuid,
          kr.objectiveId,
          kr.text,
          kr.title || kr.text,
          kr.target || '',
          kr.score ?? 0,
          kr.weight ?? 0,
          kr.owner || '',
          kr.sourceFile || '',
          now,
          now,
        ]
      );
    }
    await this.persistDatabase();
  }

  /**
   * Read all objectives for a given year and quarter.
   */
  async readObjectives(year: number, quarter: number): Promise<Objective[]> {
    await this.ensureInit();
    if (!this.db) return [];

    const stmt = this.db.prepare(
      'SELECT id, uuid, year, quarter, text, title, progress, score, weight, source_file, created_at, updated_at FROM objectives WHERE year = ? AND quarter = ? ORDER BY id',
      [year, quarter]
    );
    const results: Objective[] = [];
    while (stmt.step()) {
      results.push(this.rowToObjective(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  /**
   * Read all objectives across all years and quarters.
   */
  async readAllObjectives(): Promise<Objective[]> {
    await this.ensureInit();
    if (!this.db) return [];

    const stmt = this.db.prepare(
      'SELECT id, uuid, year, quarter, text, title, progress, score, weight, source_file, created_at, updated_at FROM objectives ORDER BY year DESC, quarter DESC, id'
    );
    const results: Objective[] = [];
    while (stmt.step()) {
      results.push(this.rowToObjective(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  /**
   * Read all key results for a given objective.
   */
  async readKeyResults(objectiveId: string): Promise<KeyResult[]> {
    await this.ensureInit();
    if (!this.db) return [];

    const stmt = this.db.prepare(
      'SELECT id, uuid, objective_id, text, title, target, progress, score, weight, today, owner, source_file, created_at, updated_at FROM key_results WHERE objective_id = ? ORDER BY id',
      [objectiveId]
    );
    const results: KeyResult[] = [];
    while (stmt.step()) {
      results.push(this.rowToKeyResult(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  /**
   * Read key results by specific IDs.
   */
  async readKeyResultsByIds(ids: string[]): Promise<KeyResult[]> {
    await this.ensureInit();
    if (!this.db) return [];
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `SELECT id, uuid, objective_id, text, title, target, progress, score, weight, today, owner, source_file, created_at, updated_at
       FROM key_results WHERE id IN (${placeholders}) ORDER BY id`,
      ids
    );
    const results: KeyResult[] = [];
    while (stmt.step()) {
      results.push(this.rowToKeyResult(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  /**
   * Read a single objective by UUID.
   */
  async readObjectiveByUuid(uuid: string): Promise<Objective | null> {
    await this.ensureInit();
    if (!this.db) return null;

    const stmt = this.db.prepare(
      'SELECT id, uuid, year, quarter, text, title, progress, score, weight, source_file, created_at, updated_at FROM objectives WHERE uuid = ?',
      [uuid]
    );
    if (stmt.step()) {
      const obj = this.rowToObjective(stmt.getAsObject());
      stmt.free();
      return obj;
    }
    stmt.free();
    return null;
  }

  /**
   * Read key results by UUID list.
   */
  async readKeyResultsByUuids(uuids: string[]): Promise<KeyResult[]> {
    await this.ensureInit();
    if (!this.db) return [];
    if (uuids.length === 0) return [];

    const placeholders = uuids.map(() => '?').join(',');
    const stmt = this.db.prepare(
      `SELECT id, uuid, objective_id, text, title, target, progress, score, weight, today, owner, source_file, created_at, updated_at
       FROM key_results WHERE uuid IN (${placeholders}) ORDER BY id`,
      uuids
    );
    const results: KeyResult[] = [];
    while (stmt.step()) {
      results.push(this.rowToKeyResult(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  }

  /**
   * Update objective config fields (title, score, weight, progress) by UUID.
   */
  async updateObjectiveConfig(
    uuid: string,
    fields: {
      title?: string;
      score?: number;
      weight?: number;
      progress?: number;
    }
  ): Promise<boolean> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    const now = getNowISO();
    const sets: string[] = ['updated_at = ?'];
    const params: (string | number)[] = [now];

    if (fields.title !== undefined) {
      sets.push('title = ?');
      params.push(fields.title);
    }
    if (fields.score !== undefined) {
      sets.push('score = ?');
      params.push(fields.score);
    }
    if (fields.weight !== undefined) {
      sets.push('weight = ?');
      params.push(fields.weight);
    }
    if (fields.progress !== undefined) {
      sets.push('progress = ?');
      params.push(fields.progress);
    }

    params.push(uuid);
    this.db.run(
      `UPDATE objectives SET ${sets.join(', ')} WHERE uuid = ?`,
      params
    );

    if (this.db.getRowsModified() > 0) {
      await this.persistDatabase();
      return true;
    }
    return false;
  }

  /**
   * Update key result config fields (title, score, weight, progress, today) by UUID.
   */
  async updateKRConfig(
    uuid: string,
    fields: {
      title?: string;
      score?: number;
      weight?: number;
      progress?: number;
      today?: string;
    }
  ): Promise<boolean> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    const now = getNowISO();
    const sets: string[] = ['updated_at = ?'];
    const params: (string | number)[] = [now];

    if (fields.title !== undefined) {
      sets.push('title = ?');
      params.push(fields.title);
    }
    if (fields.score !== undefined) {
      sets.push('score = ?');
      params.push(fields.score);
    }
    if (fields.weight !== undefined) {
      sets.push('weight = ?');
      params.push(fields.weight);
    }
    if (fields.progress !== undefined) {
      sets.push('progress = ?');
      params.push(fields.progress);
    }
    if (fields.today !== undefined) {
      sets.push('today = ?');
      params.push(fields.today);
    }

    params.push(uuid);
    this.db.run(
      `UPDATE key_results SET ${sets.join(', ')} WHERE uuid = ?`,
      params
    );

    if (this.db.getRowsModified() > 0) {
      await this.persistDatabase();
      return true;
    }
    return false;
  }

  /**
   * Update a key result's progress and today's update text.
   */
  async updateKRProgress(
    krId: string,
    progress: number,
    today: string
  ): Promise<boolean> {
    await this.ensureInit();
    if (!this.db) throw new Error('Database not initialized');

    const now = getNowISO();
    this.db.run(
      'UPDATE key_results SET progress = ?, today = ?, updated_at = ? WHERE id = ?',
      [progress, today, now, krId]
    );

    if (this.db.getRowsModified() > 0) {
      await this.persistDatabase();
      return true;
    }
    return false;
  }

  // ───── Helpers ─────

  /**
   * Convert raw SQL row to KeyResult.
   */
  private rowToKeyResult(row: Record<string, unknown>): KeyResult {
    return {
      id: row['id'] as string,
      uuid: (row['uuid'] as string) || '',
      objectiveId: row['objective_id'] as string,
      text: row['text'] as string,
      title: (row['title'] as string) || (row['text'] as string) || '',
      target: (row['target'] as string) || '',
      progress: (row['progress'] as number) || 0,
      score: (row['score'] as number) || 0,
      weight: (row['weight'] as number) || 0,
      today: (row['today'] as string) || '',
      owner: (row['owner'] as string) || '',
      sourceFile: (row['source_file'] as string) || '',
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  /**
   * Convert raw SQL row to Objective.
   */
  private rowToObjective(row: Record<string, unknown>): Objective {
    return {
      id: row['id'] as string,
      uuid: (row['uuid'] as string) || '',
      year: row['year'] as number,
      quarter: row['quarter'] as number,
      text: row['text'] as string,
      title: (row['title'] as string) || (row['text'] as string) || '',
      progress: (row['progress'] as number) || 0,
      score: (row['score'] as number) || 0,
      weight: (row['weight'] as number) || 0,
      sourceFile: (row['source_file'] as string) || '',
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
    };
  }

  // ───── Helpers

  /**
   * Get the normalized database file path from settings.
   */
  getDatabasePath(): string {
    return normalizePath(this.dbPath);
  }

  /**
   * Ensure parent directories exist for the database file.
   */
  private async ensureDatabaseParentDir(dbPath: string): Promise<void> {
    const parts = dbPath.split('/');
    parts.pop(); // Remove filename
    if (parts.length === 0) return;

    const parentPath = parts.join('/');
    const exists =
      await this.vaultAdapter.exists(parentPath);
    if (exists) return;

    // Create parent directories recursively
    const segments = parentPath.split('/');
    let current = '';
    for (const segment of segments) {
      if (!current) {
        current = segment;
      } else {
        current += '/' + segment;
      }
      const dirExists =
        await this.vaultAdapter.exists(current);
      if (!dirExists) {
        await this.vaultAdapter.mkdir(current);
      }
    }
  }

  /**
   * Convert a raw SQL row object to a Task.
   */
  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row['id'] as string,
      title: row['title'] as string,
      content: (row['content'] as string) || '',
      taskType: (row['task_type'] as Task['taskType']) || 'text',
      progressValue: (row['progress_value'] as number) || 0,
      status: (row['status'] as TaskStatus) || 'pending',
      priority: (row['priority'] as Task['priority']) || 'medium',
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
      date: (row['date'] as string) || undefined,
      dateEnd: (row['date_end'] as string) || undefined,
      type: (row['type'] as Task['type']) || 'todo',
      sourceFile: (row['source_file'] as string) || undefined,
    };
  }
}
