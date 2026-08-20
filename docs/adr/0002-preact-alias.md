# ADR 0002 — Preact via `preact/compat` instead of React DOM

**Status:** accepted, reversible

## Context
The tech doc specifies React + Vite. React 19.2.8 + react-dom is roughly 45–50KB brotli. Our total JS
budget for a playable game is 260KB brotli, and React renders only menus, HUD and the leaderboard —
never a single per-frame update.

## Decision
Write standard React (JSX, hooks, function components) and alias `react`/`react-dom` to `preact/compat`
via `@preact/preset-vite` plus `paths` in tsconfig.

## Consequences
- ~40KB brotli saved for identical authored code — ~15% of the entire budget, for a two-line config change.
- Reversal is those same two lines, should a React-internals-dependent library ever be required.
- Risk: a library relying on React internals would break. We currently have exactly one UI dependency
  (zustand, which supports Preact), so exposure is near zero.
