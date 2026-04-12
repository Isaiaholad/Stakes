const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api';

function joinUrl(pathname) {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${apiBaseUrl}${normalizedPath}`;
}

export async function fetchJson(pathname, options = {}) {
  const response = await fetch(joinUrl(pathname), {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}.`;
    if (payload?.error) {
      errorMessage = typeof payload.error === 'string' ? payload.error : (payload.error.message || JSON.stringify(payload.error));
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
