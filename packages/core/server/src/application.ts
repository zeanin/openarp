import Koa from 'koa';
import cors from '@koa/cors';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router';
import { EventEmitter } from 'events';
import { Database, DatabaseOptions } from '@formai/database';
import { PluginManager } from '@formai/plugin';
import { Resourcer } from '@formai/resourcer';
import type { Plugin } from '@formai/plugin';
import { errorHandler } from './middleware/error-handler';
import { actionParams } from './middleware/action-params';
import './context'; // side-effect: extend Koa context types

export interface ApplicationOptions {
  database: DatabaseOptions;
  port?: number;
  cors?: boolean;
  plugins?: any[];
}

export class Application extends EventEmitter {
  koa: Koa;
  db: Database;
  router: Router;
  resourcer: Resourcer;
  pluginManager: PluginManager;
  /** ACL instance — populated by the acl plugin during load() */
  acl: any;
  /** LLM manager — populated by the ai plugin during load() */
  llm: any;
  /** Application configuration object */
  config: any;
  private port: number;
  server: any;
  private started = false;

  constructor(options: ApplicationOptions) {
    super();

    // Prevent uncaught exception crashes on emitted errors
    this.on('error', (err: any) => {
      console.error('[Formai Server Error]', err);
    });

    this.port = options.port ?? 3000;
    this.koa = new Koa();
    this.db = new Database(options.database);
    this.router = new Router();
    this.resourcer = new Resourcer();
    this.pluginManager = new PluginManager(this);

    // Attach app context to every request
    this.koa.use(async (ctx, next) => {
      (ctx as any).db = this.db;
      (ctx as any).app = this;
      await next();
    });

    // Error handling — must be first in middleware chain
    this.koa.use(errorHandler);

    // CORS
    if (options.cors !== false) {
      this.koa.use(cors());
    }

    // Body parsing
    this.koa.use(bodyParser());

    // Action params parsing
    this.koa.use(actionParams);
  }

  // ─── Plugin registration helpers ───────────────────────────────────────────

  /**
   * Register a plugin class (will be instantiated with this app).
   */
  registerPlugin(
    PluginClass: new (app: any, options: any) => Plugin,
    options: { name: string; [key: string]: any },
  ): void {
    this.pluginManager.add(PluginClass, options);
  }

  /**
   * Get a registered plugin by name.
   */
  getPlugin<T extends Plugin = Plugin>(name: string): T | undefined {
    return this.pluginManager.get(name) as T | undefined;
  }

  /**
   * Getter to support legacy map-like access to registered plugins (mainly for testing).
   */
  get plugins() {
    const self = this;
    return {
      set(name: string, plugin: any) {
        self.pluginManager['plugins'].set(name, {
          plugin,
          status: 'pending',
          options: { name, dependencies: plugin.dependencies }
        });
        return this;
      },
      has(name: string) {
        return self.pluginManager.has(name);
      },
      get(name: string) {
        return self.pluginManager.get(name);
      }
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    try {
      await this.db.connect();
    } catch (err) {
      // In test environments a real DB may not be available; log and continue
      console.warn('[Application] Database connection failed:', (err as Error).message);
    }

    this.emit('init');
  }

  async load(): Promise<void> {
    // Load all plugins in topological order
    await this.pluginManager.load();

    // Mount custom router
    this.koa.use(this.router.routes()).use(this.router.allowedMethods());

    // Mount resourcer router into Koa
    const router = this.resourcer.getRouter();
    this.koa.use(router.routes()).use(router.allowedMethods());

    this.emit('load');
  }

  async install(): Promise<void> {
    // First sync DB to create/alter tables
    try {
      await this.db.sync({ alter: true });
    } catch (err) {
      console.warn('[Application] DB sync failed:', (err as Error).message);
    }

    // Then install all plugins (seed data)
    await this.pluginManager.install();

    this.emit('install');
  }

  async upgrade(): Promise<void> {
    await this.pluginManager.upgrade();
    this.emit('upgrade');
  }

  async start(): Promise<void> {
    if (this.started) return;

    await new Promise<void>((resolve) => {
      this.server = this.koa.listen(this.port, () => {
        this.started = true;
        resolve();
      });
    });

    this.emit('start');
  }

  async stop(): Promise<void> {
    // Destroy plugins (cleanup timers etc.) in reverse order
    try {
      await this.pluginManager.destroy();
    } catch (_) {
      // ignore
    }

    if (this.server) {
      // closeAllConnections() forcefully destroys keep-alive connections so
      // server.close() resolves immediately instead of hanging forever.
      if (typeof this.server.closeAllConnections === 'function') {
        this.server.closeAllConnections();
      }
      await new Promise<void>((resolve, reject) => {
        this.server.close((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.server = null;
    }

    try {
      await this.db.close();
    } catch (_) {
      // ignore close errors
    }

    this.started = false;
    this.emit('stop');
  }

  // ─── Shortcuts ─────────────────────────────────────────────────────────────

  use(middleware: Koa.Middleware): void {
    this.koa.use(middleware);
  }

  resource(options: any): void {
    this.resourcer.define(options);
  }

  collection(options: any): any {
    return this.db.collection(options);
  }
}
