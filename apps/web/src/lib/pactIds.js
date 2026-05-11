const publicPactPrefix = 'swf';

export function parsePactPublicId(value) {
  const rawValue = String(value || '').trim().toLowerCase();
  if (!rawValue) {
    return 0;
  }

  if (/^\d+$/.test(rawValue)) {
    return Number(rawValue);
  }

  const encodedValue = rawValue
    .replace(/^pact[-_]/, '')
    .replace(new RegExp(`^${publicPactPrefix}[-_]`), '');

  if (!/^[0-9a-z]+$/.test(encodedValue)) {
    return 0;
  }

  const parsedValue = Number.parseInt(encodedValue, 36);
  return Number.isSafeInteger(parsedValue) && parsedValue > 0 ? parsedValue : 0;
}

export function formatPactPublicId(pactId) {
  const numericPactId = Number(pactId);
  if (!Number.isSafeInteger(numericPactId) || numericPactId <= 0) {
    return '';
  }

  return `${publicPactPrefix}-${numericPactId.toString(36).padStart(4, '0')}`;
}

export function buildPactPath(pactId) {
  const publicId = formatPactPublicId(pactId);
  return publicId ? `/pact/${publicId}` : '/';
}
