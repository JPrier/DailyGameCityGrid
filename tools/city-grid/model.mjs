import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CANDIDATE_PATH = 'content/candidates/world-famous-cities-geonames-v1.json';
export const SOURCE_MANIFEST_PATH = 'content/source/osm-source-manifest.json';
export const POOL_SIZE = 1000;
export const REVEALS = [
  ['roads-tight'],
  ['roads-wide', 'arterials'],
  ['water', 'coastline'],
  ['parks', 'rail'],
  ['neighborhood-streets', 'anonymous-landmarks'],
  ['full-street-network', 'full-map-geometry'],
];

const VIEWBOX = { width: 420, height: 320, pad: 10 };
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const MAX_SOURCE_ELEMENTS = {
  roadsMajor: 700,
  roadsMinor: 3200,
  rail: 100,
  water: 160,
  parks: 140,
};
const MAX_POINTS_PER_ELEMENT = 36;
const SOURCE_SELECTION_VERSION = 'coverage-roads-v3';

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

export function loadRealOsmSource(root, sourceManifest) {
  const source = sourceManifest.sources[0];
  const data = readJson(root, source.localPath);
  if (data.schemaVersion !== 'city-grid-real-osm-source.v1') {
    throw new Error(`${source.localPath}: schemaVersion must be city-grid-real-osm-source.v1`);
  }
  return data;
}

