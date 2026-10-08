import { createApp } from './app';

const startTime = Date.now();

async function main() {
  const app = await createApp();

  // Initialize (connect DB, run plugin init hooks)
  await app.init();

  // Load plugins (register collections, routes, middleware)
  await app.load();

  // Auto-install on first run (creates tables and seeds initial data)
  try {
    await app.install();
  } catch (err: any) {
    // Ignore if already installed (tables already exist)
    if (!err.message?.includes('already exists')) {
      console.warn('[OpenARP] Install warning:', err.message);
    }
  }

  // Start HTTP server
  await app.start();

  const port = parseInt(process.env.PORT || '3000');
  console.log(`[OpenARP] Server running on port ${port}`);
  console.log(`[OpenARP] Health check: http://localhost:${port}/api/health`);
  console.log(`[OpenARP] Started in ${Date.now() - startTime}ms`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[OpenARP] Received ${signal}, shutting down gracefully...`);
    try {
      await app.stop();
      console.log('[OpenARP] Server stopped.');
      process.exit(0);
    } catch (err) {
      console.error('[OpenARP] Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Trigger reload comment to reload rebuilt plugins (v2).
main().catch((err) => {
  console.error('[OpenARP] Failed to start server:', err);
  process.exit(1);
});
