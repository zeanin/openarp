import { Application } from '@formai/server';
import { getConfig } from './config';

// Core plugins
import AuthPlugin from '@formai/plugin-auth';
import AIPlugin from '@formai/plugin-ai';
import CollectionManagerPlugin from '@formai/plugin-collection-manager';
import UsersPlugin from '@formai/plugin-users';
import AclPlugin from '@formai/plugin-acl';
import UiSchemaStoragePlugin from '@formai/plugin-ui-schema-storage';
import FileManagerPlugin from '@formai/plugin-file-manager';
import SystemSettingsPlugin from '@formai/plugin-system-settings';
import LocalizationPlugin from '@formai/plugin-localization';
import NotificationPlugin from '@formai/plugin-notification';
import WorkflowPlugin from '@formai/plugin-workflow';

// Advanced plugins
import DataVisualizationPlugin from '@formai/plugin-data-visualization';
import ImportExportPlugin from '@formai/plugin-import-export';
import BackupRestorePlugin from '@formai/plugin-backup-restore';
import AuditLogPlugin from '@formai/plugin-audit-log';
import ApiDocPlugin from '@formai/plugin-api-doc';
import ThemeEditorPlugin from '@formai/plugin-theme-editor';
import AppsPlugin from '@formai/plugin-apps';
import PiPlugin from '@formai/plugin-pi';

export async function createApp(): Promise<Application> {
  const config = getConfig();

  const app = new Application({
    database: config.database,
    port: config.server.port,
    cors: config.server.cors,
  });

  app.config = config;

  // Register plugins via PluginManager (topological load order is resolved automatically)
  const plugins: Array<{ cls: any; name: string; dependencies?: string[] }> = [
    // Auth must be first — populates authManager and auth middleware before other plugins
    { cls: AuthPlugin, name: 'auth' },
    // AI plugin — wires LLMManager and AI engines early so other plugins can use them
    { cls: AIPlugin, name: 'ai' },
    // Core plugins (collection-manager must be loaded before everything else)
    { cls: CollectionManagerPlugin, name: 'collection-manager' },
    { cls: UsersPlugin, name: 'users', dependencies: ['collection-manager'] },
    { cls: AclPlugin, name: 'acl', dependencies: ['collection-manager', 'users'] },
    { cls: UiSchemaStoragePlugin, name: 'ui-schema-storage', dependencies: ['collection-manager'] },
    { cls: FileManagerPlugin, name: 'file-manager', dependencies: ['collection-manager'] },
    { cls: SystemSettingsPlugin, name: 'system-settings', dependencies: ['collection-manager'] },
    { cls: LocalizationPlugin, name: 'localization', dependencies: ['collection-manager'] },
    { cls: NotificationPlugin, name: 'notification', dependencies: ['collection-manager', 'users'] },
    { cls: WorkflowPlugin, name: 'workflow', dependencies: ['collection-manager'] },
    // Advanced plugins
    { cls: DataVisualizationPlugin, name: 'data-visualization', dependencies: ['collection-manager'] },
    { cls: ImportExportPlugin, name: 'import-export', dependencies: ['collection-manager'] },
    { cls: BackupRestorePlugin, name: 'backup-restore', dependencies: ['collection-manager'] },
    { cls: AuditLogPlugin, name: 'audit-log', dependencies: ['collection-manager', 'users'] },
    { cls: ApiDocPlugin, name: 'api-doc' },
    { cls: ThemeEditorPlugin, name: 'theme-editor', dependencies: ['system-settings'] },
    { cls: PiPlugin, name: 'pi' },
    { cls: AppsPlugin, name: 'apps', dependencies: ['collection-manager', 'users', 'acl', 'pi'] },
  ];

  for (const { cls, name, dependencies } of plugins) {
    app.registerPlugin(cls, { name, dependencies });
  }

  // Register health check route before loading plugins
  app.use(async (ctx: any, next: any) => {
    if (ctx.path === '/api/health' && ctx.method === 'GET') {
      ctx.body = {
        status: 'ok',
        version: '0.1.0',
        uptime: Math.floor(process.uptime()),
      };
      return;
    }
    await next();
  });

  return app;
}
// Final clean reload: Shadow routing fixed

