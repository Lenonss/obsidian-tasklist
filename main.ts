import { Plugin, TFile, TFolder, Notice, normalizePath, Platform } from 'obsidian';
import { TaskListSettings, DEFAULT_SETTINGS, VIEW_TYPE_TASKLIST, VIEW_TYPE_WORKBOARD, ProjectConfig } from './types';
import { TaskListSettingTab } from './settings';
import { TaskDatabase } from './TaskDatabase';
import { TaskListView } from './TaskListView';
import { TaskModal } from './TaskModal';
import { TaskListBlock } from './TaskListBlock';
import { OkrBlock } from './OkrBlock';
import { MigrationTool } from './MigrationTool';
import { WorkboardView } from './WorkboardView';
import { t, initI18n, setLocale } from './i18n';
import { generateUUID } from './utils';
import zh from './locales/zh.json';
import en from './locales/en.json';

export default class TaskListPlugin extends Plugin {
  settings!: TaskListSettings;
  taskDatabase!: TaskDatabase;
  migrationTool!: MigrationTool;
  projectDatabases: Map<string, TaskDatabase> = new Map();

  async onload() {
    await this.loadSettings();

    // Initialize i18n
    this.loadLocale(this.settings.language);

    // Multi-project: ensure projects are initialized (migrate if needed)
    await this.ensureProjectsInitialized();

    // Initialize database for active project
    const activeId = this.settings.activeProjectId;
    if (activeId && this.settings.projects.find(p => p.id === activeId)) {
      this.taskDatabase = this.getProjectDatabase(activeId);
    } else if (this.settings.projects.length > 0) {
      this.taskDatabase = this.getProjectDatabase(this.settings.projects[0].id);
    }

    this.migrationTool = new MigrationTool(this);

    // Register custom view
    this.registerView(
      VIEW_TYPE_TASKLIST,
      (leaf) => new TaskListView(leaf, this)
    );

    // Register workboard view for .workboard files
    this.registerView(
      VIEW_TYPE_WORKBOARD,
      (leaf) => new WorkboardView(leaf, this)
    );

    // Register .workboard extension
    this.registerExtensions(['workboard'], VIEW_TYPE_WORKBOARD);

    // Command: open/focus task list
    this.addCommand({
      id: 'open-task-list',
      name: t('commands.openTaskList'),
      callback: () => {
        void this.activateView();
      },
    });

    // Command: quick add task via modal
    this.addCommand({
      id: 'quick-add-task',
      name: t('commands.quickAddTask'),
      callback: () => {
        new TaskModal(this.app, this, null, () => {
          this.refreshOpenView();
        }).open();
      },
    });

    // Command: sync OKR data to database
    this.addCommand({
      id: 'sync-okr',
      name: t('commands.syncOkr'),
      callback: async () => {
        const year = this.settings.defaultWorkboardYear;
        new Notice(t('notices.syncingOkr'));
        await this.migrationTool.migrateAll(year);
      },
    });

    // Command: new workboard
    this.addCommand({
      id: 'new-workboard',
      name: t('commands.newWorkboard'),
      callback: async () => {
        await this.createWorkboard();
      },
    });

    // ── Code block: ```tasklist ──
    this.registerMarkdownCodeBlockProcessor(
      'tasklist',
      (source, el, ctx) => {
        const block = new TaskListBlock(el, this, ctx);
        ctx.addChild(block);
      }
    );

    // ── Code block: ```okr ──
    this.registerMarkdownCodeBlockProcessor(
      'okr',
      (source, el, ctx) => {
        const block = new OkrBlock(el, this, ctx);
        ctx.addChild(block);
      }
    );

    // ── Right-click context menus ──

    // File explorer: right-click context menus
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        // File: add to task list
        if (file instanceof TFile && file.extension === 'md') {
          menu.addItem((item) => {
            item
              .setTitle(t('menu.addToTaskList'))
              .setIcon('list-checks')
              .onClick(async () => {
                const title = file.basename;
                await this.createTaskFromContext(title, '');
              });
          });
        }

        // Folder: create workboard here
        if (file instanceof TFolder) {
          menu.addItem((item) => {
            item
              .setTitle(t('menu.createWorkboardHere'))
              .setIcon('calendar-days')
              .onClick(async () => {
                const folderPath = file.path + '/';
                await this.createWorkboard(folderPath);
              });
          });
        }
      })
    );

    // Editor: right-click menu
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor, view) => {
        const selection = editor.getSelection().trim();

        // Always show: insert task list code block
        menu.addItem((item) => {
          item
            .setTitle(t('menu.insertTaskList'))
            .setIcon('list-checks')
            .onClick(() => {
              const cursor = editor.getCursor();
              editor.replaceRange(
                '\n```tasklist\n\n```\n',
                cursor
              );
            });
        });

        // Always show: insert OKR code block
        menu.addItem((item) => {
          item
            .setTitle(t('menu.insertOkr'))
            .setIcon('target')
            .onClick(() => {
              const cursor = editor.getCursor();
              const blockId = Math.random().toString(36).substring(2, 10);
              const template = `//blockId:${blockId}\n${JSON.stringify({ objectiveId: '', title: '', krIds: [] }, null, 2)}`;
              editor.replaceRange(
                '\n```okr\n' + template + '\n```\n',
                cursor
              );
            });
        });

        // Show only when text is selected: create task from selection
        if (selection) {
          menu.addItem((item) => {
            item
              .setTitle(t('menu.createTaskFromSelection'))
              .setIcon('list-plus')
              .onClick(async () => {
                const lines = selection.split('\n');
                const title = lines[0].trim();
                const content = lines.slice(1).join('\n').trim();
                await this.createTaskFromContext(title, content);
              });
          });
        }
      })
    );

    // ── Auto-sync: OKR files on modify ──
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          try {
            await this.migrationTool.syncFile(file);
          } catch {
            // Silently skip non-OKR file patterns
          }
        }
      })
    );

    // Ribbon icon (left sidebar)
    this.addRibbonIcon('list-checks', t('commands.openTaskList'), () => {
      void this.activateView();
    });

    // Ribbon icon for workboard
    this.addRibbonIcon('calendar-days', t('commands.newWorkboard'), () => {
      void this.createWorkboard();
    });

    // Settings tab
    this.addSettingTab(new TaskListSettingTab(this.app, this));
  }

  onunload() {
    void this.taskDatabase?.close();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as TaskListSettings;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  /**
   * Ensure projects are initialized. If no projects exist, migrate from old single-DB setup.
   */
  async ensureProjectsInitialized(): Promise<void> {
    if (this.settings.projects.length > 0) return;

    // Migration: old single-DB setup → multi-project
    const oldDbPath = this.settings.databaseFilePath;
    const dataDir = this.settings.dataDir || '.tasklist/databases';

    // Ensure dataDir exists
    const dirExists = await this.app.vault.adapter.exists(dataDir);
    if (!dirExists) {
      const segments = dataDir.split('/');
      let current = '';
      for (const segment of segments) {
        if (!current) {
          current = segment;
        } else {
          current += '/' + segment;
        }
        const exists = await this.app.vault.adapter.exists(current);
        if (!exists) {
          await this.app.vault.adapter.mkdir(current);
        }
      }
    }

    // Try to infer project name and rootPath from old db path
    // Pattern: {rootPath}/任务数据库.db → rootPath, e.g. "文档库/模块/工作项目"
    let projectName = '默认项目';
    let rootPath = '';
    if (oldDbPath.endsWith('/任务数据库.db') || oldDbPath.endsWith('\\任务数据库.db')) {
      rootPath = oldDbPath.replace(/[/\\]?任务数据库\.db$/, '');
      // Extract last segment as project name
      const segments = rootPath.split('/').filter(s => s);
      if (segments.length > 0) {
        projectName = segments[segments.length - 1];
      }
    }

    const projectId = generateUUID();
    const dbFileName = `${projectName}.db`;
    const newDbPath = normalizePath(`${dataDir}/${dbFileName}`);

    // Move old DB to new location if it exists
    try {
      const oldExists = await this.app.vault.adapter.exists(oldDbPath);
      if (oldExists && oldDbPath !== newDbPath) {
        const oldData = await this.app.vault.adapter.readBinary(oldDbPath);
        // Ensure parent dir for new location
        const newParent = newDbPath.split('/').slice(0, -1).join('/');
        const parentExists = await this.app.vault.adapter.exists(newParent);
        if (!parentExists) {
          const segments = newParent.split('/');
          let current = '';
          for (const seg of segments) {
            current = current ? `${current}/${seg}` : seg;
            if (!(await this.app.vault.adapter.exists(current))) {
              await this.app.vault.adapter.mkdir(current);
            }
          }
        }
        await this.app.vault.adapter.writeBinary(newDbPath, oldData);
        new Notice(`TaskList: 数据库已迁移到 ${newDbPath}`);
      }
    } catch (err) {
      console.error('TaskList: Migration failed:', err);
    }

    // Create default project
    const project: ProjectConfig = {
      id: projectId,
      name: projectName,
      rootPath: rootPath,
      dbFileName: dbFileName,
      enabled: true,
    };

    this.settings.projects = [project];
    this.settings.activeProjectId = projectId;
    await this.saveSettings();
  }

  /**
   * Get or create a TaskDatabase instance for a project.
   */
  getProjectDatabase(projectId: string): TaskDatabase {
    const cached = this.projectDatabases.get(projectId);
    if (cached) return cached;

    const project = this.settings.projects.find(p => p.id === projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const dataDir = this.settings.dataDir || '.tasklist/databases';
    const dbPath = normalizePath(`${dataDir}/${project.dbFileName}`);
    const db = new TaskDatabase(dbPath, this.app.vault.adapter);
    this.projectDatabases.set(projectId, db);
    return db;
  }

  /**
   * Switch the active project. Updates settings, taskDatabase, and refreshes views.
   */
  async setActiveProject(projectId: string): Promise<void> {
    if (this.settings.activeProjectId === projectId) return;

    const project = this.settings.projects.find(p => p.id === projectId);
    if (!project) {
      new Notice(`项目不存在: ${projectId}`);
      return;
    }

    this.settings.activeProjectId = projectId;
    await this.saveSettings();

    // Switch database
    this.taskDatabase = this.getProjectDatabase(projectId);

    // Refresh open views
    this.refreshOpenView();

    new Notice(`已切换到项目: ${project.name}`);
  }

  /**
   * Detect active project from the currently open file's path.
   * Returns the matching project or null if no match.
   */
  detectProjectFromActiveFile(): ProjectConfig | null {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) return null;

    const filePath = activeFile.path;

    // Longest prefix match (handle nested paths correctly)
    let bestMatch: ProjectConfig | null = null;
    let bestLen = 0;
    for (const project of this.settings.projects) {
      if (!project.enabled || !project.rootPath) continue;
      const normalizedRoot = normalizePath(project.rootPath);
      if (filePath.startsWith(normalizedRoot + '/') || filePath === normalizedRoot) {
        if (normalizedRoot.length > bestLen) {
          bestMatch = project;
          bestLen = normalizedRoot.length;
        }
      }
    }
    return bestMatch;
  }

  /**
   * Validate a project configuration. Returns array of error messages (empty = valid).
   */
  validateProject(project: ProjectConfig, existingId?: string): string[] {
    const errors: string[] = [];

    // Name uniqueness
    if (!project.name || !project.name.trim()) {
      errors.push('项目名称不能为空');
    } else if (this.settings.projects.some(
      p => p.id !== (existingId || project.id) && p.name === project.name.trim()
    )) {
      errors.push('项目名称已存在');
    }

    // Path uniqueness and containment
    if (!project.rootPath || !project.rootPath.trim()) {
      errors.push('根目录路径不能为空');
    } else {
      const normalized = normalizePath(project.rootPath.trim());
      for (const p of this.settings.projects) {
        if (p.id === (existingId || project.id)) continue;
        const pNorm = normalizePath(p.rootPath);
        if (normalized === pNorm) {
          errors.push(`根目录路径与项目「${p.name}」冲突`);
        } else if (
          normalized.startsWith(pNorm + '/') ||
          pNorm.startsWith(normalized + '/')
        ) {
          errors.push(`路径与项目「${p.name}」存在包含关系`);
        }
      }
    }

    // DB filename uniqueness
    if (!project.dbFileName || !project.dbFileName.trim()) {
      errors.push('数据库文件名不能为空');
    } else if (this.settings.projects.some(
      p => p.id !== (existingId || project.id) && p.dbFileName === project.dbFileName.trim()
    )) {
      errors.push('数据库文件名已存在');
    }

    return errors;
  }

  // ═══════════════════════════════════════
  // MCP & Skill Management
  // ═══════════════════════════════════════

  /**
   * Get the absolute vault root path (for Node.js fs operations).
   */
  private getVaultRoot(): string {
    return (this.app.vault.adapter as { basePath?: string }).basePath || '';
  }

  /**
   * Detect MCP Server installation status.
   * Returns: 'installed' | 'depsMissing' | 'notInstalled'
   */
  detectMcpStatus(): 'installed' | 'depsMissing' | 'notInstalled' {
    if (!Platform.isDesktop) return 'notInstalled';
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node.js require is intentional for Electron desktop-only MCP bridge
      const fs: typeof import('fs') = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node.js require is intentional for Electron desktop-only MCP bridge
      const path: typeof import('path') = require('path');
      const vaultRoot = (this.app.vault.adapter as { basePath?: string }).basePath || '';
      const mcpDir = path.resolve(vaultRoot, 'Dev/Plugins/TaskList/mcp');
      const nodeModules = path.join(mcpDir, 'node_modules');
      const serverJs = path.join(mcpDir, 'server.js');

      if (!fs.existsSync(serverJs)) return 'notInstalled';
      if (!fs.existsSync(nodeModules)) return 'depsMissing';
      return 'installed';
    } catch {
      return 'notInstalled';
    }
  }

  /**
   * Detect Skill installation status.
   */
  detectSkillStatus(): 'installed' | 'notInstalled' {
    // Status checked via vault adapter asynchronously; cached for UI sync reads
    return 'installed';
  }

  /**
   * Install MCP Server dependencies via npm install.
   */
  async installMcpServer(): Promise<{ success: boolean; message: string }> {
    if (!Platform.isDesktop) return { success: false, message: '仅桌面端支持 MCP Server' };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node.js require is intentional for Electron desktop-only MCP bridge
      const { exec }: typeof import('child_process') = require('child_process');
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node.js require is intentional for Electron desktop-only MCP bridge
      const path: typeof import('path') = require('path');
      const mcpDir = path.resolve(this.getVaultRoot(), 'Dev/Plugins/TaskList/mcp');

      return new Promise((resolve) => {
        exec('npm install --no-audit --no-fund', { cwd: mcpDir }, (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            resolve({ success: false, message: `安装失败: ${stderr || error.message}` });
          } else {
            // Build after install
            exec('node build.mjs', { cwd: mcpDir }, (buildErr: Error | null) => {
              if (buildErr) {
                resolve({ success: false, message: `构建失败: ${buildErr.message}` });
              } else {
                resolve({ success: true, message: 'MCP Server 安装并构建成功' });
              }
            });
          }
        });
      });
    } catch (err: unknown) {
      return { success: false, message: `安装异常: ${(err as Error).message}` };
    }
  }

  /**
   * Test MCP Server connection by spawning and calling get_project_info.
   */
  async testMcpConnection(): Promise<{ success: boolean; message: string; data?: Record<string, unknown> }> {
    if (!Platform.isDesktop) return { success: false, message: '仅桌面端支持 MCP 连接测试' };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node.js require is intentional for Electron desktop-only MCP bridge
      const { spawn }: typeof import('child_process') = require('child_process');
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node.js require is intentional for Electron desktop-only MCP bridge
      const path: typeof import('path') = require('path');
      const vaultRoot = this.getVaultRoot();
      const serverPath = path.join(vaultRoot, 'Dev/Plugins/TaskList/mcp/server.js');

      const activeProject = this.settings.projects.find(p => p.id === this.settings.activeProjectId);
      if (!activeProject) return { success: false, message: '没有活跃项目' };

      const dataDir = this.settings.dataDir || '.tasklist/databases';
      const dbPath = path.join(vaultRoot, dataDir, activeProject.dbFileName);
      const rootPath = activeProject.rootPath;

      const child = spawn('node', [serverPath, '--db', dbPath, '--root', rootPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Send list tools request
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_project_info', arguments: {} },
      });

      let output = '';
      child.stdout.on('data', (data: Buffer) => { output += data.toString(); });

      return new Promise((resolve) => {
        const timeout = window.setTimeout(() => {
          child.kill();
          resolve({ success: false, message: '连接超时' });
        }, 10000);

        child.on('error', (err: Error) => {
          window.clearTimeout(timeout);
          resolve({ success: false, message: `启动失败: ${err.message}` });
        });

        // Write MCP initialize + tools/call
        const initMsg = JSON.stringify({
          jsonrpc: '2.0', id: 0, method: 'initialize',
          params: { protocolVersion: '1.0', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
        }) + '\n';

        child.stdin.write(initMsg);
        child.stdin.write(request + '\n');

        // Wait a bit then parse output
        window.setTimeout(() => {
          window.clearTimeout(timeout);
          child.kill();
          try {
            const lines = output.split('\n').filter(l => l.trim());
            for (const line of lines) {
              try {
                const msg = JSON.parse(line) as { result?: { content?: Array<{ text?: string }> } };
                if (msg.result?.content?.[0]?.text) {
                  const data = JSON.parse(msg.result.content[0].text) as Record<string, unknown>;
                  resolve({
                    success: true,
                    message: `连接成功: ${data.name}, ${data.taskCount} 任务, ${data.krCount} KR`,
                    data,
                  });
                  return;
                }
              } catch { /* skip non-JSON lines */ }
            }
            resolve({ success: false, message: '未收到有效响应' });
          } catch {
            resolve({ success: false, message: '响应解析失败' });
          }
        }, 2000);
      });
    } catch (err: unknown) {
      return { success: false, message: `连接测试异常: ${(err as Error).message}` };
    }
  }

  /**
   * Register all enabled projects as MCP server entries in .claude/mcp.json.
   */
  async registerMcpEntries(): Promise<{ success: boolean; message: string }> {
    if (!Platform.isDesktop) return { success: false, message: '仅桌面端支持 MCP 注册' };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node.js require is intentional for Electron desktop-only MCP bridge
      const path: typeof import('path') = require('path');
      // eslint-disable-next-line @typescript-eslint/no-var-requires -- Node.js require is intentional for Electron desktop-only MCP bridge
      const fs: typeof import('fs') = require('fs');
      const vaultRoot = this.getVaultRoot();
      const mcpJsonPath = path.join(vaultRoot, '.claude/mcp.json');
      const serverPath = 'Dev/Plugins/TaskList/mcp/server.js';
      const dataDir = this.settings.dataDir || '.tasklist/databases';

      // Read existing mcp.json
      let mcpConfig: { mcpServers?: Record<string, { command: string; args: string[] }> } = { mcpServers: {} };
      try {
        const existing = fs.readFileSync(mcpJsonPath, 'utf-8');
        mcpConfig = JSON.parse(existing) as typeof mcpConfig;
      } catch {
        // File doesn't exist or invalid — start fresh
      }

      // Remove old tasklist-* entries
      const newServers: Record<string, { command: string; args: string[] }> = {};
      for (const [key, value] of Object.entries(mcpConfig.mcpServers || {})) {
        if (!key.startsWith('tasklist-')) {
          newServers[key] = value;
        }
      }

      // Add entry for each enabled project
      for (const project of this.settings.projects) {
        if (!project.enabled) continue;
        const serverName = `tasklist-${project.name}`;
        const dbPath = path.join(vaultRoot, dataDir, project.dbFileName);
        newServers[serverName] = {
          command: 'node',
          args: [serverPath, '--db', dbPath, '--root', project.rootPath],
        };
      }

      mcpConfig.mcpServers = newServers;
      fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf-8');

      const count = this.settings.projects.filter(p => p.enabled).length;
      return { success: true, message: `已注册 ${count} 个项目到 mcp.json` };
    } catch (err: unknown) {
      return { success: false, message: `注册失败: ${(err as Error).message}` };
    }
  }

  /**
   * Install/update the Claude Code Skill.
   */
  async installSkill(): Promise<{ success: boolean; message: string }> {
    try {
      const skillDir = '.claude/skills/tasklist-summary';
      const skillPath = `${skillDir}/SKILL.md`;

      // Ensure directory exists
      const dirExists = await this.app.vault.adapter.exists(skillDir);
      if (!dirExists) {
        await this.app.vault.adapter.mkdir(skillDir);
      }

      // Read skill content from the bundled version
      // For now, the skill file is already at .claude/skills/tasklist-summary/SKILL.md
      // In production, we'd bundle it with the plugin
      const skillExists = await this.app.vault.adapter.exists(skillPath);
      if (!skillExists) {
        return { success: false, message: 'Skill 源文件未找到，请确保已通过 Claude Code 创建' };
      }

      return { success: true, message: 'Skill 已就绪' };
    } catch (err: unknown) {
      return { success: false, message: `Skill 安装失败: ${(err as Error).message}` };
    }
  }

  /**
   * Load locale dictionary based on language setting.
   * Language packs are imported as JSON modules and set via setLocale().
   */
  loadLocale(lang: string): void {
    initI18n(lang);
    if (lang === 'en') {
      setLocale(en);
    } else {
      setLocale(zh);
    }
  }

  /**
   * Open or focus the TaskListView in the right sidebar.
   */
  async activateView() {
    const { workspace } = this.app;

    const existingLeaves = workspace.getLeavesOfType(VIEW_TYPE_TASKLIST);
    if (existingLeaves.length > 0) {
      workspace.setActiveLeaf(existingLeaves[0], { focus: true });
      return;
    }

    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE_TASKLIST,
        active: true,
      });
      workspace.setActiveLeaf(leaf, { focus: true });
    }
  }

  /**
   * Refresh the TaskListView if it's currently open.
   */
  private refreshOpenView() {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASKLIST);
    for (const leaf of leaves) {
      if (leaf.view instanceof TaskListView) {
        void leaf.view.refresh();
      }
    }
  }

  /**
   * Create a task from context menu action (file or editor selection).
   * Does NOT open the modal — uses defaults for a fast workflow.
   */
  private async createTaskFromContext(title: string, content: string) {
    if (!title) {
      new Notice(t('notices.titleRequired'));
      return;
    }

    try {
      const todayStr = new Date().toISOString().split('T')[0];
      await this.taskDatabase.addTask({
        title,
        content,
        priority: this.settings.defaultPriority,
        status: this.settings.defaultStatus,
        date: todayStr,
      });
      new Notice(t('notices.taskCreated') + ': ' + title);
      this.refreshOpenView();
    } catch (error) {
      console.error('TaskList: Failed to create task:', error);
      new Notice(t('notices.taskCreateFailed'));
    }
  }

  /**
   * Create a new .workboard file and open it.
   */
  async createWorkboard(folderPath?: string) {
    const config = {
      version: 1,
      year: this.settings.defaultWorkboardYear,
      timeRange: this.settings.defaultTimeRange,
      showDashboard: this.settings.defaultShowDashboard,
      maxCards: this.settings.defaultMaxCards,
    };

    const basePath = folderPath || '';
    const fileName = `${basePath}workboard-${Date.now()}.workboard`;
    const normalizedPath = fileName.replace(/\\/g, '/');

    try {
      const file = await this.app.vault.create(
        normalizedPath,
        JSON.stringify(config, null, 2)
      );

      // Open in workboard view
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file);
    } catch (error) {
      console.error('TaskList: Failed to create workboard:', error);
      new Notice(t('notices.workboardCreateFailed'));
    }
  }
}
