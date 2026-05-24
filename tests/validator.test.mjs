import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(new URL('../content/puzzles/v1/puzzle-0748.json', import.meta.url), 'utf8'));
const fixtureStage0 = fixture.extension.assetStages[0].assetPath;
const fixtureSlug = fixtureStage0.replace(/^content\/assets\/v1\/city-grid\//, '').replace(/\/stage-0\.svg$/, '');
const firstCandidate = JSON.parse(fs.readFileSync(new URL('../content/candidates/world-top-100-cities-geonames-v1.json', import.meta.url), 'utf8')).cities[0];

test('validate-package accepts the generated package', () => {
  const result = spawnSync(process.execPath, ['tools/validate-package.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('validate-package rejects missing source provenance', () => {
  const tmp = copyPackage();
  const puzzlePath = path.join(tmp, 'content/puzzles/v1/puzzle-0000.json');
  const puzzle = JSON.parse(fs.readFileSync(puzzlePath, 'utf8'));
  delete puzzle.extension.source;
  fs.writeFileSync(puzzlePath, JSON.stringify(puzzle, null, 2));
  const result = spawnSync(process.execPath, ['tools/validate-package.mjs'], { cwd: tmp, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source/);
});

test('validate-package rejects SVG text leaks, missing assets, and invalid metrics', () => {
  const cases = [
    (tmp) => fs.appendFileSync(path.join(tmp, fixtureStage0), `<text>${fixture.extension.answer.canonicalName}</text>`),
    (tmp) => fs.rmSync(path.join(tmp, 'content/assets/v1/city-grid', fixtureSlug, 'stage-0.svg')),
    (tmp) => {
      const puzzlePath = path.join(tmp, 'content/puzzles/v1/puzzle-0748.json');
      const puzzle = JSON.parse(fs.readFileSync(puzzlePath, 'utf8'));
      puzzle.extension.geometryMetrics.roadLineCount = 1;
      fs.writeFileSync(puzzlePath, JSON.stringify(puzzle, null, 2));
    },
  ];
  for (const mutate of cases) {
    const tmp = copyPackage();
    mutate(tmp);
    const result = spawnSync(process.execPath, ['tools/validate-package.mjs'], { cwd: tmp, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  }
});

test('validate-package rejects candidate/runtime alias drift through runtime validation', () => {
  const tmp = copyPackage();
  const runtimePath = path.join(tmp, 'dist/runtime/candidates.generated.js');
  fs.writeFileSync(runtimePath, fs.readFileSync(runtimePath, 'utf8').replace(firstCandidate.entityId, 'city:drift:first'));
  const result = spawnSync(process.execPath, ['tools/validate-package.mjs'], { cwd: tmp, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runtime validation failed/);
});

function copyPackage() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'city-grid-validate-'));
  for (const entry of ['daily-game.config.json', '.cache', 'content', 'dist', 'tools']) {
    fs.cpSync(path.join(root, entry), path.join(tmp, entry), { recursive: true });
  }
  return tmp;
}
