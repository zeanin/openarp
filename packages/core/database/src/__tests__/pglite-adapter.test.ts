import { describe, it, expect, afterEach } from 'vitest';
import {
  isPgliteRequested,
  resolvePgliteDataDir,
  getOrCreatePglite,
  closePglite,
  createPgliteDbExec,
} from '../pglite-adapter';

describe('PGlite Adapter', () => {
  afterEach(async () => {
    await closePglite();
  });

  it('detects pglite from environment flags and URLs', () => {
    const origEnv = process.env.USE_PGLITE;
    const origUrl = process.env.DATABASE_URL;

    try {
      process.env.USE_PGLITE = 'true';
      expect(isPgliteRequested()).toBe(true);

      delete process.env.USE_PGLITE;
      process.env.DATABASE_URL = 'pglite://.data/test';
      expect(isPgliteRequested()).toBe(true);

      process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
      expect(isPgliteRequested()).toBe(false);
    } finally {
      process.env.USE_PGLITE = origEnv;
      process.env.DATABASE_URL = origUrl;
    }
  });

  it('resolves in-memory data directory for memory mode', () => {
    const origUrl = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = 'memory';
      expect(resolvePgliteDataDir()).toBeUndefined();
    } finally {
      process.env.DATABASE_URL = origUrl;
    }
  });

  it('executes SQL queries via createPgliteDbExec in-memory', async () => {
    const exec = await createPgliteDbExec();

    await exec.exec(`
      CREATE TABLE IF NOT EXISTS test_users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE
      );
    `);

    await exec.query('INSERT INTO test_users (name, email) VALUES ($1, $2)', ['Alice', 'alice@formai.io']);
    await exec.query('INSERT INTO test_users (name, email) VALUES ($1, $2)', ['Bob', 'bob@formai.io']);

    const result = await exec.query<{ id: number; name: string; email: string }>(
      'SELECT name, email FROM test_users ORDER BY id ASC'
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].name).toBe('Alice');
    expect(result.rows[1].email).toBe('bob@formai.io');
    expect(result.rowCount).toBe(2);
  });
});
