const MAX_ITEMS = 25;
const MAX_CHARS = 8000;

export function capList<T>(items: T[]): { items: T[]; truncated: boolean } {
  return {
    items: items.slice(0, MAX_ITEMS),
    truncated: items.length > MAX_ITEMS,
  };
}

export function capText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_CHARS) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, MAX_CHARS)}\n…`, truncated: true };
}
