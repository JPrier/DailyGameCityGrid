import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRuntime } from '../dist/runtime/index.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../content/manifest.json', import.meta.url), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(new URL('../content/puzzles/v1/puzzle-0748.json', import.meta.url), 'utf8'));
const candidates = JSON.parse(fs.readFileSync(new URL('../content/candidates/world-top-100-cities-geonames-v1.json', import.meta.url), 'utf8'));
const wrongCities = candidates.cities.filter((city) => city.entityId !== fixture.extension.answer.entityId);

test('validateContent accepts valid manifest and rejects wrong spec version', async () => {
  const runtime = await createRuntime();
  assert.equal((await runtime.validateContent({ contentManifest: manifest })).ok, true);
  const invalid = structuredClone(manifest);
  invalid.extension.specVersion = 'wrong';
  assert.equal((await runtime.validateContent({ contentManifest: invalid })).ok, false);
});

test('validatePuzzle accepts fixture and rejects required missing fields', async () => {
  const runtime = await createRuntime();
  assert.equal((await runtime.validatePuzzle({ puzzle: fixture })).ok, true);
  for (const key of ['puzzleId', 'seed']) {
    const invalid = structuredClone(fixture);
    delete invalid[key];
    assert.equal((await runtime.validatePuzzle({ puzzle: invalid })).ok, false);
  }
  const missingAnswer = structuredClone(fixture);
  delete missingAnswer.extension.answer;
  assert.equal((await runtime.validatePuzzle({ puzzle: missingAnswer })).ok, false);
});

test('validatePuzzle rejects missing or non-osm-derived source provenance', async () => {
  const runtime = await createRuntime();
  const missingSource = structuredClone(fixture);
  delete missingSource.extension.source;
  assert.equal((await runtime.validatePuzzle({ puzzle: missingSource })).ok, false);

  const wrongKind = structuredClone(fixture);
  wrongKind.extension.source.kind = 'synthetic';
  assert.equal((await runtime.validatePuzzle({ puzzle: wrongKind })).ok, false);
});

test('createInitialState does not leak answer-only fields', async () => {
  const runtime = await createRuntime();
  const state = await runtime.createInitialState({ contentManifest: manifest, puzzle: fixture, date: '2026-05-22' });
  assert.equal(state.publicState.reveal, undefined);
  assert.equal(state.publicState.candidateNames.length, 100);
  assert.equal(JSON.stringify({ ...state.publicState, candidateNames: [] }).includes(fixture.extension.answer.canonicalName), false);
});

test('submitGuess rejects invalid input without consuming a guess', async () => {
  const runtime = await createRuntime();
  const state = await runtime.createInitialState({ contentManifest: manifest, puzzle: fixture, date: '2026-05-22' });
  for (const value of ['', 'Notacityville']) {
    const result = await runtime.submitGuess({ contentManifest: manifest, puzzle: fixture, state, input: { kind: 'text', value } });
    assert.equal(result.evaluation.consumedGuess, false);
    assert.equal(result.state.guessCount, 0);
  }
});

test('submitGuess returns stable feedback keys for a valid wrong city', async () => {
  const runtime = await createRuntime();
  const state = await runtime.createInitialState({ contentManifest: manifest, puzzle: fixture, date: '2026-05-22' });
  const result = await runtime.submitGuess({ contentManifest: manifest, puzzle: fixture, state, input: { kind: 'text', value: wrongCities[0].canonicalName } });
  assert.equal(result.evaluation.consumedGuess, true);
  assert.deepEqual(result.evaluation.feedback.map((item) => item.key), ['proximity', 'distance', 'direction', 'sameCountry', 'population']);
  assert.match(result.evaluation.message, /Incorrect:/);
  assert.match(result.evaluation.feedback.find((item) => item.key === 'distance').displayValue, /mi away/);
});

test('submitGuess accepts canonical names and normalized aliases', async () => {
  const runtime = await createRuntime();
  const canonicalState = await runtime.createInitialState({ contentManifest: manifest, puzzle: fixture, date: '2026-05-22' });
  const canonical = await runtime.submitGuess({ contentManifest: manifest, puzzle: fixture, state: canonicalState, input: { kind: 'text', value: fixture.extension.answer.canonicalName } });
  assert.equal(canonical.evaluation.outcome, 'correct');
  assert.equal(canonical.state.status, 'won');

  const aliasState = await runtime.createInitialState({ contentManifest: manifest, puzzle: fixture, date: '2026-05-22' });
  const alias = await runtime.submitGuess({ contentManifest: manifest, puzzle: fixture, state: aliasState, input: { kind: 'text', value: fixture.extension.answer.aliases[1] ?? fixture.extension.answer.aliases[0] } });
  assert.equal(alias.evaluation.outcome, 'correct');
  assert.equal(alias.state.status, 'won');
});

test('six wrong guesses loses and completed games reject further guesses', async () => {
  const runtime = await createRuntime();
  let state = await runtime.createInitialState({ contentManifest: manifest, puzzle: fixture, date: '2026-05-22' });
  for (const value of wrongCities.slice(0, 6).map((city) => city.canonicalName)) {
    const result = await runtime.submitGuess({ contentManifest: manifest, puzzle: fixture, state, input: { kind: 'text', value } });
    state = result.state;
  }
  assert.equal(state.status, 'lost');
  assert.equal(state.guessCount, 6);
  const afterComplete = await runtime.submitGuess({ contentManifest: manifest, puzzle: fixture, state, input: { kind: 'text', value: fixture.extension.answer.canonicalName } });
  assert.equal(afterComplete.evaluation.consumedGuess, false);
  assert.equal(afterComplete.state.guessCount, 6);
});

test('buildShareText excludes the answer', async () => {
  const runtime = await createRuntime();
  const state = await runtime.createInitialState({ contentManifest: manifest, puzzle: fixture, date: '2026-05-22' });
  const text = await runtime.buildShareText({ contentManifest: manifest, puzzle: fixture, state });
  assert.equal(text.includes(fixture.extension.answer.canonicalName), false);
  assert.match(text, /City Grid 2026-05-22/);
});
