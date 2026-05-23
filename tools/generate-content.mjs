import fs from 'node:fs';
import path from 'node:path';
import {
  CANDIDATE_PATH,
  FIXTURE_INDICES,
  POOL_SIZE,
  REVEALS,
  SOURCE_MANIFEST_PATH,
  geometryForCity,
  loadCandidates,
  loadFixtureSource,
  loadSourceManifest,
  renderSvgStage,
  sha256,
  validateCandidates,
  validateSourceManifest,
  writeJson,
} from './city-grid/model.mjs';

const root = process.cwd();
const mode = argValue('--mode') ?? 'locked';
if (!['locked', 'online-refresh'].includes(mode)) throw new Error(`Unsupported mode ${mode}`);

const candidates = loadCandidates(root);
const sourceManifest = loadSourceManifest(root);
if (mode === 'online-refresh') {
  for (const source of sourceManifest.sources) {
    const local = path.join(root, source.localPath);
    if (!fs.existsSync(local)) throw new Error(`Cannot refresh missing local fixture source ${source.localPath}`);
    source.sha256 = sha256(local);
  }
  sourceManifest.mode = 'online-refresh';
  sourceManifest.generatedAt = new Date().toISOString();
  writeJson(root, SOURCE_MANIFEST_PATH, sourceManifest);
} else {
  const sourceErrors = validateSourceManifest(root, sourceManifest, { mode });
  if (sourceErrors.length) throw new Error(sourceErrors.join('\n'));
}
const candidateErrors = validateCandidates(candidates, sourceManifest);
if (candidateErrors.length) throw new Error(candidateErrors.join('\n'));

const fixture = loadFixtureSource(root, sourceManifest);
const manifest = {
  schemaVersion: 'daily-game-content-manifest.v1',
  gameId: 'city-grid',
  displayName: 'City Grid',
  inputModes: ['text'],
  defaultMaxGuesses: 6,
  puzzleResolver: {
    mode: 'static-pool',
    timezone: 'America/New_York',
    startDate: '2026-01-01',
    poolVersions: [
      {
        version: 'v1',
        startDate: '2026-01-01',
        poolSize: POOL_SIZE,
        pathPattern: 'content/puzzles/v1/puzzle-{index:04}.json',
        selector: { type: 'affine-permutation', a: 137, b: 431 },
        cyclePolicy: 'repeat',
      },
    ],
  },
  archive: {
    mode: 'rolling-window',
    days: 30,
    includeToday: true,
    allowFutureDates: false,
    directAccess: 'within-archive-window',
  },
  extension: {
    specVersion: 'city-grid.spec.v1',
    candidateSet: candidates.candidateSetId,
    candidateFile: CANDIDATE_PATH,
    sourceManifest: SOURCE_MANIFEST_PATH,
    distanceUnit: 'mi',
    assetKind: 'svg',
  },
};
writeJson(root, 'content/manifest.json', manifest);

const geometries = new Map();
for (const city of candidates.cities) {
  const geometry = geometryForCity(city, fixture);
  geometries.set(city.entityId, geometry);
  const assetDir = path.join(root, 'content/assets/v1/city-grid', city.assetSlug);
  fs.mkdirSync(assetDir, { recursive: true });
  for (let stage = 0; stage < 6; stage += 1) {
    fs.writeFileSync(path.join(assetDir, `stage-${stage}.svg`), renderSvgStage(geometry, stage));
  }
}

const puzzleDir = path.join(root, 'content/puzzles/v1');
fs.mkdirSync(puzzleDir, { recursive: true });
for (let index = 0; index < POOL_SIZE; index += 1) {
  const city = FIXTURE_INDICES.has(index) ? candidates.cities[0] : candidates.cities[index % candidates.cities.length];
  const geometry = geometries.get(city.entityId);
  const puzzle = {
    schemaVersion: 'daily-game-puzzle.v1',
    gameId: 'city-grid',
    puzzleId: `city-grid-v1-${String(index).padStart(4, '0')}`,
    date: '2026-01-01',
    seed: `city-grid-v1-${String(index).padStart(4, '0')}`,
    display: {
      title: 'City Grid',
      initialPrompt: 'Identify the city from the unlabeled street grid.',
    },
    extension: {
      answer: answerFor(city),
      candidateSetId: candidates.candidateSetId,
      source: {
        kind: 'osm-derived',
        sourceManifest: SOURCE_MANIFEST_PATH,
        sourceExtractId: city.sourceExtractId,
        bbox: city.bbox,
        geometryVersion: geometry.schemaVersion,
      },
      assetStages: Array.from({ length: 6 }, (_, stage) => ({
        stage,
        assetPath: `content/assets/v1/city-grid/${city.assetSlug}/stage-${stage}.svg`,
        reveals: REVEALS[stage],
      })),
      geometryMetrics: geometry.metrics,
      clues: {
        continent: city.continent,
        country: city.country,
        populationBand: city.populationBand,
        coastal: city.coastal,
        hasMajorRapidTransit: city.hasMajorRapidTransit,
      },
    },
  };
  fs.writeFileSync(path.join(puzzleDir, `puzzle-${String(index).padStart(4, '0')}.json`), `${JSON.stringify(puzzle, null, 2)}\n`);
}

console.log(`Generated ${POOL_SIZE} City Grid puzzles from ${candidates.cities.length} locked OSM-derived city geometries.`);

function answerFor(city) {
  return {
    entityId: city.entityId,
    canonicalName: city.canonicalName,
    aliases: city.aliases,
    countryCode: city.countryCode,
    country: city.country,
    admin1: city.admin1,
    lat: city.lat,
    lon: city.lon,
    population: city.population,
  };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}
