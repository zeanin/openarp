import path from 'node:path';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export interface PgliteDbExec {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

let activePglite: PGlite | null = null;
let activeDataDir: string | undefined;

/**
 * Checks whether PGlite should be used instead of external Postgres.
 */
export function isPgliteRequested(): boolean {
  if (process.env.USE_PGLITE === 'true') return true;
  const dbUrl = process.env.DATABASE_URL || '';
  if (dbUrl.startsWith('pglite://') || dbUrl === 'pglite' || dbUrl === 'memory') return true;
  return false;
}

/**
 * Resolves the storage directory for PGlite database files.
 * Defaults to `.data/pglite` in the workspace root or in-memory if specified.
 */
export function resolvePgliteDataDir(customDir?: string): string | undefined {
  if (customDir === ':memory:' || customDir === 'memory') return undefined;
  if (customDir) return customDir;
  const envUrl = process.env.DATABASE_URL;
  if (envUrl === 'memory' || envUrl === 'pglite://memory') return undefined;
  if (envUrl && envUrl.startsWith('pglite://')) {
    const target = envUrl.replace('pglite://', '');
    if (target === 'memory' || target === ':memory:') return undefined;
    return target;
  }
  if (process.env.NODE_ENV === 'test') {
    return undefined; // in-memory by default in test
  }
  return path.resolve(process.cwd(), '.data/pglite');
}

/**
 * Gets or creates the shared embedded PGlite instance.
 */
export async function getOrCreatePglite(dataDir?: string): Promise<PGlite> {
  const resolvedDir = resolvePgliteDataDir(dataDir);

  if (activePglite) {
    if (activeDataDir === resolvedDir) {
      return activePglite;
    }
    await closePglite();
  }

  if (resolvedDir) {
    await fs.mkdir(resolvedDir, { recursive: true });
  }

  activePglite = new PGlite(resolvedDir);
  activeDataDir = resolvedDir;
  await activePglite.waitReady;
  return activePglite;
}

/**
 * Closes the active PGlite instance and releases storage locks.
 */
export async function closePglite(): Promise<void> {
  if (activePglite) {
    const instance = activePglite;
    activePglite = null;
    activeDataDir = undefined;
    await instance.close();
  }
}

/**
 * Creates an Agent-Native compatible DbExec adapter wrapping PGlite.
 */
export async function createPgliteDbExec(dataDir?: string): Promise<PgliteDbExec> {
  const pglite = await getOrCreatePglite(dataDir);

  return {
    async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
      const res = await pglite.query<T>(sql, params);
      const rows = (res.rows || []) as T[];
      const rowCount = rows.length > 0 ? rows.length : (res.affectedRows ?? 0);
      return {
        rows,
        rowCount,
      };
    },
    async exec(sql: string): Promise<void> {
      await pglite.exec(sql);
    },
    async close(): Promise<void> {
      await closePglite();
    },
  };
}
