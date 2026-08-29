function normalizeIdentifier(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim().toLowerCase();
  }
  return value;
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      out[key] = source[key];
    }
  }
  return out;
}

module.exports = { normalizeIdentifier, pick };