export async function refreshRealOsmSource(root, candidates, sourceManifest) {
  const source = sourceManifest.sources[0];
  const sourceFile = path.join(root, source.localPath);
  const prior = fs.existsSync(sourceFile) ? readJson(root, source.localPath) : null;
  const cities = { ...(prior?.cities ?? {}) };
  let index = 0;
  for (const city of candidates.cities) {
    index += 1;
    if (cities[city.entityId]?.elements?.length && cities[city.entityId].selectionVersion === SOURCE_SELECTION_VERSION && compatibleSourceBbox(city, cities[city.entityId].bbox)) {
      console.log(`[${index}/${candidates.cities.length}] ${city.canonicalName}: using cached OSM source`);
      continue;
    }
    console.log(`[${index}/${candidates.cities.length}] ${city.canonicalName}: fetching OSM source`);
    const fetched = await fetchCityElements(city);
    const elements = selectRenderableElements(fetched.elements);
    cities[city.entityId] = {
      bbox: fetched.bbox,
      selectionVersion: SOURCE_SELECTION_VERSION,
      fetchedAt: new Date().toISOString(),
      elementCount: elements.length,
      elements: elements.map(trimOsmElement),
    };
    const partialDocument = {
      schemaVersion: 'city-grid-real-osm-source.v1',
      generatedAt: new Date().toISOString(),
      sourceId: source.id,
      attribution: 'OpenStreetMap contributors',
      license: 'ODbL-1.0',
      queryKind: 'overpass-api-json',
      cities,
    };
    writeJson(root, source.localPath, partialDocument);
  }

  const sourceDocument = {
    schemaVersion: 'city-grid-real-osm-source.v1',
    generatedAt: new Date().toISOString(),
    sourceId: source.id,
    attribution: 'OpenStreetMap contributors',
    license: 'ODbL-1.0',
    queryKind: 'overpass-api-json',
    cities,
  };
  writeJson(root, source.localPath, sourceDocument);
  source.sha256 = sha256(path.join(root, source.localPath));
  sourceManifest.mode = 'locked';
  sourceManifest.generatedAt = sourceDocument.generatedAt;
  writeJson(root, SOURCE_MANIFEST_PATH, sourceManifest);
  return sourceDocument;
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
    if (!city.assetSlug) errors.push(`${city.entityId}: assetSlug is required`);
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
    if (source.kind !== 'overpass-api-json') errors.push(`${source.id}: kind must be overpass-api-json`);
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

export function validateRealOsmSource(candidates, source) {
  const errors = [];
  for (const city of candidates.cities) {
    const entry = source.cities?.[city.entityId];
    if (!entry) {
      errors.push(`${city.entityId}: missing real OSM source entry`);
      continue;
    }
    const highwayCount = entry.elements.filter((element) => element.tags?.highway).length;
    if (highwayCount < 20) errors.push(`${city.entityId}: real OSM source has too few highway ways`);
    if (!entry.elements.some((element) => Array.isArray(element.geometry) && element.geometry.length >= 2)) {
      errors.push(`${city.entityId}: real OSM source contains no renderable geometry`);
    }
  }
  return errors;
}

export function geometryForCity(city, realOsmSource) {
  const entry = realOsmSource.cities?.[city.entityId];
  if (!entry) throw new Error(`missing real OSM geometry for ${city.entityId}`);
  const projectionBbox = validBbox(entry.bbox) ? entry.bbox : city.bbox;

  const layers = {
    roadsMajor: [],
    roadsMinor: [],
    rail: [],
    water: [],
    parks: [],
    landmarks: [],
  };
  const roadPoints = [];
  let roadTotalLengthMeters = 0;

  for (const element of entry.elements) {
    const points = projectGeometry(element.geometry ?? [], projectionBbox);
    if (points.length < 2) continue;
    const simplified = simplifyPoints(points, 1.2);
    const kind = layerForTags(element.tags ?? {});
    if (!kind) continue;
    const sourceLengthMeters = lengthMeters(element.geometry ?? []);
    const geometry = {
      type: polygonLike(element.tags ?? {}, element.geometry ?? []) ? 'polygon' : 'line',
      points: simplified,
      tags: element.tags ?? {},
      lengthMeters: Math.round(sourceLengthMeters),
    };
    layers[kind].push(geometry);
    if (kind === 'roadsMajor' || kind === 'roadsMinor') {
      roadTotalLengthMeters += sourceLengthMeters;
      for (const point of simplified) roadPoints.push(point);
    }
  }

  layers.landmarks = landmarkPoints(layers);
  const roadLineCount = layers.roadsMajor.length + layers.roadsMinor.length;
  const intersectionCount = estimateIntersections(roadPoints);

  return {
    schemaVersion: 'city-grid-geometry.v1',
    cityEntityId: city.entityId,
    sourceExtractId: city.sourceExtractId,
    bbox: projectionBbox,
    projection: 'local-web-mercator-north-up',
    orientation: 'north-up',
    layers,
    metrics: {
      roadLineCount,
      roadTotalLengthMeters: Math.round(roadTotalLengthMeters),
      intersectionCount,
      waterGeometryCount: layers.water.length,
      parkGeometryCount: layers.parks.length,
      railLineCount: layers.rail.length,
    },
  };
}

export function renderSvgStage(geometry, stage) {
  const layers = geometry.layers;
  const majorRoads = importantLines(layers.roadsMajor);
  const minorRoads = importantLines(layers.roadsMinor);
  const rail = importantLines(layers.rail);
  const water = importantLines(layers.water);
  const parks = importantLines(layers.parks);
  const roadPoints = [...layers.roadsMajor, ...layers.roadsMinor].flatMap((item) => item.points);
  const waterFills = coastlineWaterFills(water, roadPoints);
  const coastal = water.some((item) => item.tags?.natural === 'coastline');
  const visibleMajorRoads = majorRoads.slice(0, stage >= 5 ? majorRoads.length : ([42, 72, 96, 112, 160][stage] ?? majorRoads.length));
  const visibleMinorRoads = minorRoads.slice(0, stage >= 5 ? minorRoads.length : ([0, 70, 120, 160, 240][stage] ?? minorRoads.length));
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 320" role="img" aria-label="Unlabeled north-up street-grid crop" data-orientation="north-up">',
    '<metadata>{"orientation":"north-up","projection":"local-web-mercator"}</metadata>',
    '<defs>',
    '<clipPath id="mapCrop"><rect x="8" y="8" width="404" height="304" rx="16"/></clipPath>',
    '</defs>',
    '<rect width="420" height="320" fill="#ede7d8"/>',
    '<rect x="8" y="8" width="404" height="304" rx="16" fill="#f7f1e3" stroke="#d8cbb2" stroke-width="1.25"/>',
    '<g clip-path="url(#mapCrop)">',
  ];
  if (stage >= 2) {
    if (coastal) parts.push('<rect data-layer="coastal-water-base" x="8" y="8" width="404" height="304" fill="#76c5e2" opacity="0.78"/>');
    parts.push('<g data-layer="water-fill">', ...waterFills.map(renderWaterFill), '</g>');
    if (coastal) {
      parts.push('<g data-layer="land-wash">');
      parts.push(...visibleMajorRoads.map(renderLandWash));
      parts.push(...visibleMinorRoads.map(renderLandWash));
      if (stage >= 3) parts.push(...parks.map(renderLandWash));
      parts.push('</g>');
    }
    parts.push('<g data-layer="water-casing">', ...water.map((item) => renderFeature(item, 'water-casing', stage)), '</g>');
    parts.push('<g data-layer="water">', ...water.map((item) => renderFeature(item, 'water', stage)), '</g>');
  }
  if (stage >= 3) {
    parts.push('<g data-layer="parks">', ...parks.map((item) => renderFeature(item, 'park', stage)), '</g>');
  }
  parts.push('<g data-layer="major-road-casing">', ...visibleMajorRoads.map((item) => renderFeature(item, 'major-casing', stage)), '</g>');
  parts.push('<g data-layer="major-road">', ...visibleMajorRoads.map((item) => renderFeature(item, 'major-road', stage)), '</g>');
  if (visibleMinorRoads.length > 0) {
    parts.push('<g data-layer="minor-road-casing">', ...visibleMinorRoads.map((item) => renderFeature(item, 'minor-casing', stage)), '</g>');
    parts.push('<g data-layer="minor-road">', ...visibleMinorRoads.map((item) => renderFeature(item, 'minor-road', stage)), '</g>');
  }
  if (stage >= 3) {
    parts.push('<g data-layer="rail">', ...rail.map((item) => renderFeature(item, 'rail', stage)), '</g>');
  }
  if (stage >= 4) {
    parts.push('<g data-layer="anonymous-feature-points" fill="#bf5b3e" stroke="#fff8ec" stroke-width="1.6" opacity="0.78">', ...layers.landmarks.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="${stage >= 5 ? 3.8 : 4.8}"/>`), '</g>');
  }
  if (stage >= 5) {
    parts.push('<g data-layer="final-detail-network">');
    parts.push(...majorRoads.slice(visibleMajorRoads.length).map((item) => renderFeature(item, 'major-road', stage)));
    parts.push(...minorRoads.slice(visibleMinorRoads.length).map((item) => renderFeature(item, 'minor-road', stage)));
    parts.push('</g>');
  }
  parts.push('</g>');
  parts.push('<g data-layer="north-up-compass" fill="none" stroke="#233934" stroke-linecap="round" stroke-linejoin="round" opacity="0.62">');
  parts.push('<path d="M382 48L382 23" stroke-width="1.8"/>');
  parts.push('<path d="M382 23L373 39M382 23L391 39" stroke-width="1.8"/>');
  parts.push('<circle cx="382" cy="48" r="13" stroke-width="1.1" opacity="0.38"/>');
  parts.push('</g>');
  parts.push('<rect x="8" y="8" width="404" height="304" rx="16" fill="none" stroke="#233934" stroke-width="1.4" opacity="0.44"/>');
  parts.push('</svg>');
  return `${parts.join('\n')}\n`;
}

async function fetchCityElements(city) {
  let roads = [];
  let usedBbox = city.bbox;
  let lastRoadError = null;
  for (const candidateBbox of [city.bbox, shrinkBbox(city.bbox, 0.65), shrinkBbox(city.bbox, 0.45)]) {
    try {
      roads = await fetchOverpassElements(city, roadQueryFor(candidateBbox));
      usedBbox = candidateBbox;
      break;
    } catch (error) {
      lastRoadError = error;
    }
  }
  if (!roads.length) throw lastRoadError ?? new Error(`${city.canonicalName}: failed to refresh OSM roads`);
  let context = [];
  try {
    context = await fetchOverpassElements(city, contextQueryFor(usedBbox));
  } catch (error) {
    console.warn(`${city.canonicalName}: optional OSM context skipped: ${error.message}`);
  }
  return { bbox: usedBbox, elements: [...roads, ...context] };
}

function roadQueryFor(bboxValue) {
  const bbox = overpassBbox(bboxValue);
  return `[out:json][timeout:60];
(
  way["highway"]["area"!="yes"](${bbox});
);
out body geom(${bbox});`;
}

function contextQueryFor(bboxValue) {
  const bbox = overpassBbox(bboxValue);
  return `[out:json][timeout:45];
(
  way["railway"~"^(rail|subway|light_rail|tram)$"](${bbox});
  way["natural"="water"](${bbox});
  way["natural"="coastline"](${bbox});
  way["waterway"~"^(river|canal)$"](${bbox});
  way["leisure"="park"](${bbox});
  way["landuse"~"^(grass|recreation_ground)$"](${bbox});
  way["natural"="wood"](${bbox});
);
out body geom(${bbox});`;
}

async function fetchOverpassElements(city, query) {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'user-agent': 'DailyGameCityGrid/0.1 github.com/JPrier/DailyGameCityGrid',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!response.ok) throw new Error(`${endpoint} returned ${response.status} ${response.statusText}`);
      const payload = await response.json();
      return (payload.elements ?? []).filter((element) => element.type === 'way' && Array.isArray(element.geometry));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${city.canonicalName}: failed to refresh OSM source: ${lastError?.message ?? 'unknown error'}`);
}

function trimOsmElement(element) {
  const geometry = validLatLonPoints(element.geometry ?? []);
  return {
    type: element.type,
    id: element.id,
    tags: Object.fromEntries(Object.entries(element.tags ?? {}).filter(([key]) => ['highway', 'railway', 'natural', 'waterway', 'leisure', 'landuse'].includes(key))),
    geometry: capPoints(simplifyLatLon(geometry, 0.00008), MAX_POINTS_PER_ELEMENT).map(({ lat, lon }) => ({ lat: round(lat, 7), lon: round(lon, 7) })),
  };
}

function selectRenderableElements(elements) {
  const groups = new Map();
  for (const element of elements) {
    const layer = layerForTags(element.tags ?? {});
    if (!layer) continue;
    element.geometry = validLatLonPoints(element.geometry ?? []);
    if (element.geometry.length < 2) continue;
    if (!groups.has(layer)) groups.set(layer, []);
    groups.get(layer).push(element);
  }
  const selected = [];
  for (const [layer, items] of groups) {
    selected.push(...selectLayerElements(layer, items, MAX_SOURCE_ELEMENTS[layer] ?? 100));
  }
  return selected.sort((a, b) => a.id - b.id);
}

function layerForTags(tags) {
  if (['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link'].includes(tags.highway)) return 'roadsMajor';
  if ([
    'tertiary',
    'tertiary_link',
    'residential',
    'unclassified',
    'service',
    'living_street',
    'pedestrian',
    'road',
    'busway',
    'bus_guideway',
  ].includes(tags.highway)) return 'roadsMinor';
  if (['rail', 'subway', 'light_rail', 'tram'].includes(tags.railway)) return 'rail';
  if (tags.natural === 'water' || tags.natural === 'coastline' || ['river', 'canal'].includes(tags.waterway)) return 'water';
  if (tags.leisure === 'park' || ['grass', 'recreation_ground'].includes(tags.landuse) || tags.natural === 'wood') return 'parks';
  return null;
}

function selectLayerElements(layer, items, limit) {
  const sorted = [...items].sort((a, b) => elementImportance(b) - elementImportance(a));
  if (!layer.startsWith('roads') || sorted.length <= limit) return sorted.slice(0, limit);

  const selected = [];
  const seen = new Set();
  const bins = new Set();
  const targetCoverage = Math.min(limit, Math.ceil(limit * 0.72));
  for (const item of sorted) {
    if (selected.length >= targetCoverage) break;
    const itemBins = geometryBins(item.geometry ?? []);
    if (!itemBins.some((bin) => !bins.has(bin))) continue;
    selected.push(item);
    seen.add(item.id);
    for (const bin of itemBins) bins.add(bin);
  }

  for (const item of sorted) {
    if (selected.length >= limit) break;
    if (seen.has(item.id)) continue;
    selected.push(item);
  }
  return selected;
}

function elementImportance(element) {
  return featureImportance({ tags: element.tags ?? {}, lengthMeters: lengthMeters(element.geometry ?? []) }) * 1000000 + lengthMeters(element.geometry ?? []);
}

function geometryBins(geometry) {
  if (!geometry.length) return [];
  const bins = new Set();
  for (const point of validLatLonPoints(geometry)) {
    const latBin = Math.floor(point.lat * 800);
    const lonBin = Math.floor(point.lon * 800);
    bins.add(`${latBin}:${lonBin}`);
  }
  return [...bins];
}

function polygonLike(tags, geometry) {
  if (!(tags.natural === 'water' || tags.leisure === 'park' || tags.landuse || tags.natural === 'wood')) return false;
  const first = geometry[0];
  const last = geometry.at(-1);
  return first && last && Math.abs(first.lat - last.lat) < 0.000001 && Math.abs(first.lon - last.lon) < 0.000001;
}

function projectGeometry(geometry, bbox) {
  return geometry.map(({ lat, lon }) => projectPoint(lat, lon, bbox)).filter(Boolean);
}

function projectPoint(lat, lon, bbox) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const left = mercatorX(bbox.left);
  const right = mercatorX(bbox.right);
  const bottom = mercatorY(bbox.bottom);
  const top = mercatorY(bbox.top);
  const x = VIEWBOX.pad + ((mercatorX(lon) - left) / (right - left)) * (VIEWBOX.width - VIEWBOX.pad * 2);
  const y = VIEWBOX.pad + ((top - mercatorY(lat)) / (top - bottom)) * (VIEWBOX.height - VIEWBOX.pad * 2);
  return {
    x: clamp(Math.round(x * 10) / 10, 0, VIEWBOX.width),
    y: clamp(Math.round(y * 10) / 10, 0, VIEWBOX.height),
  };
}

