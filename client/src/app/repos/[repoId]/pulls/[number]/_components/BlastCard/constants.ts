/** Layout constants for the SVG graph view. Pure geometry, no data. */
export const GRAPH = {
  PAD: 12,
  ROW_H: 34,
  NODE_W: 190,
  NODE_H: 24,
  COL_X: [0, 230, 460] as const,
  MAX_SYMBOLS: 8,
  MAX_NODES_PER_COLUMN: 10,
  MAX_LABEL: 30,
} as const;

/** Symbols shown before the tree collapses the tail. */
export const MAX_SYMBOLS_IN_TREE = 12;
