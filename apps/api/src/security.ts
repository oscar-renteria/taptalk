import type { FastifyReply, FastifyRequest } from 'fastify';

// HTTP hardening for the API. See docs/security/security-review.md.

// API responses are JSON only: nothing in them may execute, be framed, or be sniffed as HTML.
export const apiSecurityHeaders: Record<string, string> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

const stateChangingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

// CSRF defence in depth on top of SameSite=Lax cookies: a browser always sends Origin on
// cross-origin state-changing requests, so a foreign Origin is rejected. Requests without Origin
// (same-origin GETs, non-browser clients) cannot carry a cross-site attack and are allowed.
// Without configured origins, the Origin must match the Host the request was sent to.
export function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowedOrigins: string[],
): boolean {
  if (origin === undefined) return true;
  if (origin === 'null') return false;
  if (allowedOrigins.length > 0) return allowedOrigins.includes(origin.replace(/\/$/, ''));
  try {
    // Parse both sides so default ports compare equal ("localhost:80" vs "http://localhost").
    const parsed = new URL(origin);
    return host !== undefined && parsed.host === new URL(`${parsed.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

export function createOriginGuard(allowedOrigins: string[], allowAllOrigins = false) {
  return async function originGuard(request: FastifyRequest, reply: FastifyReply) {
    if (!stateChangingMethods.has(request.method)) return;
    if (allowAllOrigins) return;
    const origin = request.headers.origin;
    if (isOriginAllowed(origin, request.headers.host, allowedOrigins)) return;
    request.log.warn({ origin }, 'rejected cross-origin request');
    return reply.code(403).send({
      error: { code: 'CROSS_ORIGIN_REJECTED', message: 'This request is not allowed.' },
    });
  };
}
