import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig, parseTrustProxy } from './config.js';

const productionEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  API_HOST: '0.0.0.0',
  API_PORT: '3000',
  DATABASE_PATH: '/data/taptalk.db',
  WEB_ORIGIN: 'https://taptalk.example',
  TRUST_PROXY: 'true',
  AUTH_RATE_LIMIT_MAX: '20',
  LOG_LEVEL: 'info',
  SHUTDOWN_TIMEOUT_MS: '10000',
};

describe('production configuration', () => {
  it('parses a complete production configuration', () => {
    expect(loadConfig(productionEnvironment)).toEqual({
      nodeEnv: 'production',
      apiHost: '0.0.0.0',
      apiPort: 3000,
      databasePath: '/data/taptalk.db',
      webOrigins: ['https://taptalk.example'],
      trustProxy: true,
      authRateLimitMax: 20,
      logLevel: 'info',
      shutdownTimeoutMs: 10_000,
    });
  });

  it.each([
    ['DATABASE_PATH', { ...productionEnvironment, DATABASE_PATH: undefined }],
    ['DATABASE_PATH', { ...productionEnvironment, DATABASE_PATH: ':memory:' }],
    ['DATABASE_PATH', { ...productionEnvironment, DATABASE_PATH: './database/taptalk.db' }],
    ['WEB_ORIGIN', { ...productionEnvironment, WEB_ORIGIN: undefined }],
    ['WEB_ORIGIN', { ...productionEnvironment, WEB_ORIGIN: 'http://taptalk.example' }],
    ['WEB_ORIGIN', { ...productionEnvironment, WEB_ORIGIN: 'https://taptalk.example/app' }],
    ['WEB_ORIGIN', { ...productionEnvironment, WEB_ORIGIN: 'https://*.taptalk.example' }],
    ['WEB_ORIGIN', { ...productionEnvironment, WEB_ORIGIN: 'ftp://taptalk.example' }],
    ['API_PORT', { ...productionEnvironment, API_PORT: '0' }],
    ['API_PORT', { ...productionEnvironment, API_PORT: 'not-a-port' }],
    ['AUTH_RATE_LIMIT_MAX', { ...productionEnvironment, AUTH_RATE_LIMIT_MAX: '0' }],
    ['LOG_LEVEL', { ...productionEnvironment, LOG_LEVEL: 'verbose' }],
    ['SHUTDOWN_TIMEOUT_MS', { ...productionEnvironment, SHUTDOWN_TIMEOUT_MS: '999' }],
  ])('rejects invalid %s', (name, environment) => {
    expect(() => loadConfig(environment)).toThrow(ConfigurationError);
    expect(() => loadConfig(environment)).toThrow(name);
  });

  it('rejects an unknown node environment', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow('NODE_ENV');
  });
});

describe('development and test configuration', () => {
  it('uses safe in-memory defaults for tests', () => {
    expect(loadConfig({ NODE_ENV: 'test' })).toMatchObject({
      nodeEnv: 'test',
      databasePath: ':memory:',
      webOrigins: [],
      trustProxy: false,
      authRateLimitMax: 20,
      logLevel: 'info',
      shutdownTimeoutMs: 10_000,
    });
  });

  it('keeps development defaults and accepts localhost origins', () => {
    expect(
      loadConfig({ NODE_ENV: 'development', WEB_ORIGIN: 'http://localhost:5173/' }),
    ).toMatchObject({
      nodeEnv: 'development',
      databasePath: './database/taptalk.db',
      webOrigins: ['http://localhost:5173'],
    });
  });
});

describe('TRUST_PROXY parsing', () => {
  it.each([
    [undefined, false],
    ['false', false],
    ['true', true],
    [' 10.0.0.1, 10.0.0.0/8 ', ['10.0.0.1', '10.0.0.0/8']],
  ])('parses %s', (value, expected) => {
    expect(parseTrustProxy(value)).toEqual(expected);
  });

  it.each(['yes', 'not-an-ip', '10.0.0.1,not-an-ip', '10.0.0.1/33'])('rejects %s', (value) => {
    expect(() => parseTrustProxy(value)).toThrow(ConfigurationError);
  });
});
