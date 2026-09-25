import './load-env.js';
import { loadConfig } from './config.js';
import { migrateDatabase, openDatabase, type SqliteDatabase } from './database.js';
import { buildServer } from './server.js';
import type { FastifyInstance } from 'fastify';

export type RunningServer = {
  server: FastifyInstance;
  database: SqliteDatabase;
  close: () => Promise<void>;
};

export async function startServer(
  config = loadConfig(),
  database: SqliteDatabase = openDatabase(config.databasePath, { migrate: false }),
): Promise<RunningServer> {
  let ready = false;
  const server = buildServer(database, { config, isReady: () => ready });
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    ready = false;
    try {
      await server.close();
    } finally {
      database.close();
    }
  };

  try {
    migrateDatabase(database);
    await server.listen({ host: config.apiHost, port: config.apiPort });
    ready = true;
    server.log.info(
      { host: config.apiHost, port: config.apiPort, nodeEnv: config.nodeEnv },
      'API listening',
    );
    return { server, database, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function runServer(): Promise<void> {
  const config = loadConfig();
  const running = await startServer(config);
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    running.server.log.info({ signal }, 'shutdown requested');
    const timeout = setTimeout(() => {
      running.server.log.error({ signal }, 'graceful shutdown timed out');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    timeout.unref();

    try {
      await running.close();
      clearTimeout(timeout);
      running.server.log.info('shutdown complete');
    } catch (error) {
      running.server.log.error({ err: error }, 'shutdown failed');
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

if (process.env.NODE_ENV !== 'test') {
  runServer().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'API startup failed');
    process.exitCode = 1;
  });
}
