# Daily Game City Grid

External game package for `JPrier/DailyGameHarness`.

City Grid asks players to identify a city from progressively revealed unlabeled street-grid SVG stages.

## Commands

```sh
npm run generate
npm run build
npm run test
```

The package is prebuilt: `dist/runtime/index.js`, `src/GameView.svelte`, `content/manifest.json`, puzzle JSON, and SVG assets are committed for direct harness consumption.

## Deterministic Fixture

The public E2E fixture is Boston on `2026-05-22`, selected by the static-pool resolver at `content/puzzles/v1/puzzle-0748.json`.
