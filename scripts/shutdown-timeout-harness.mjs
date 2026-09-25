import { startServer, installSignalHandlers } from '../apps/api/src/main.js';

const config = {
  apiHost: '127.0.0.1',
  apiPort: 0,
  shutdownTimeoutMs: 1000,
};
const running = await startServer({
  ...config,
  nodeEnv: 'test',
  databasePath: process.env.DATABASE_PATH ?? ':memory:',
  webOrigins: [],
  trustProxy: false,
  authRateLimitMax: 20,
  logLevel: 'info',
});
running.close = () => new Promise(() => undefined);
installSignalHandlers(running, config.shutdownTimeoutMs);
console.log('ready');
