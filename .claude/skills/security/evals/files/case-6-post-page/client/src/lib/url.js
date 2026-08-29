const BLOCKED_SCHEMES = ['javascript:', 'data:', 'vbscript:'];

export function safeUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  const lowered = trimmed.toLowerCase();

  if (BLOCKED_SCHEMES.some((scheme) => lowered.startsWith(scheme))) {
    return null;
  }

  return trimmed;
}
