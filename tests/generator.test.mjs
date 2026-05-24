import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  geometryForCity,
  loadCandidates,
  loadRealOsmSource,
  loadSourceManifest,
  renderSvgStage,
  validateCandidates,
  validateRealOsmSource,
  validateSourceManifest,
} from '../tools/city-grid/model.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const candidates = loadCandidates(root);
const sourceManifest = loadSourceManifest(root);
const realOsmSource = loadRealOsmSource(root, sourceManifest);
const boston = candidates.cities[0];

test('locked mode validation refuses missing source files and sha mismatches', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'city-grid-source-'));
  const missing = structuredClone(sourceManifest);
  missing.sources[0].localPath = 'missing.osm.pbf';
  assert.match(validateSourceManifest(tmp, missing, { mode: 'locked' }).join('\n'), /missing/);

  const mismatch = structuredClone(sourceManifest);
  fs.mkdirSync(path.join(tmp, '.cache/osm'), { recursive: true });
  fs.writeFileSync(path.join(tmp, mismatch.sources[0].localPath), 'changed');
  assert.match(validateSourceManifest(tmp, mismatch, { mode: 'locked' }).join('\n'), /sha256 mismatch/);
});

test('candidate validation rejects duplicate entity ids and aliases', () => {
  const duplicateId = structuredClone(candidates);
  duplicateId.cities[1].entityId = duplicateId.cities[0].entityId;
  assert.match(validateCandidates(duplicateId, sourceManifest).join('\n'), /duplicate/);

  const duplicateAlias = structuredClone(candidates);
  duplicateAlias.cities[1].aliases[0] = duplicateAlias.cities[0].aliases[0];
  assert.match(validateCandidates(duplicateAlias, sourceManifest).join('\n'), /duplicate normalized alias/);
});

test('renderer outputs six staged SVGs without labels or answer strings', () => {
  const sourceErrors = validateRealOsmSource(candidates, realOsmSource);
  assert.deepEqual(sourceErrors, []);
  const geometry = geometryForCity(boston, realOsmSource);
  const stages = Array.from({ length: 6 }, (_, stage) => renderSvgStage(geometry, stage));
  assert.equal(stages.length, 6);
  assert.match(stages[0], /<path/);
  assert.doesNotMatch(stages[0], /#9bc7d8/);
  assert.match(stages[2], /#9bc7d8/);
  assert.match(stages[3], /stroke-dasharray/);
  for (const svg of stages) {
    assert.doesNotMatch(svg, /<text[\s>]/i);
    assert.doesNotMatch(svg.toLowerCase(), /boston|massachusetts|beantown/);
  }
});

test('generated fixture puzzle includes source provenance and existing assets', () => {
  const puzzle = JSON.parse(fs.readFileSync(new URL('../content/puzzles/v1/puzzle-0748.json', import.meta.url), 'utf8'));
  assert.equal(puzzle.extension.source.kind, 'osm-derived');
  for (const stage of puzzle.extension.assetStages) {
    assert.equal(fs.existsSync(path.join(root, stage.assetPath)), true);
  }
});
