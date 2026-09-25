import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';

export type NodeEnvironment = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export type AppConfig = Readonly<{
  nodeEnv: NodeEnvironment;
  apiHost: string;
  apiPort: number;
  databasePath: string;
  webOrigins: string[];
  trustProxy: boolean | string[];
  authRateLimitMax: number;
  logLevel: LogLevel;
  shutdownTimeoutMs: number;
}>;

const defaultApiHost = '0.0.0.0';
const defaultApiPort = 3000;
const defaultAuthRateLimitMax = 20;
const defaultLogLevel: LogLevel = 'info';
const defaultShutdownTimeoutMs = 10_000;
const logLevels: LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(`Invalid configuration: ${message}`);
    this.name = 'ConfigurationError';
  }
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  if (value === 'development' || value === 'test' || value === 'production') return value;
  throw new ConfigurationError('NODE_ENV must be one of development, test, or production.');
}

function parseInteger(
  value: string | undefined,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return defaultValue;
  if (!/^\d+$/.test(value.trim())) {
    throw new ConfigurationError(`${name} must be a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseApiHost(value: string | undefined): string {
  const host = value?.trim() || defaultApiHost;
  if (/\s/.test(host)) throw new ConfigurationError('API_HOST must not contain whitespace.');
  return host;
}

function isValidProxyAddress(value: string): boolean {
  const [address, prefix, ...rest] = value.split('/');
  if (rest.length > 0 || !address || (prefix !== undefined && !/^\d+$/.test(prefix))) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

export function parseTrustProxy(value: string | undefined): boolean | string[] {
  if (value === undefined || value.trim() === '' || value.trim() === 'false') return false;
  if (value.trim() === 'true') return true;
  const addresses = value
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);
  if (addresses.length === 0 || addresses.some((address) => !isValidProxyAddress(address))) {
    throw new ConfigurationError(
      'TRUST_PROXY must be false, true, or a comma-separated list of IP addresses/CIDRs.',
    );
  }
  return addresses;
}

function parseOrigin(value: string, name: string, requireHttps: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigurationError(`${name} must contain valid absolute origins.`);
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    (requireHttps && parsed.protocol !== 'https:')
  ) {
    throw new ConfigurationError(`${name} must contain origins without paths or credentials.`);
  }
  return parsed.origin;
}

function parseWebOrigins(value: string | undefined, production: boolean): string[] {
  const raw = value?.trim() ?? '';
  if (production && raw === '') {
    throw new ConfigurationError('WEB_ORIGIN is required in production.');
  }
  if (raw === '') return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => parseOrigin(origin, 'WEB_ORIGIN', production));
}

function parseLogLevel(value: string | undefined): LogLevel {
  const level = value?.trim() || defaultLogLevel;
  if (!logLevels.includes(level as LogLevel)) {
    throw new ConfigurationError(`LOG_LEVEL must be one of: ${logLevels.join(', ')}.`);
  }
  return level as LogLevel;
}

function parseDatabasePath(value: string | undefined, nodeEnv: NodeEnvironment): string {
  const databasePath = value?.trim() || (nodeEnv === 'test' ? ':memory:' : './database/taptalk.db');
  if (nodeEnv !== 'production') return databasePath;
  if (databasePath === ':memory:') {
    throw new ConfigurationError(
      'DATABASE_PATH must point to a persistent SQLite file in production.',
    );
  }
  if (!isAbsolute(databasePath)) {
    throw new ConfigurationError('DATABASE_PATH must be an absolute path in production.');
  }
  return databasePath;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = parseNodeEnvironment(environment.NODE_ENV);
  const apiPort = parseInteger(environment.API_PORT, 'API_PORT', defaultApiPort, 1, 65_535);
  const authRateLimitMax = parseInteger(
    environment.AUTH_RATE_LIMIT_MAX,
    'AUTH_RATE_LIMIT_MAX',
    defaultAuthRateLimitMax,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const shutdownTimeoutMs = parseInteger(
    environment.SHUTDOWN_TIMEOUT_MS,
    'SHUTDOWN_TIMEOUT_MS',
    defaultShutdownTimeoutMs,
    1_000,
    120_000,
  );
  return {
    nodeEnv,
    apiHost: parseApiHost(environment.API_HOST),
    apiPort,
    databasePath: parseDatabasePath(environment.DATABASE_PATH, nodeEnv),
    webOrigins: parseWebOrigins(environment.WEB_ORIGIN, nodeEnv === 'production'),
    trustProxy: parseTrustProxy(environment.TRUST_PROXY),
    authRateLimitMax,
    logLevel: parseLogLevel(environment.LOG_LEVEL),
    shutdownTimeoutMs,
  };
}
