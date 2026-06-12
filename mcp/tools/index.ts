import type { McpContext } from '../types.js';
import { getTasksByDateRange, getTaskStats } from './query-tasks.js';
import { getOkrProgress, getKrHistory } from './query-okr.js';
import { getDailyReports, getProjectInfo } from './query-reports.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (ctx: McpContext, args: Record<string, unknown>) => Promise<Record<string, unknown> | Array<unknown>>;
}

export function getAllTools(): ToolDefinition[] {
  return [
    {
      name: 'get_tasks_by_date_range',
      description:
        'Get all tasks within a date range, optionally filtered by type (todo, achievement, blocker, next). Returns tasks ordered by date and priority.',
      inputSchema: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format',
          },
          endDate: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format',
          },
          type: {
            type: 'string',
            description: 'Optional task type filter: todo, achievement, blocker, next',
          },
        },
        required: ['startDate', 'endDate'],
      },
      handler: async (ctx, args) => {
        return getTasksByDateRange(ctx, args.startDate, args.endDate, args.type);
      },
    },
    {
      name: 'get_task_stats',
      description:
        'Get aggregate task statistics for a date range. Returns total, done, blocked, inProgress, completionRate, and daily trend.',
      inputSchema: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format',
          },
          endDate: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format',
          },
        },
        required: ['startDate', 'endDate'],
      },
      handler: async (ctx, args) => {
        return getTaskStats(ctx, args.startDate, args.endDate);
      },
    },
    {
      name: 'get_okr_progress',
      description:
        'Get all objectives and key results for a given year and quarter. Returns objectives with nested key results including progress percentages.',
      inputSchema: {
        type: 'object',
        properties: {
          year: {
            type: 'number',
            description: 'Year (e.g., 2026)',
          },
          quarter: {
            type: 'number',
            description: 'Quarter 1-4',
          },
        },
        required: ['year', 'quarter'],
      },
      handler: async (ctx, args) => {
        return getOkrProgress(ctx, args.year, args.quarter);
      },
    },
    {
      name: 'get_kr_history',
      description:
        'Get progress history for a specific key result. Returns current progress and latest update information.',
      inputSchema: {
        type: 'object',
        properties: {
          krId: {
            type: 'string',
            description: 'Key Result ID (e.g., KR1.1)',
          },
        },
        required: ['krId'],
      },
      handler: async (ctx, args) => {
        return getKrHistory(ctx, args.krId);
      },
    },
    {
      name: 'get_daily_reports',
      description:
        'Read and return daily report markdown content for a date range. Parses achievements and blockers from each report. Files are scanned from {rootPath}/{year}/日报/{month}/ directory.',
      inputSchema: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Start date in YYYY-MM-DD format',
          },
          endDate: {
            type: 'string',
            description: 'End date in YYYY-MM-DD format',
          },
        },
        required: ['startDate', 'endDate'],
      },
      handler: async (ctx, args) => {
        return getDailyReports(ctx, args.startDate, args.endDate);
      },
    },
    {
      name: 'get_project_info',
      description:
        'Get project metadata for connection verification. Returns project name, root path, task count, and KR count.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
      handler: async (ctx) => {
        return getProjectInfo(ctx);
      },
    },
  ];
}