function simplifyPoints(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  simplifySection(points, 0, points.length - 1, tolerance, keep);
  return points.filter((_, index) => keep[index]);
}

function simplifyLatLon(points, tolerance) {
  if (points.length <= 2) return points;
  const projected = points.map(({ lat, lon }) => ({ x: lon, y: lat, lat, lon }));
  const keep = new Array(projected.length).fill(false);
  keep[0] = true;
  keep[projected.length - 1] = true;
  simplifySection(projected, 0, projected.length - 1, tolerance, keep);
  return points.filter((_, index) => keep[index]);
}

function capPoints(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const capped = [];
  for (let index = 0; index < maxPoints; index += 1) {
    capped.push(points[Math.round((index / (maxPoints - 1)) * (points.length - 1))]);
  }
  return capped;
}

function simplifySection(points, first, last, tolerance, keep) {
  let maxDistance = 0;
  let index = first;
  for (let i = first + 1; i < last; i += 1) {
    const distance = perpendicularDistance(points[i], points[first], points[last]);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance > tolerance) {
    keep[index] = true;
    simplifySection(points, first, index, tolerance, keep);
    simplifySection(points, index, last, tolerance, keep);
  }
}

function perpendicularDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy);
}

function estimateIntersections(points) {
  const buckets = new Map();
  for (const point of points) {
    const key = `${Math.round(point.x / 5)}:${Math.round(point.y / 5)}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.values()].filter((count) => count > 1).length;
}

function landmarkPoints(layers) {
  const seeds = [...layers.rail, ...layers.water, ...layers.parks, ...layers.roadsMajor].flatMap((item) => item.points);
  const points = seeds.filter((_, index) => index % Math.max(1, Math.floor(seeds.length / 4)) === 0).slice(0, 4);
  return points.length >= 4 ? points : [{ x: 105, y: 80 }, { x: 210, y: 160 }, { x: 315, y: 240 }, { x: 315, y: 80 }];
}

function importantLines(items) {
  return [...items].sort((left, right) => {
    const leftImportance = featureImportance(left);
    const rightImportance = featureImportance(right);
    if (rightImportance !== leftImportance) return rightImportance - leftImportance;
    return (right.lengthMeters ?? 0) - (left.lengthMeters ?? 0);
  });
}

function featureImportance(item) {
  const highway = item.tags?.highway;
  const railway = item.tags?.railway;
  const natural = item.tags?.natural;
  const waterway = item.tags?.waterway;
  if (highway === 'motorway') return 900;
  if (highway === 'motorway_link') return 870;
  if (highway === 'trunk') return 820;
  if (highway === 'trunk_link') return 790;
  if (highway === 'primary') return 740;
  if (highway === 'primary_link') return 710;
  if (highway === 'secondary') return 660;
  if (highway === 'secondary_link') return 630;
  if (highway === 'tertiary') return 560;
  if (highway === 'tertiary_link') return 530;
  if (railway === 'subway' || railway === 'light_rail') return 520;
  if (railway === 'rail') return 500;
  if (natural === 'coastline') return 480;
  if (natural === 'water') return 460;
  if (waterway === 'river') return 450;
  if (waterway === 'canal') return 430;
  if (highway === 'residential') return 360;
  if (highway === 'unclassified') return 340;
  if (highway === 'living_street') return 320;
  if (highway === 'pedestrian') return 300;
  if (highway === 'service') return 260;
  return 100;
}

function renderFeature(item, style, stage) {
  const d = pathData(item.points, item.type === 'polygon');
  const attrs = styleAttrs(item, style, stage);
  return `<path d="${d}" ${attrs}/>`;
}

function renderWaterFill(points) {
  return `<path d="${pathData(points, true)}" fill="#76c5e2" stroke="none" opacity="0.74"/>`;
}

function renderLandWash(item) {
  if (item.type === 'polygon') {
    return `<path d="${pathData(item.points, true)}" fill="#f7f1e3" stroke="#f7f1e3" stroke-width="8" opacity="0.92" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return `<path d="${pathData(item.points, false)}" fill="none" stroke="#f7f1e3" stroke-width="28" opacity="0.92" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function coastlineWaterFills(waterItems, roadPoints) {
  const fills = [];
  for (const item of waterItems) {
    if (item.type !== 'line' || item.tags?.natural !== 'coastline' || item.points.length < 2) continue;
    if (!coastlineTouchesCrop(item.points)) continue;
    const clockwise = boundaryClosedPolygon(item.points, 'clockwise');
    const counterClockwise = boundaryClosedPolygon(item.points, 'counter-clockwise');
    if (clockwise.length < 3 || counterClockwise.length < 3) continue;
    fills.push(roadPointHits(clockwise, roadPoints) <= roadPointHits(counterClockwise, roadPoints) ? clockwise : counterClockwise);
  }
  return fills;
}

function coastlineTouchesCrop(points) {
  const first = points[0];
  const last = points.at(-1);
  return distanceToCrop(first) < 42 || distanceToCrop(last) < 42 || points.some((point) => distanceToCrop(point) < 14);
}

function boundaryClosedPolygon(points, direction) {
  const first = points[0];
  const last = points.at(-1);
  const snapFirst = nearestCropPoint(first);
  const snapLast = nearestCropPoint(last);
  const boundary = boundaryPath(snapLast, snapFirst, direction);
  return [...points, snapLast, ...boundary.slice(1, -1), snapFirst];
}

function boundaryPath(from, to, direction) {
  if (direction === 'counter-clockwise') {
    return boundaryPath(to, from, 'clockwise').reverse();
  }
  const perimeter = cropPerimeter();
  const start = perimeterOffset(from);
  let end = perimeterOffset(to);
  if (end < start) end += perimeter;
  const corners = cropCorners()
    .map((point) => ({ point, offset: perimeterOffset(point) }))
    .flatMap(({ point, offset }) => (offset <= start ? [{ point, offset: offset + perimeter }] : [{ point, offset }]));
  return [
    from,
    ...corners
      .filter(({ offset }) => offset > start && offset < end)
      .sort((a, b) => a.offset - b.offset)
      .map(({ point }) => point),
    to,
  ];
}

function nearestCropPoint(point) {
  const crop = cropRect();
  const candidates = [
    { x: clamp(point.x, crop.left, crop.right), y: crop.top },
    { x: crop.right, y: clamp(point.y, crop.top, crop.bottom) },
    { x: clamp(point.x, crop.left, crop.right), y: crop.bottom },
    { x: crop.left, y: clamp(point.y, crop.top, crop.bottom) },
  ];
  return candidates.sort((a, b) => squaredDistance(point, a) - squaredDistance(point, b))[0];
}

function distanceToCrop(point) {
  return Math.sqrt(squaredDistance(point, nearestCropPoint(point)));
}

function perimeterOffset(point) {
  const crop = cropRect();
  if (Math.abs(point.y - crop.top) <= Math.abs(point.x - crop.right) && Math.abs(point.y - crop.top) <= Math.abs(point.y - crop.bottom) && Math.abs(point.y - crop.top) <= Math.abs(point.x - crop.left)) {
    return clamp(point.x, crop.left, crop.right) - crop.left;
  }
  if (Math.abs(point.x - crop.right) <= Math.abs(point.y - crop.bottom) && Math.abs(point.x - crop.right) <= Math.abs(point.x - crop.left)) {
    return crop.right - crop.left + clamp(point.y, crop.top, crop.bottom) - crop.top;
  }
  if (Math.abs(point.y - crop.bottom) <= Math.abs(point.x - crop.left)) {
    return crop.right - crop.left + crop.bottom - crop.top + crop.right - clamp(point.x, crop.left, crop.right);
  }
  return crop.right - crop.left + crop.bottom - crop.top + crop.right - crop.left + crop.bottom - clamp(point.y, crop.top, crop.bottom);
}

function cropRect() {
  return { left: 8, top: 8, right: 412, bottom: 312 };
}

function cropCorners() {
  const crop = cropRect();
  return [
    { x: crop.right, y: crop.top },
    { x: crop.right, y: crop.bottom },
    { x: crop.left, y: crop.bottom },
    { x: crop.left, y: crop.top },
  ];
}

function cropPerimeter() {
  const crop = cropRect();
  return 2 * (crop.right - crop.left + crop.bottom - crop.top);
}

function squaredDistance(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function roadPointHits(polygon, roadPoints) {
  if (!roadPoints.length) return 0;
  let hits = 0;
  const sampleEvery = Math.max(1, Math.floor(roadPoints.length / 600));
  for (let index = 0; index < roadPoints.length; index += sampleEvery) {
    if (pointInPolygon(roadPoints[index], polygon)) hits += 1;
  }
  return hits;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 0.000001) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function styleAttrs(item, style, stage) {
  const attrs = {
    fill: 'none',
    stroke: '#203632',
    'stroke-width': '1',
    opacity: '1',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  if (style === 'water') {
    attrs.fill = item.type === 'polygon' ? '#7fc8e6' : 'none';
    attrs.stroke = '#117fa8';
    attrs['stroke-width'] = item.type === 'polygon' ? '1.35' : stage >= 5 ? '4.6' : '3.8';
    attrs.opacity = stage >= 5 ? '0.94' : '0.88';
  } else if (style === 'water-casing') {
    attrs.fill = item.type === 'polygon' ? '#d9f2fb' : 'none';
    attrs.stroke = '#d9f2fb';
    attrs['stroke-width'] = item.type === 'polygon' ? '2.4' : stage >= 5 ? '8.2' : '6.8';
    attrs.opacity = stage >= 5 ? '0.95' : '0.9';
  } else if (style === 'park') {
    attrs.fill = item.type === 'polygon' ? '#c4d5a3' : 'none';
    attrs.stroke = '#7c9860';
    attrs['stroke-width'] = item.type === 'polygon' ? '0.95' : '1.35';
    attrs.opacity = stage >= 5 ? '0.72' : '0.55';
  } else if (style === 'major-casing') {
    attrs.stroke = '#fcf7e8';
    attrs['stroke-width'] = stage >= 5 ? '5.4' : '6.4';
    attrs.opacity = '0.92';
  } else if (style === 'major-road') {
    attrs.stroke = stage >= 5 ? '#263e38' : '#1f3733';
    attrs['stroke-width'] = stage >= 5 ? '2.15' : '2.7';
    attrs.opacity = '0.9';
  } else if (style === 'minor-casing') {
    attrs.stroke = '#fbf7eb';
    attrs['stroke-width'] = stage >= 5 ? '2.8' : '3.4';
    attrs.opacity = stage >= 5 ? '0.72' : '0.62';
  } else if (style === 'minor-road') {
    attrs.stroke = stage >= 5 ? '#78847a' : '#69776e';
    attrs['stroke-width'] = stage >= 5 ? '0.95' : '1.25';
    attrs.opacity = stage >= 5 ? '0.68' : '0.58';
  } else if (style === 'rail') {
    attrs.stroke = '#815739';
    attrs['stroke-width'] = stage >= 5 ? '1.85' : '2.3';
    attrs['stroke-dasharray'] = '7 5';
    attrs.opacity = '0.76';
  }
  return Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(' ');
}

function pathData(points, close) {
  const [first, ...rest] = points;
  return [`M${first.x} ${first.y}`, ...rest.map(({ x, y }) => `L${x} ${y}`), close ? 'Z' : ''].filter(Boolean).join(' ');
}

function lengthMeters(geometry) {
  let total = 0;
  const points = validLatLonPoints(geometry);
  for (let index = 1; index < points.length; index += 1) {
    total += distanceMeters(points[index - 1], points[index]);
  }
  return total;
}

function validLatLonPoints(points) {
  return points.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon));
}

function distanceMeters(a, b) {
  const radius = 6371000;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const aa = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

function mercatorX(lon) {
  return lon;
}

function mercatorY(lat) {
  const capped = clamp(lat, -85.0511, 85.0511);
  return Math.log(Math.tan(Math.PI / 4 + radians(capped) / 2));
}

function radians(value) {
  return (value * Math.PI) / 180;
}

function validBbox(bbox) {
  return bbox && Number.isFinite(bbox.left) && Number.isFinite(bbox.right) && Number.isFinite(bbox.bottom) && Number.isFinite(bbox.top) && bbox.left < bbox.right && bbox.bottom < bbox.top;
}

function sameBbox(a, b) {
  return validBbox(a) && validBbox(b) && ['left', 'bottom', 'right', 'top'].every((key) => Math.abs(a[key] - b[key]) < 0.000001);
}

function compatibleSourceBbox(city, bbox) {
  return [city.bbox, shrinkBbox(city.bbox, 0.65), shrinkBbox(city.bbox, 0.45)].some((candidate) => sameBbox(candidate, bbox));
}

function shrinkBbox(bbox, factor) {
  const centerLon = (bbox.left + bbox.right) / 2;
  const centerLat = (bbox.bottom + bbox.top) / 2;
  const halfWidth = ((bbox.right - bbox.left) * factor) / 2;
  const halfHeight = ((bbox.top - bbox.bottom) * factor) / 2;
  return {
    left: centerLon - halfWidth,
    bottom: centerLat - halfHeight,
    right: centerLon + halfWidth,
    top: centerLat + halfHeight,
  };
}

function overpassBbox(bbox) {
  return `${bbox.bottom},${bbox.left},${bbox.top},${bbox.right}`;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
