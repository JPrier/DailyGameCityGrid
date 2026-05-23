const GAME_ID = 'city-grid';
const SPEC_VERSION = 'city-grid.spec.v1';
const CANDIDATE_SET = 'world-famous-cities-v1';
const MAX_GUESSES = 6;

const CANDIDATES = [
  {
    entityId: 'city:us:ma:boston',
    canonicalName: 'Boston',
    aliases: ['Boston, MA', 'Boston Massachusetts', 'Beantown', 'Boston MA'],
    countryCode: 'US',
    country: 'United States',
    admin1: 'Massachusetts',
    lat: 42.3601,
    lon: -71.0589,
    population: 675647,
    assetSlug: 'boston',
    clues: { continent: 'North America', country: 'United States', populationBand: '500k-1m', coastal: true, hasMajorRapidTransit: true },
  },
  {
    entityId: 'city:us:il:chicago',
    canonicalName: 'Chicago',
    aliases: ['Chicago, IL', 'Chicago Illinois', 'Windy City', 'Chicago IL'],
    countryCode: 'US',
    country: 'United States',
    admin1: 'Illinois',
    lat: 41.8781,
    lon: -87.6298,
    population: 2746388,
    assetSlug: 'chicago',
    clues: { continent: 'North America', country: 'United States', populationBand: '1m-5m', coastal: true, hasMajorRapidTransit: true },
  },
  {
    entityId: 'city:us:ny:new-york',
    canonicalName: 'New York',
    aliases: ['New York City', 'NYC', 'New York, NY', 'New York NY'],
    countryCode: 'US',
    country: 'United States',
    admin1: 'New York',
    lat: 40.7128,
    lon: -74.006,
    population: 8804190,
    assetSlug: 'new-york',
    clues: { continent: 'North America', country: 'United States', populationBand: '5m+', coastal: true, hasMajorRapidTransit: true },
  },
  {
    entityId: 'city:us:ca:los-angeles',
    canonicalName: 'Los Angeles',
    aliases: ['LA', 'L.A.', 'Los Angeles, CA', 'Los Angeles California'],
    countryCode: 'US',
    country: 'United States',
    admin1: 'California',
    lat: 34.0522,
    lon: -118.2437,
    population: 3898747,
    assetSlug: 'los-angeles',
    clues: { continent: 'North America', country: 'United States', populationBand: '1m-5m', coastal: true, hasMajorRapidTransit: true },
  },
  {
    entityId: 'city:us:wa:seattle',
    canonicalName: 'Seattle',
    aliases: ['Seattle, WA', 'Seattle Washington', 'Emerald City', 'Seattle WA'],
    countryCode: 'US',
    country: 'United States',
    admin1: 'Washington',
    lat: 47.6062,
    lon: -122.3321,
    population: 737015,
    assetSlug: 'seattle',
    clues: { continent: 'North America', country: 'United States', populationBand: '500k-1m', coastal: true, hasMajorRapidTransit: true },
  },
  {
    entityId: 'city:gb:eng:london',
    canonicalName: 'London',
    aliases: ['London, UK', 'London England', 'Greater London', 'London GB'],
    countryCode: 'GB',
    country: 'United Kingdom',
    admin1: 'England',
    lat: 51.5072,
    lon: -0.1276,
    population: 8982000,
    assetSlug: 'london',
    clues: { continent: 'Europe', country: 'United Kingdom', populationBand: '5m+', coastal: false, hasMajorRapidTransit: true },
  },
  {
    entityId: 'city:fr:idf:paris',
    canonicalName: 'Paris',
    aliases: ['Paris, France', 'Ville de Paris', 'Paris FR', 'City of Light'],
    countryCode: 'FR',
    country: 'France',
    admin1: 'Ile-de-France',
    lat: 48.8566,
    lon: 2.3522,
    population: 2161000,
    assetSlug: 'paris',
    clues: { continent: 'Europe', country: 'France', populationBand: '1m-5m', coastal: false, hasMajorRapidTransit: true },
  },
  {
    entityId: 'city:jp:tokyo:tokyo',
    canonicalName: 'Tokyo',
    aliases: ['Tokyo, Japan', 'Tokyo Metropolis', 'Tokyo JP', 'Tokio'],
    countryCode: 'JP',
    country: 'Japan',
    admin1: 'Tokyo',
    lat: 35.6762,
    lon: 139.6503,
    population: 13960000,
    assetSlug: 'tokyo',
    clues: { continent: 'Asia', country: 'Japan', populationBand: '5m+', coastal: true, hasMajorRapidTransit: true },
  },
];

