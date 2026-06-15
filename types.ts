import { t } from './i18n';

export type TaskStatus = 'pending' | 'in-progress' | 'done';
export type Language = 'zh' | 'en';
export type TaskPriority = 'high' | 'medium' | 'low';
export type DailyTaskType = 'todo' | 'achievement' | 'blocker' | 'next';
export type TaskType = 'text' | 'progress' | 'parent';
export type TimeRange = 'week' | 'month' | 'quarter' | 'year';

export interface Task {
  id: string;
  title: string;
  content: string;
  taskType?: TaskType;
  progressValue?: number;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
  // Schema v2: daily report fields
  date?: string;
  dateEnd?: string;
  type?: DailyTaskType;
  sourceFile?: string;
}

export interface TaskRelation {
  id: string;
  parentId: string;
  childId: string;
  sortOrder: number;
}

export interface Objective {
  id: string;
  uuid: string;
  year: number;
  quarter: number;
  text: string;
  title: string;
  progress: number;
  score: number;
  weight: number;
  sourceFile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KeyResult {
  id: string;
  uuid: string;
  objectiveId: string;
  text: string;
  title: string;
  target: string;
  progress: number;
  score: number;
  weight: number;
  today: string;
  owner: string;
  sourceFile?: string;
  /** Runtime-only: parent objective text for UI display */
  _objectiveText?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkboardConfig {
  version: number;
  year: number;
  timeRange: TimeRange;
  showDashboard: boolean;
  maxCards: number;
  projectId?: string;
  activeTab?: 'calendar' | 'overview' | 'okr';
  data?: {
    dashboardCollapsed?: boolean;
    okrCollapsed?: boolean;
  };
}

export interface ProjectConfig {
  id: string;
  name: string;
  rootPath: string;
  dbFileName: string;
  enabled: boolean;
}

export interface TaskListSettings {
  language: Language;
  databaseFilePath: string;
  defaultPriority: TaskPriority;
  defaultStatus: TaskStatus;
  // Workboard defaults
  defaultWorkboardYear: number;
  defaultQuarter: number;
  defaultTimeRange: TimeRange;
  defaultShowDashboard: boolean;
  defaultMaxCards: number;
  // Multi-project support
  dataDir: string;
  projects: ProjectConfig[];
  activeProjectId: string;
  // Task hierarchy
  maxTaskDepth: number;
}

export const DEFAULT_SETTINGS: TaskListSettings = {
  language: 'zh',
  databaseFilePath: '文档库/模块/工作项目/任务数据库.db',
  defaultPriority: 'medium',
  defaultStatus: 'pending',
  defaultWorkboardYear: new Date().getFullYear(),
  defaultQuarter: Math.floor(new Date().getMonth() / 3) + 1,
  defaultTimeRange: 'week',
  defaultShowDashboard: true,
  defaultMaxCards: 20,
  dataDir: '.tasklist/databases',
  projects: [],
  activeProjectId: '',
  maxTaskDepth: 3,
};

export const VIEW_TYPE_TASKLIST = 'tasklist-view';
export const VIEW_TYPE_WORKBOARD = 'workboard-view';
export const VIEW_TYPE_OKR = 'okr-block-view';

/**
 * Get translated status label based on current language.
 * Replaces the old static STATUS_LABELS constant.
 */
export function getStatusLabel(status: TaskStatus): string {
  return t(`status.${status}`);
}

/**
 * Get translated priority label based on current language.
 * Replaces the old static PRIORITY_LABELS constant.
 */
export function getPriorityLabel(priority: TaskPriority): string {
  return t(`priority.${priority}`);
}

export const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  'pending': 'in-progress',
  'in-progress': 'done',
  'done': 'pending',
};

/**
 * Get translated task type label based on current language.
 */
export function getTaskTypeLabel(taskType: TaskType): string {
  return t(`taskType.${taskType}`);
}

/**
 * Color mapping for task type badges.
 */
export const TASK_TYPE_COLORS: Record<TaskType, string> = {
  text: 'var(--text-muted)',
  progress: 'var(--color-blue)',
  parent: 'var(--color-purple)',
};
