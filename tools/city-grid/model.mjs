import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CANDIDATE_PATH = 'content/candidates/fixture-famous-cities-v1.json';
export const SOURCE_MANIFEST_PATH = 'content/source/osm-source-manifest.json';
export const POOL_SIZE = 1000;
export const FIXTURE_INDICES = new Set([431, 748]);
export const REVEALS = [
  ['roads-tight'],
  ['roads-wide'],
  ['water', 'coastline'],
  ['parks', 'rail'],
  ['anonymous-landmarks'],
  ['full-map-geometry'],
];

export function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

export function writeJson(root, rel, value) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function loadCandidates(root) {
  return readJson(root, CANDIDATE_PATH);
}

export function loadSourceManifest(root) {
  return readJson(root, SOURCE_MANIFEST_PATH);
}

export function normalizeName(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function validateCandidates(candidates, sourceManifest) {
  const errors = [];
  if (candidates.schemaVersion !== 'city-grid-candidates.v1') errors.push('candidate schemaVersion must be city-grid-candidates.v1');
  if (!candidates.candidateSetId) errors.push('candidateSetId is required');
  if (!Array.isArray(candidates.cities) || candidates.cities.length === 0) errors.push('cities must be non-empty');
  if (candidates.cities?.length < candidates.minimumUniqueAnswers) errors.push('candidate count is below minimumUniqueAnswers');
  const sourceIds = new Set(sourceManifest.sources?.map((source) => source.id) ?? []);
  const entityIds = new Set();
  const aliases = new Map();
  for (const city of candidates.cities ?? []) {
    if (!city.entityId || entityIds.has(city.entityId)) errors.push(`duplicate or missing entityId ${city.entityId ?? ''}`);
    entityIds.add(city.entityId);
    if (!city.canonicalName) errors.push(`${city.entityId}: canonicalName is required`);
    if (!Array.isArray(city.aliases) || city.aliases.length < 3) errors.push(`${city.entityId}: at least three aliases are required`);
    if (!Number.isFinite(city.lat) || !Number.isFinite(city.lon)) errors.push(`${city.entityId}: finite lat/lon required`);
    if (!validBbox(city.bbox)) errors.push(`${city.entityId}: valid bbox required`);
    if (!sourceIds.has(city.sourceExtractId)) errors.push(`${city.entityId}: sourceExtractId not found in source manifest`);
    for (const name of [city.canonicalName, ...(city.aliases ?? [])]) {
      const normalized = normalizeName(name);
      if (normalized.length < 3) continue;
      const prior = aliases.get(normalized);
      if (prior && prior !== city.entityId) errors.push(`duplicate normalized alias "${normalized}" for ${prior} and ${city.entityId}`);
      aliases.set(normalized, city.entityId);
    }
  }
  return errors;
}

export function validateSourceManifest(root, sourceManifest, { mode = 'locked' } = {}) {
  const errors = [];
  if (sourceManifest.schemaVersion !== 'city-grid-osm-source-manifest.v1') errors.push('source manifest schemaVersion must be city-grid-osm-source-manifest.v1');
  if (!Array.isArray(sourceManifest.sources) || sourceManifest.sources.length === 0) errors.push('source manifest must list sources');
  for (const source of sourceManifest.sources ?? []) {
    if (!source.id) errors.push('source id is required');
    if (!source.localPath) errors.push(`${source.id}: localPath is required`);
    if (source.localPath && (path.isAbsolute(source.localPath) || source.localPath.includes('..'))) errors.push(`${source.id}: localPath must stay inside package root`);
    const local = source.localPath ? path.join(root, source.localPath) : '';
    if (mode === 'locked') {
      if (!fs.existsSync(local)) {
        errors.push(`${source.id}: locked source localPath is missing`);
      } else if (source.sha256 && sha256(local) !== source.sha256) {
        errors.push(`${source.id}: locked source sha256 mismatch`);
      }
    }
  }
  return errors;
}

export function loadFixtureSource(root, sourceManifest) {
  const source = sourceManifest.sources[0];
  return readJson(root, source.localPath);
}

export function geometryForCity(city, fixture) {
  const profileName = fixture.cityProfiles?.[city.entityId];
  const profile = fixture.profiles?.[profileName];
  if (!profile) throw new Error(`missing fixture geometry profile for ${city.entityId}`);
  return buildGeometry(city, profile);
}

export function buildGeometry(city, profile) {
  const offset = profile.offset ?? 0;
  const roadsMajor = [];
  const roadsMinor = [];
  for (let i = 0; i < 12; i += 1) {
    const y = 22 + i * 22 + (offset % 9);
    roadsMajor.push(line([[18, y], [95, y + wave(i, offset)], [205, y - wave(i + 1, offset)], [402, y + wave(i + 2, offset)]]));
  }
  for (let i = 0; i < 12; i += 1) {
    const x = 24 + i * 32 + (offset % 11);
    roadsMajor.push(line([[x, 18], [x + wave(i, offset), 82], [x - wave(i + 2, offset), 186], [x + wave(i + 4, offset), 302]]));
  }
  for (let i = 0; i < 22; i += 1) {
    const y = 18 + ((i * 13 + offset) % 286);
    roadsMinor.push(line([[8, y], [130, y + wave(i, offset)], [256, y - wave(i + 3, offset)], [412, y + wave(i + 5, offset)]]));
  }
  for (let i = 0; i < 22; i += 1) {
    const x = 10 + ((i * 19 + offset) % 392);
    roadsMinor.push(line([[x, 8], [x + wave(i + 1, offset), 118], [x - wave(i + 4, offset), 224], [x + wave(i + 6, offset), 312]]));
  }
  const water = profile.water
    ? [
        polygon([[0, 230 + (offset % 19)], [74, 214], [142, 238], [228, 226], [320, 202], [420, 224], [420, 320], [0, 320]]),
        line([[12, 248], [118, 230], [215, 238], [316, 216], [408, 236]]),
      ]
    : [];
  const parks = profile.park
    ? [
        polygon([[42, 164], [112, 148], [142, 204], [96, 258], [32, 238]]),
        polygon([[254, 50], [326, 80], [300, 148], [224, 154], [198, 96]]),
      ]
    : [];
  const rail = profile.rail ? [line([[28, 286], [104, 244], [184, 214], [254, 168], [326, 92], [398, 42]])] : [];
  const landmarks = [[144, 119], [247, 204], [333, 108], [92, 72]].map(([x, y]) => ({ x, y }));
  const roadLineCount = roadsMajor.reduce((sum, item) => sum + item.points.length - 1, 0) + roadsMinor.reduce((sum, item) => sum + item.points.length - 1, 0);
  const roadTotalLengthMeters = Math.round((roadsMajor.length * 2100 + roadsMinor.length * 900) * (1 + (offset % 7) / 20));
  const intersectionCount = Math.round(roadsMajor.length * roadsMinor.length * 0.28);
  return {
    schemaVersion: 'city-grid-geometry.v1',
    cityEntityId: city.entityId,
    sourceExtractId: city.sourceExtractId,
    bbox: city.bbox,
    projection: 'local-web-mercator',
    layers: { roadsMajor, roadsMinor, rail, water, parks, landmarks },
    metrics: {
      roadLineCount,
      roadTotalLengthMeters,
      intersectionCount,
      waterGeometryCount: water.length,
      parkGeometryCount: parks.length,
      railLineCount: rail.length,
    },
  };
}

export function renderSvgStage(geometry, stage) {
  const layers = geometry.layers;
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 320" role="img" aria-label="Unlabeled street-grid crop">',
    '<rect width="420" height="320" fill="#efe7d2"/>',
  ];
  if (stage >= 2) parts.push(...layers.water.map((item) => renderGeometry(item, '#9bc7d8', '#5c93a6', 0.72, 3)));
  if (stage >= 3) parts.push(...layers.parks.map((item) => renderGeometry(item, '#83a66b', '#6f9658', 0.72, 2)));
  if (stage >= 3) parts.push(...layers.rail.map((item) => renderGeometry(item, 'none', '#6f4f37', 0.8, 5, '12 9')));
  parts.push(...layers.roadsMajor.map((item) => renderGeometry(item, 'none', '#263632', 0.92, stage === 0 ? 5 : 4)));
  if (stage >= 1) parts.push(...layers.roadsMinor.map((item) => renderGeometry(item, 'none', '#69756f', 0.72, 2)));
  if (stage >= 4) parts.push('<g fill="#bf5f45" opacity="0.88">', ...layers.landmarks.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="6"/>`), '</g>');
  if (stage >= 5) parts.push('<rect x="14" y="14" width="392" height="292" rx="18" fill="none" stroke="#183a37" stroke-width="3" opacity="0.45"/>');
  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}

function renderGeometry(item, fill, stroke, opacity, strokeWidth, dash = '') {
  const d = pathData(item.points, item.type === 'polygon');
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${dashAttr} stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;
}

function pathData(points, close) {
  const [first, ...rest] = points;
  return [`M${first[0]} ${first[1]}`, ...rest.map(([x, y]) => `L${x} ${y}`), close ? 'Z' : ''].filter(Boolean).join(' ');
}

function line(points) {
  return { type: 'line', points: points.map(clampPoint) };
}

function polygon(points) {
  return { type: 'polygon', points: points.map(clampPoint) };
}

function clampPoint([x, y]) {
  return [Math.max(0, Math.min(420, Math.round(x))), Math.max(0, Math.min(320, Math.round(y)))];
}

function wave(index, offset) {
  return ((index * 17 + offset) % 31) - 15;
}

function validBbox(bbox) {
  return bbox && Number.isFinite(bbox.left) && Number.isFinite(bbox.right) && Number.isFinite(bbox.bottom) && Number.isFinite(bbox.top) && bbox.left < bbox.right && bbox.bottom < bbox.top;
}
