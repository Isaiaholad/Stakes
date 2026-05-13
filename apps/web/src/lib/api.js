function resolveApiBaseUrl() {
  const configuredApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || '').trim();
  if (configuredApiBaseUrl) {
    return configuredApiBaseUrl;
  }

  if (
    typeof window !== 'undefined' &&
    !['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  ) {
    return 'https://stakeswithfriends.onrender.com/api';
  }

  return '/api';
}

const apiBaseUrl = resolveApiBaseUrl().replace(/\/+$/, '') || '/api';

function joinUrl(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${apiBaseUrl}${normalizedPath}`;
}

let globalAuthToken = '';

export function setGlobalAuthToken(token) {
  globalAuthToken = token || '';
}

function readSessionToken() {
  if (typeof window === 'undefined') {
    return '';
  }

  return globalAuthToken || window.localStorage?.getItem('swf_session_id') || '';
}

export function hasAuthToken() {
  return Boolean(readSessionToken());
}

export async function fetchJson(pathname, options = {}) {
  const sessionToken = readSessionToken();
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const response = await fetch(joinUrl(pathname), {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      ...(options.body && !isFormDataBody ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;
  const textPayload = payload ? '' : await response.text().catch(() => '');

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}.`;
    if (payload?.error) {
      errorMessage = typeof payload.error === 'string' ? payload.error : (payload.error.message || JSON.stringify(payload.error));
    } else if (/DNS_HOSTNAME_NOT_FOUND/i.test(textPayload)) {
      errorMessage = 'The API backend is not reachable from Vercel. Set API_UPSTREAM_URL to your Render hostname only, without https://, then redeploy.';
    } else if (/The page could not be found/i.test(textPayload) && /NOT_FOUND/i.test(textPayload)) {
      errorMessage = 'The API proxy is not configured on Vercel. Set API_UPSTREAM_URL to your Render hostname only, then redeploy.';
    } else if (/An error occurred with this application/i.test(textPayload)) {
      errorMessage = 'The API proxy returned a Vercel application error. Check the backend URL and API deployment logs.';
    } else if (textPayload.trim()) {
      errorMessage = textPayload.trim();
    }
    const error = new Error(errorMessage);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export function buildQueryString(params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    query.set(key, String(value));
  }

  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}