const NORMALIZED_CANDIDATES = new Map();
for (const city of CANDIDATES) {
  const cityKeys = new Set();
  for (const name of [city.canonicalName, city.entityId, ...city.aliases]) {
    const key = normalizeGuess(name);
    if (cityKeys.has(key)) continue;
    cityKeys.add(key);
    if (!NORMALIZED_CANDIDATES.has(key)) NORMALIZED_CANDIDATES.set(key, []);
    NORMALIZED_CANDIDATES.get(key).push(city);
  }
}

export async function createRuntime() {
  return {
    contractVersion: 'daily-game-runtime.v1',
    validateContent,
    validatePuzzle,
    createInitialState,
    submitGuess,
    buildShareText,
  };
}

async function validateContent({ contentManifest }) {
  const errors = [];
  if (!contentManifest || contentManifest.schemaVersion !== 'daily-game-content-manifest.v1') {
    errors.push(error('schemaVersion', 'Manifest schemaVersion must be daily-game-content-manifest.v1.'));
  }
  if (contentManifest?.gameId !== GAME_ID) errors.push(error('gameId', 'Manifest gameId must be city-grid.'));
  if (!Number.isInteger(contentManifest?.defaultMaxGuesses) || contentManifest.defaultMaxGuesses < 3 || contentManifest.defaultMaxGuesses > 8) {
    errors.push(error('defaultMaxGuesses', 'City Grid max guesses must be between 3 and 8.'));
  }
  if (contentManifest?.extension?.specVersion !== SPEC_VERSION) errors.push(error('extension.specVersion', 'Unsupported City Grid spec version.'));
  if (contentManifest?.extension?.candidateSet !== CANDIDATE_SET) errors.push(error('extension.candidateSet', 'Unsupported candidate set.'));
  if (contentManifest?.extension?.distanceUnit !== 'mi') errors.push(error('extension.distanceUnit', 'Distance unit must be mi.'));
  if (contentManifest?.extension?.assetKind !== 'svg') errors.push(error('extension.assetKind', 'Asset kind must be svg.'));
  return result(errors);
}

