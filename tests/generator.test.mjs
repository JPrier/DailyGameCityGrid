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
const fixtureCity = candidates.cities[0];

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
  const realOsmSource = fixtureOsmSource(fixtureCity);
  const sourceErrors = validateRealOsmSource(candidates, realOsmSource);
  assert.deepEqual(sourceErrors.filter((error) => error.startsWith(fixtureCity.entityId)), []);
  const geometry = geometryForCity(fixtureCity, realOsmSource);
  const stages = Array.from({ length: 6 }, (_, stage) => renderSvgStage(geometry, stage));
  assert.equal(stages.length, 6);
  assert.match(stages[0], /<path/);
  assert.doesNotMatch(stages[0], /data-layer="water"/);
  assert.match(stages[2], /data-layer="water"/);
  assert.match(stages[3], /stroke-dasharray/);
  assert.match(stages[5], /data-orientation="north-up"/);
  assert.match(stages[5], /data-layer="north-up-compass"/);
  assert.match(stages[5], /data-layer="final-detail-network"/);
  assert.ok((stages[5].match(/<path/g) ?? []).length > (stages[4].match(/<path/g) ?? []).length);
  for (const svg of stages) {
    assert.doesNotMatch(svg, /<text[\s>]/i);
    assert.doesNotMatch(svg.toLowerCase(), new RegExp(fixtureCity.canonicalName.toLowerCase()));
  }
});

test('locked source cache is optional for generated package validation', () => {
  const source = sourceManifest.sources[0];
  const local = path.join(root, source.localPath);
  if (fs.existsSync(local)) {
    const realOsmSource = loadRealOsmSource(root, sourceManifest);
    assert.deepEqual(validateRealOsmSource(candidates, realOsmSource), []);
  }
});

test('generated fixture puzzle includes source provenance and existing assets', () => {
  const puzzle = JSON.parse(fs.readFileSync(new URL('../content/puzzles/v1/puzzle-0748.json', import.meta.url), 'utf8'));
  assert.equal(puzzle.extension.source.kind, 'osm-derived');
  for (const stage of puzzle.extension.assetStages) {
    assert.equal(fs.existsSync(path.join(root, stage.assetPath)), true);
  }
});

function fixtureOsmSource(city) {
  const centerLat = city.lat;
  const centerLon = city.lon;
  const geometry = [];
  for (let index = 0; index < 260; index += 1) {
    const offset = (index - 130) * 0.00018;
    geometry.push({
      type: 'way',
      id: 1000 + index,
      tags: { highway: index % 4 === 0 ? 'primary' : 'residential' },
      geometry: [
        { lat: centerLat - 0.018, lon: centerLon + offset },
        { lat: centerLat + 0.018, lon: centerLon + offset },
      ],
    });
    geometry.push({
      type: 'way',
      id: 2000 + index,
      tags: { highway: index % 5 === 0 ? 'secondary' : 'residential' },
      geometry: [
        { lat: centerLat + offset, lon: centerLon - 0.024 },
        { lat: centerLat + offset, lon: centerLon + 0.024 },
      ],
    });
  }
  geometry.push({
    type: 'way',
    id: 4000,
    tags: { natural: 'water' },
    geometry: [
      { lat: centerLat - 0.012, lon: centerLon - 0.02 },
      { lat: centerLat - 0.006, lon: centerLon - 0.012 },
      { lat: centerLat + 0.002, lon: centerLon - 0.004 },
      { lat: centerLat + 0.009, lon: centerLon + 0.018 },
    ],
  });
  geometry.push({
    type: 'way',
    id: 5000,
    tags: { railway: 'rail' },
    geometry: [
      { lat: centerLat + 0.018, lon: centerLon - 0.022 },
      { lat: centerLat - 0.016, lon: centerLon + 0.021 },
    ],
  });
  geometry.push({
    type: 'way',
    id: 6000,
    tags: { leisure: 'park' },
    geometry: [
      { lat: centerLat + 0.007, lon: centerLon + 0.006 },
      { lat: centerLat + 0.013, lon: centerLon + 0.006 },
      { lat: centerLat + 0.013, lon: centerLon + 0.014 },
      { lat: centerLat + 0.007, lon: centerLon + 0.014 },
      { lat: centerLat + 0.007, lon: centerLon + 0.006 },
    ],
  });
  return {
    schemaVersion: 'city-grid-real-osm-source.v1',
    cities: {
      [city.entityId]: {
        bbox: city.bbox,
        elements: geometry,
      },
    },
  };
}
