# City Grid Implementation Notes

This package implements `docs/game-specs/01-city-grid.md` from the strict validation specs.

- Game id/slug: `city-grid`
- Runtime contract: `daily-game-runtime.v1`
- Spec version: `city-grid.spec.v1`
- Candidate set: `world-famous-cities-v1`
- Resolver: static pool, 1000 puzzles, affine selector `a=137`, `b=431`
- E2E fixture: Boston on `2026-05-22`, selected index `748`

The current MVP uses deterministic authored SVG stage assets instead of live map/vector-tile rendering. SVG files intentionally contain no `<text>` nodes or labels.
