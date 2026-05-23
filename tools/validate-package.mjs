import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CANDIDATE_PATH,
  SOURCE_MANIFEST_PATH,
  loadCandidates,
  loadSourceManifest,
  normalizeName,
  readJson,
  validateCandidates,
  validateSourceManifest,
} from './city-grid/model.mjs';

const root = process.cwd();
const errors = new Set();
const packageConfig = readJson(root, 'daily-game.config.json');
const manifest = readJson(root, 'content/manifest.json');
const candidates = loadCandidates(root);
const sourceManifest = loadSourceManifest(root);

if (packageConfig.build?.mode !== 'command') errors.add('package build.mode must be command');
if (manifest.extension?.candidateSet !== candidates.candidateSetId) errors.add('manifest candidateSet must match candidate file');
if (manifest.extension?.candidateFile !== CANDIDATE_PATH) errors.add('manifest candidateFile must reference candidate file');
if (manifest.extension?.sourceManifest !== SOURCE_MANIFEST_PATH) errors.add('manifest sourceManifest must reference source manifest');
for (const error of validateSourceManifest(root, sourceManifest, { mode: 'locked' })) errors.add(error);
for (const error of validateCandidates(candidates, sourceManifest)) errors.add(error);

const runtime = await import(pathToFileURL(path.join(root, packageConfig.runtime.entry)).href).then((mod) => mod.createRuntime());
const contentValidation = await runtime.validateContent({ packageConfig, contentManifest: manifest, dateIndex: null });
recordRuntimeErrors(contentValidation, 'content');

const poolSize = manifest.puzzleResolver.poolVersions[0].poolSize;
const candidateById = new Map(candidates.cities.map((city) => [city.entityId, city]));
const sourceIds = new Set(sourceManifest.sources.map((source) => source.id));
for (let index = 0; index < poolSize; index += 1) {
  const file = path.join(root, `content/puzzles/v1/puzzle-${String(index).padStart(4, '0')}.json`);
  if (!fs.existsSync(file)) {
    errors.add(`missing puzzle ${file}`);
    continue;
  }
  const puzzle = JSON.parse(fs.readFileSync(file, 'utf8'));
  validatePuzzle(puzzle, file, candidateById, sourceIds);
  const runtimeValidation = await runtime.validatePuzzle({ contentManifest: manifest, puzzle });
  recordRuntimeErrors(runtimeValidation, `puzzle ${puzzle.puzzleId}`);
}

if (errors.size) {
  console.error([...errors].join('\n'));
  process.exit(1);
}
console.log(`Validated City Grid package: ${poolSize} puzzles, ${candidates.cities.length} candidates, ${sourceManifest.sources.length} locked source manifest.`);

function validatePuzzle(puzzle, file, candidateById, sourceIds) {
  const ext = puzzle.extension ?? {};
  const answer = ext.answer;
  const candidate = candidateById.get(answer?.entityId);
  if (!candidate) errors.add(`${file}: puzzle answer is absent from candidate file`);
  if (ext.candidateSetId !== candidates.candidateSetId) errors.add(`${file}: candidate set mismatch`);
  if (ext.source?.kind !== 'osm-derived') errors.add(`${file}: production puzzle source.kind must be osm-derived`);
  if (!ext.source?.sourceManifest || !ext.source?.sourceExtractId || !ext.source?.geometryVersion) errors.add(`${file}: missing source provenance`);
  if (ext.source?.sourceExtractId && !sourceIds.has(ext.source.sourceExtractId)) errors.add(`${file}: sourceExtractId missing from source manifest`);
  if (candidate) {
    for (const key of ['canonicalName', 'countryCode', 'country', 'admin1', 'population']) {
      if (answer[key] !== candidate[key]) errors.add(`${file}: answer ${key} disagrees with candidate file`);
    }
    for (const alias of answer.aliases ?? []) {
      if (!candidate.aliases.map(normalizeName).includes(normalizeName(alias))) errors.add(`${file}: answer alias ${alias} disagrees with candidate file`);
    }
  }
  const metrics = ext.geometryMetrics ?? {};
  if (metrics.roadLineCount < 50) errors.add(`${file}: roadLineCount below threshold`);
  if (metrics.roadTotalLengthMeters < 10000) errors.add(`${file}: roadTotalLengthMeters below threshold`);
  if (metrics.intersectionCount < 25) errors.add(`${file}: intersectionCount below threshold`);
  if (!Array.isArray(ext.assetStages) || ext.assetStages.length !== 6) errors.add(`${file}: six asset stages are required`);
  const stageSvgs = [];
  for (const stage of ext.assetStages ?? []) {
    const assetPath = path.join(root, stage.assetPath ?? '');
    if (!fs.existsSync(assetPath)) {
      errors.add(`${file}: missing asset ${stage.assetPath}`);
      continue;
    }
    const svg = fs.readFileSync(assetPath, 'utf8');
    stageSvgs[stage.stage] = svg;
    if (!/<(path|polyline|polygon)[\s>]/i.test(svg)) errors.add(`${stage.assetPath}: SVG has no geometry`);
    if (/<text[\s>]/i.test(svg)) errors.add(`${stage.assetPath}: SVG must not contain text labels`);
    for (const forbidden of [answer?.canonicalName, answer?.admin1, answer?.country, answer?.countryCode, ...(answer?.aliases ?? [])].filter((value) => String(value).trim().length >= 3)) {
      if (svg.toLowerCase().includes(String(forbidden).toLowerCase())) errors.add(`${stage.assetPath}: SVG leaks answer text ${forbidden}`);
    }
    if (/synthetic|hash\(|hsl\(/i.test(svg)) errors.add(`${stage.assetPath}: production SVG appears synthetic`);
  }
  if (stageSvgs[0] && stageSvgs[1] && stageSvgs[0] === stageSvgs[1]) errors.add(`${file}: stage 0 and stage 1 SVGs are identical`);
  if (stageSvgs[0] && stageSvgs[5] && geometryCount(stageSvgs[5]) <= geometryCount(stageSvgs[0])) errors.add(`${file}: final stage must include more geometry than stage 0`);
}

function geometryCount(svg) {
  return (svg.match(/<(path|polyline|polygon|circle)\b/gi) ?? []).length;
}

function recordRuntimeErrors(result, label) {
  if (result?.ok === true) return;
  for (const error of result?.errors ?? [{ message: 'runtime validation failed' }]) {
    errors.add(`${label}: runtime validation failed: ${error.path ? `${error.path}: ` : ''}${error.message}`);
  }
}
