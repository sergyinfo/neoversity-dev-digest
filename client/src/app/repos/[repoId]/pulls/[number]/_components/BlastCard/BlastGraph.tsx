"use client";

import React from "react";
import type { BlastResponse } from "@/lib/hooks/blast";
import { GRAPH } from "./constants";

/**
 * The Graph view: changed symbols → caller files → endpoints, as three columns
 * joined by edges.
 *
 * Hand-rolled SVG rather than a graph library on purpose — the layout is a fixed
 * three-column bipartite-ish flow, not a force simulation, and a dependency
 * would be far more code than the ~60 lines below.
 *
 * The nodes are exactly the nodes of the Tree view. Nothing here is computed,
 * inferred or prettied up: if a node is on screen, the index put it there.
 */
export function BlastGraph({
  map,
  ariaLabel,
  emptyLabel,
}: {
  map: BlastResponse["map"];
  /** Translated; the SVG is the labelled element, not its scroll container. */
  ariaLabel: string;
  emptyLabel: string;
}) {
  const rows = map.downstream.filter((d) => d.callers.length > 0);

  if (rows.length === 0) {
    return <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>{emptyLabel}</p>;
  }

  const symbols = rows.slice(0, GRAPH.MAX_SYMBOLS);
  const callerFiles = [
    ...new Set(symbols.flatMap((d) => d.callers.map((c) => c.file))),
  ].slice(0, GRAPH.MAX_NODES_PER_COLUMN);
  const endpoints = [
    ...new Set(symbols.flatMap((d) => d.endpoints_affected)),
  ].slice(0, GRAPH.MAX_NODES_PER_COLUMN);

  const columns = [symbols.map((d) => d.symbol), callerFiles, endpoints];
  const height =
    GRAPH.PAD * 2 + Math.max(...columns.map((c) => Math.max(c.length, 1))) * GRAPH.ROW_H;
  const width = GRAPH.COL_X[2] + GRAPH.NODE_W + GRAPH.PAD;

  const y = (col: number, i: number) => GRAPH.PAD + i * GRAPH.ROW_H + GRAPH.NODE_H / 2;
  const idx = (arr: string[], v: string) => arr.indexOf(v);

  const short = (p: string) => p.split("/").slice(-2).join("/");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel}
    >
      {/* symbol → caller file */}
      {symbols.flatMap((d, si) =>
        d.callers
          .filter((c) => idx(callerFiles, c.file) >= 0)
          .map((c) => (
            <line
              key={`s${si}-${c.file}-${c.line}`}
              x1={GRAPH.COL_X[0]! + GRAPH.NODE_W}
              y1={y(0, si)}
              x2={GRAPH.COL_X[1]!}
              y2={y(1, idx(callerFiles, c.file))}
              stroke="var(--border-subtle)"
              strokeWidth={1}
            />
          )),
      )}
      {/* caller file → endpoint */}
      {symbols.flatMap((d) =>
        d.callers.flatMap((c) =>
          d.endpoints_affected
            .filter((e) => idx(endpoints, e) >= 0 && idx(callerFiles, c.file) >= 0)
            .map((e) => (
              <line
                key={`c${c.file}-${e}`}
                x1={GRAPH.COL_X[1]! + GRAPH.NODE_W}
                y1={y(1, idx(callerFiles, c.file))}
                x2={GRAPH.COL_X[2]!}
                y2={y(2, idx(endpoints, e))}
                stroke="var(--border-subtle)"
                strokeWidth={1}
              />
            )),
        ),
      )}

      {columns.map((col, ci) =>
        col.map((label, i) => (
          <g key={`n${ci}-${i}`}>
            <rect
              x={GRAPH.COL_X[ci]}
              y={GRAPH.PAD + i * GRAPH.ROW_H}
              width={GRAPH.NODE_W}
              height={GRAPH.NODE_H}
              rx={4}
              fill="var(--bg-raised)"
              stroke="var(--border-subtle)"
            />
            <text
              x={GRAPH.COL_X[ci]! + 8}
              y={GRAPH.PAD + i * GRAPH.ROW_H + GRAPH.NODE_H / 2 + 4}
              fontSize={11}
              fill="var(--text-primary)"
            >
              {(ci === 1 ? short(label) : label).slice(0, GRAPH.MAX_LABEL)}
            </text>
          </g>
        )),
      )}
    </svg>
  );
}