async function validatePuzzle({ puzzle }) {
  const errors = [];
  if (!puzzle || puzzle.schemaVersion !== 'daily-game-puzzle.v1') errors.push(error('schemaVersion', 'Puzzle schemaVersion must be daily-game-puzzle.v1.'));
  if (puzzle?.gameId !== GAME_ID) errors.push(error('gameId', 'Puzzle gameId must be city-grid.'));
  if (!nonEmpty(puzzle?.puzzleId)) errors.push(error('puzzleId', 'Puzzle id is required.'));
  if (!nonEmpty(puzzle?.seed)) errors.push(error('seed', 'Puzzle seed is required.'));
  if (!nonEmpty(puzzle?.display?.title)) errors.push(error('display.title', 'Puzzle title is required.'));
  if (!nonEmpty(puzzle?.display?.initialPrompt)) errors.push(error('display.initialPrompt', 'Initial prompt is required.'));

  const ext = puzzle?.extension;
  if (!ext || typeof ext !== 'object') {
    errors.push(error('extension', 'Puzzle extension is required.'));
    return result(errors);
  }
  const answer = ext.answer;
  if (!answer || typeof answer !== 'object') {
    errors.push(error('extension.answer', 'Answer is required.'));
  } else {
    if (!nonEmpty(answer.entityId)) errors.push(error('extension.answer.entityId', 'Answer entity id is required.'));
    if (!nonEmpty(answer.canonicalName)) errors.push(error('extension.answer.canonicalName', 'Canonical answer is required.'));
    if (!Array.isArray(answer.aliases) || answer.aliases.length < 1) errors.push(error('extension.answer.aliases', 'At least one accepted alias is required.'));
    if (!Number.isFinite(answer.lat) || answer.lat < -90 || answer.lat > 90) errors.push(error('extension.answer.lat', 'Answer latitude must be finite.'));
    if (!Number.isFinite(answer.lon) || answer.lon < -180 || answer.lon > 180) errors.push(error('extension.answer.lon', 'Answer longitude must be finite.'));
    if (!Number.isFinite(answer.population) || answer.population <= 0) errors.push(error('extension.answer.population', 'Population must be positive.'));
  }
  if (ext.candidateSetId !== CANDIDATE_SET) errors.push(error('extension.candidateSetId', 'Puzzle candidate set is unsupported.'));
  if (!Array.isArray(ext.assetStages) || ext.assetStages.length < MAX_GUESSES) {
    errors.push(error('extension.assetStages', 'Six ordered visual stages are required.'));
  } else {
    ext.assetStages.forEach((stage, index) => {
      if (stage.stage !== index) errors.push(error(`extension.assetStages.${index}.stage`, 'Asset stages must be ordered from 0.'));
      if (!nonEmpty(stage.assetPath) || !stage.assetPath.endsWith('.svg')) errors.push(error(`extension.assetStages.${index}.assetPath`, 'Stage asset path must be an SVG.'));
      if (!Array.isArray(stage.reveals) || stage.reveals.length === 0) errors.push(error(`extension.assetStages.${index}.reveals`, 'Stage reveals are required.'));
    });
  }
  for (const key of ['continent', 'country', 'populationBand', 'coastal', 'hasMajorRapidTransit']) {
    if (!(key in (ext.clues ?? {}))) errors.push(error(`extension.clues.${key}`, `Missing clue ${key}.`));
  }
  return result(errors);
}

async function createInitialState({ contentManifest, puzzle, date }) {
  return {
    schemaVersion: 'daily-game-state.v1',
    gameId: GAME_ID,
    puzzleId: puzzle.puzzleId,
    date,
    status: 'in_progress',
    guessCount: 0,
    maxGuesses: contentManifest.defaultMaxGuesses ?? MAX_GUESSES,
    currentStage: 0,
    publicState: {
      history: [],
      revealedStage: 0,
      message: '',
    },
  };
}

async function submitGuess({ puzzle, state, input }) {
  if (!state || state.status !== 'in_progress') {
    return { state, evaluation: invalidEvaluation('Game is already complete.') };
  }
  const raw = typeof input?.value === 'string' ? input.value : '';
  const guessText = raw.trim();
  if (!guessText) {
    return { state: withMessage(state, 'Enter a city name.'), evaluation: invalidEvaluation('Enter a city name.') };
  }
  const matches = NORMALIZED_CANDIDATES.get(normalizeGuess(guessText)) ?? [];
  if (matches.length === 0) {
    return { state: withMessage(state, 'Unknown city. Try a major world city.'), evaluation: invalidEvaluation('Unknown city. Try a major world city.') };
  }
  if (matches.length > 1) {
    return { state: withMessage(state, `Be more specific: ${matches.map((m) => m.canonicalName).join(', ')}`), evaluation: invalidEvaluation('City name is ambiguous.') };
  }

  const guess = matches[0];
  const answer = puzzle.extension.answer;
  const correct = guess.entityId === answer.entityId || normalizeGuess(guessText) === normalizeGuess(answer.canonicalName) || answer.aliases.map(normalizeGuess).includes(normalizeGuess(guessText));
  const nextGuessCount = state.guessCount + 1;
  const nextStage = correct ? MAX_GUESSES - 1 : Math.min(MAX_GUESSES - 1, nextGuessCount);
  const status = correct ? 'won' : nextGuessCount >= state.maxGuesses ? 'lost' : 'in_progress';
  const feedback = correct ? [] : feedbackFor(guess, answer);
  const entry = {
    guess: guess.canonicalName,
    status: correct ? 'correct' : 'incorrect',
    feedback,
    stage: nextStage,
  };
  const publicState = {
    ...state.publicState,
    history: [...(state.publicState.history ?? []), entry],
    revealedStage: nextStage,
    message: correct ? 'Correct.' : status === 'lost' ? 'Game over.' : 'Incorrect.',
  };
  if (status !== 'in_progress') {
    publicState.reveal = revealFor(answer, puzzle.extension.assetStages[MAX_GUESSES - 1]?.assetPath);
  }
  const nextState = {
    ...state,
    status,
    guessCount: nextGuessCount,
    currentStage: nextStage,
    publicState,
  };
  return {
    state: nextState,
    evaluation: {
      outcome: correct ? 'correct' : 'incorrect',
      consumedGuess: true,
      message: publicState.message,
      feedback,
    },
  };
}

