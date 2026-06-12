#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, import/no-nodejs-modules, @typescript-eslint/no-floating-promises */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import initSqlJs from 'sql.js';
import type { Database as SqlDatabase } from 'sql.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAllTools } from './tools/index.js';
import type { McpContext } from './types.js';

// ── CLI Args ──
function parseArgs(): { dbPath: string; rootPath: string } {
  const args = process.argv.slice(2);
  let dbPath = '';
  let rootPath = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && i + 1 < args.length) {
      dbPath = args[++i];
    } else if (args[i] === '--root' && i + 1 < args.length) {
      rootPath = args[++i];
    }
  }

  if (!dbPath) {
    console.error('Error: --db <path> is required');
    process.exit(1);
  }
  if (!rootPath) {
    console.error('Error: --root <path> is required');
    process.exit(1);
  }

  return { dbPath, rootPath };
}

// ── Main ──
async function main() {
  const { dbPath, rootPath } = parseArgs();

  // Resolve dbPath relative to cwd
  const resolvedDbPath = path.resolve(dbPath);
  if (!fs.existsSync(resolvedDbPath)) {
    console.error(`Error: Database file not found: ${resolvedDbPath}`);
    process.exit(1);
  }

  // Initialize SQL.js
  const SQL = await initSqlJs();
  const dbBuffer = fs.readFileSync(resolvedDbPath);
  const db: SqlDatabase = new SQL.Database(new Uint8Array(dbBuffer));

  const ctx: McpContext = { db, rootPath, SQL };

  // Create MCP Server
  const server = new Server(
    { name: 'tasklist-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  const tools = getAllTools();

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolArgs = request.params.arguments || {};

    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(ctx, toolArgs);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing ${toolName}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`TaskList MCP Server running. DB: ${resolvedDbPath}, Root: ${rootPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
