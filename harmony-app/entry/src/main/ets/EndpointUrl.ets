export const DEFAULT_LOCAL_BASE_URL: string = 'http://127.0.0.1:8000';

function hasHostCharacter(host: string): boolean {
  for (let i = 0; i < host.length; i++) {
    const ch: string = host.charAt(i);
    if (ch !== '.' && ch !== '-') {
      return true;
    }
  }
  return false;
}

function isValidAuthority(authority: string): boolean {
  if (authority.length === 0 || authority.includes('@') || authority.includes('\\')) {
    return false;
  }
  let host: string = '';
  let port: string = '';
  if (authority.startsWith('[')) {
    const close: number = authority.indexOf(']');
    if (close <= 1) {
      return false;
    }
    host = authority.substring(1, close);
    const rest: string = authority.substring(close + 1);
    if (rest.length > 0) {
      if (!rest.startsWith(':')) {
        return false;
      }
      port = rest.substring(1);
    }
  } else {
    const firstColon: number = authority.indexOf(':');
    const lastColon: number = authority.lastIndexOf(':');
    if (firstColon !== lastColon) {
      return false;
    }
    if (lastColon >= 0) {
      host = authority.substring(0, lastColon);
      port = authority.substring(lastColon + 1);
    } else {
      host = authority;
    }
  }
  if (host.length === 0 || !hasHostCharacter(host)) {
    return false;
  }
  if (port.length === 0) {
    return !authority.endsWith(':');
  }
  if (!/^\d+$/.test(port)) {
    return false;
  }
  const portNumber: number = Number(port);
  return portNumber >= 1 && portNumber <= 65535;
}

/**
 * Accepts an absolute http(s) endpoint origin with an optional port.
 * Query strings, fragments, paths, userinfo and whitespace are rejected
 * because the frontend is served from the origin root; a trailing slash is
 * trimmed.
 */
export function normalizeCustomBaseUrl(raw: string): string | null {
  const trimmed: string = raw.trim();
  if (trimmed.length === 0 || trimmed.includes('\\')) {
    return null;
  }
  if (!/^https?:\/\/[^/?#\s]+\/?$/i.test(trimmed)) {
    return null;
  }
  const authorityStart: number = trimmed.indexOf('://') + 3;
  const pathStart: number = trimmed.indexOf('/', authorityStart);
  const authority: string = pathStart === -1
    ? trimmed.substring(authorityStart)
    : trimmed.substring(authorityStart, pathStart);
  if (!isValidAuthority(authority)) {
    return null;
  }
  return trimmed.endsWith('/') ? trimmed.substring(0, trimmed.length - 1) : trimmed;
}

export function isLocalBaseUrl(raw: string): boolean {
  const normalized: string | null = normalizeCustomBaseUrl(raw);
  if (normalized === null) {
    return false;
  }
  const schemeEnd: number = normalized.indexOf('://');
  if (schemeEnd < 0 || normalized.substring(0, schemeEnd).toLowerCase() !== 'http') {
    return false;
  }
  let authority: string = normalized.substring(schemeEnd + 3);
  const slash: number = authority.indexOf('/');
  if (slash >= 0) {
    authority = authority.substring(0, slash);
  }
  const colon: number = authority.lastIndexOf(':');
  let host: string = authority;
  let port: string = '80';
  if (colon >= 0) {
    host = authority.substring(0, colon);
    port = authority.substring(colon + 1);
  }
  host = host.toLowerCase();
  while (host.endsWith('.')) {
    host = host.substring(0, host.length - 1);
  }
  return (host === '127.0.0.1' || host === 'localhost') && Number(port) === 8000;
}

export function resolveBaseUrl(customBaseUrl: string | null): string {
  return customBaseUrl !== null && customBaseUrl.length > 0
    ? customBaseUrl
    : DEFAULT_LOCAL_BASE_URL;
}