async function buildShareText({ state }) {
  const emoji = '🏙️';
  const result = state.status === 'won' ? `${state.guessCount}/${state.maxGuesses}` : state.status === 'lost' ? `X/${state.maxGuesses}` : `${state.guessCount}/${state.maxGuesses}`;
  const rows = Array.from({ length: Math.max(1, state.guessCount) }, (_, index) => {
    if (state.status === 'won' && index === state.guessCount - 1) return '🟩';
    return '⬛';
  }).join('');
  return `${emoji} City Grid ${state.date}\nResult: ${result}\n${rows}`;
}

function feedbackFor(guess, answer) {
  const distance = Math.round(distanceMiles(guess.lat, guess.lon, answer.lat, answer.lon));
  return [
    { key: 'distance', label: 'Distance', kind: 'distance', value: `${distance} mi`, severity: 'neutral' },
    { key: 'direction', label: 'Direction', kind: 'direction', value: compassDirection(guess.lat, guess.lon, answer.lat, answer.lon), severity: 'neutral' },
    { key: 'sameCountry', label: 'Same country', kind: 'boolean', value: guess.countryCode === answer.countryCode, severity: guess.countryCode === answer.countryCode ? 'good' : 'bad' },
    { key: 'population', label: 'Population', kind: 'comparison', value: answer.population > guess.population ? 'answer-larger' : 'answer-smaller', severity: 'neutral' },
  ];
}

function revealFor(answer, fullMapAssetPath) {
  return {
    canonicalName: answer.canonicalName,
    country: answer.country ?? countryName(answer.countryCode),
    countryCode: answer.countryCode,
    admin1: answer.admin1,
    population: answer.population,
    fullMapAssetPath,
  };
}

function normalizeGuess(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function withMessage(state, message) {
  return { ...state, publicState: { ...state.publicState, message } };
}

function invalidEvaluation(message) {
  return { outcome: 'invalid', consumedGuess: false, message, feedback: [{ key: 'validation', label: 'Validation', kind: 'text', value: message, severity: 'warning' }] };
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const radius = 3958.8;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compassDirection(lat1, lon1, lat2, lon2) {
  const y = Math.sin(radians(lon2 - lon1)) * Math.cos(radians(lat2));
  const x = Math.cos(radians(lat1)) * Math.sin(radians(lat2)) - Math.sin(radians(lat1)) * Math.cos(radians(lat2)) * Math.cos(radians(lon2 - lon1));
  const bearing = (degrees(Math.atan2(y, x)) + 360) % 360;
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return directions[Math.round(bearing / 45) % 8];
}

function radians(value) {
  return (value * Math.PI) / 180;
}

function degrees(value) {
  return (value * 180) / Math.PI;
}

function countryName(code) {
  return { US: 'United States', GB: 'United Kingdom', FR: 'France', JP: 'Japan' }[code] ?? code;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function error(path, message) {
  return { code: 'invalid_city_grid', path, message };
}

function result(errors) {
  return errors.length ? { ok: false, errors, warnings: [] } : { ok: true, warnings: [] };
}
