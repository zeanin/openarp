import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { SessionManager as PiSessionManagerType } from '@earendil-works/pi-coding-agent';
import { loadPiCodingAgent } from './loader';

export interface TenantSessionContext {
  tenantId?: string;
  appId?: string | number;
  userId?: string | number;
}

export type StorageDriverMode = 'database' | 'file' | 'memory';

export interface SessionManagerOptions {
  storageMode?: StorageDriverMode;
  storageDir?: string;
  db?: any;
}

export interface DatabaseSessionRecord {
  id: string;
  tenantId: string;
  appId: string;
  userId?: string;
  entries: any[];
  metadata?: Record<string, any>;
  updatedAt: Date;
}

/**
 * Enterprise Multi-Tenant Session Manager for FormAI.
 * Supports 3 storage driver modes:
 *  1. 'database' (Default for Distributed/SaaS Production) - Serializes state into FormAI Database
 *  2. 'file' (Default for Local Dev / Single Node) - Writes isolated JSONL files per tenant directory
 *  3. 'memory' (Default for Transient Tasks) - In-memory execution without persistence
 */
export class FormAiTenantSessionManager {
  private baseDir: string;
  private context: TenantSessionContext;
  private storageMode: StorageDriverMode;
  private db?: any;

  constructor(context: TenantSessionContext = {}, options: SessionManagerOptions = {}) {
    this.context = {
      tenantId: context.tenantId || 'default',
      appId: context.appId || 'system',
      userId: context.userId || 'system',
    };

    this.storageMode = options.storageMode || (process.env.FORMAI_SESSION_STORAGE === 'database' && options.db ? 'database' : 'file');
    this.db = options.db;

    // ~/.formai/tenants/{tenantId}/apps/{appId}/sessions
    this.baseDir = options.storageDir || path.join(
      os.homedir(),
      '.formai',
      'tenants',
      String(this.context.tenantId),
      'apps',
      String(this.context.appId),
      'sessions'
    );
  }

  public getStorageMode(): StorageDriverMode {
    return this.storageMode;
  }

  public getSessionDir(): string {
    return this.baseDir;
  }

  public getContext(): TenantSessionContext {
    return { ...this.context };
  }

  /**
   * Creates an in-memory session manager for transient runs
   */
  public static async inMemory(context?: TenantSessionContext) {
    const { SessionManager } = await loadPiCodingAgent();
    return SessionManager.inMemory();
  }

  /**
   * Resolves the underlying Pi SessionManager instance
   */
  public async getUnderlyingSessionManager(sessionId?: string, workingDirectory?: string): Promise<any> {
    const { SessionManager } = await loadPiCodingAgent();

    const cwd = workingDirectory || process.cwd();

    if (this.storageMode === 'memory') {
      return SessionManager.inMemory(cwd);
    }

    if (this.storageMode === 'database' && this.db) {
      // In database mode, we initialize an in-memory session and hydrate entries from database
      const memManager = SessionManager.inMemory(cwd);
      if (sessionId) {
        await this.hydrateFromDatabase(memManager, sessionId);
      }
      return memManager;
    }

    // Default: 'file' driver (JSONL files under tenant directory)
    await fs.mkdir(this.baseDir, { recursive: true });

    if (sessionId) {
      try {
        let sessionFile: string | undefined;
        try {
          sessionFile = SessionManager.findById(cwd, sessionId, this.baseDir);
        } catch {
          // ignore findById discovery errors
        }

        if (!sessionFile) {
          // Check if any existing file in baseDir matches _${sessionId}.jsonl
          try {
            const files = await fs.readdir(this.baseDir);
            const match = files.find((f: string) => f.endsWith(`_${sessionId}.jsonl`));
            if (match) {
              sessionFile = path.join(this.baseDir, match);
            }
          } catch {
            // ignore readdir error
          }
        }

        if (sessionFile) {
          return SessionManager.open(sessionFile, this.baseDir, cwd);
        }
      } catch (err: any) {
        console.warn(`[FormAiTenantSessionManager] Could not open file session ${sessionId}: ${err.message}. Creating a new one.`);
      }
    }

    return SessionManager.create(cwd, this.baseDir, sessionId ? { id: sessionId } : undefined);
  }

  /**
   * Hydrates in-memory session manager from FormAI Database
   */
  private async hydrateFromDatabase(sessionManager: any, sessionId: string): Promise<boolean> {
    try {
      const repo = this.db.getRepository('agentSessions') || this.db.getRepository('ai_agent_sessions');
      if (!repo) return false;

      const filter: any = { id: sessionId };
      if (repo.collection?.hasField?.('tenant_id')) {
        filter.tenant_id = this.context.tenantId;
      } else if (repo.collection?.hasField?.('tenantId')) {
        filter.tenantId = this.context.tenantId;
      }

      const record = await repo.findOne({
        filter,
      });

      if (record && (record.entries || record.metadata?.entries)) {
        const rawEntries = record.entries || record.metadata?.entries;
        if (Array.isArray(rawEntries)) {
          for (const entry of rawEntries) {
            if (sessionManager._appendEntry) {
              sessionManager._appendEntry(entry);
            }
          }
          return true;
        }
      }
    } catch (err: any) {
      console.warn(`[FormAiTenantSessionManager] Failed to hydrate session ${sessionId} from database: ${err.message}`);
    }
    return false;
  }

  /**
   * Synchronizes session state to FormAI Database
   */
  public async syncToDatabase(session: any, metadata: Record<string, any> = {}): Promise<void> {
    if (!this.db || this.storageMode !== 'database') {
      return;
    }

    const sessionId = session.sessionManager?.getSessionId?.() || session.id;
    if (!sessionId) return;

    try {
      const repo = this.db.getRepository('agentSessions') || this.db.getRepository('ai_agent_sessions');
      if (!repo) return;

      const entries = session.sessionManager?.getEntries?.() || [];

      const values: Record<string, any> = {
        id: sessionId,
        status: 'active',
        updated_at: new Date(),
      };
      if (repo.collection?.hasField?.('tenant_id')) values.tenant_id = this.context.tenantId;
      if (repo.collection?.hasField?.('tenantId')) values.tenantId = this.context.tenantId;
      if (repo.collection?.hasField?.('app_id')) values.app_id = String(this.context.appId);
      if (repo.collection?.hasField?.('appId')) values.appId = String(this.context.appId);
      if (repo.collection?.hasField?.('user_id')) values.user_id = String(this.context.userId);
      if (repo.collection?.hasField?.('userId')) values.userId = String(this.context.userId);
      if (repo.collection?.hasField?.('entries')) values.entries = entries;
      if (repo.collection?.hasField?.('metadata')) values.metadata = metadata;

      const existing = await repo.findOne({
        filter: { id: sessionId },
      });

      if (existing) {
        await repo.update({
          filter: { id: sessionId },
          values,
        });
      } else {
        await repo.create({
          values,
        });
      }
    } catch (err: any) {
      console.warn(`[FormAiTenantSessionManager] Notice saving session to database: ${err.message}`);
    }
  }
}
