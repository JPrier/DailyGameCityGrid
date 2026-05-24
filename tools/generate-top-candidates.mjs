import fs from 'node:fs';
import path from 'node:path';
import { CANDIDATE_PATH, SOURCE_MANIFEST_PATH, normalizeName, writeJson } from './city-grid/model.mjs';

const root = process.cwd();
const cacheDir = path.join(root, '.cache/geonames');
const citiesPath = path.join(cacheDir, 'cities15000.txt');
const countryPath = path.join(cacheDir, 'countryInfo.txt');
const adminPath = path.join(cacheDir, 'admin1CodesASCII.txt');
const allowedFeatureCodes = new Set(['PPLC', 'PPLA', 'PPLA2', 'PPL']);
const sourceId = 'overpass-real-osm-world-top-100-geonames-v1';

for (const file of [citiesPath, countryPath, adminPath]) {
  if (!fs.existsSync(file)) {
    throw new Error(`${path.relative(root, file)} is missing. Download GeoNames cities15000, countryInfo, and admin1CodesASCII into .cache/geonames first.`);
  }
}

const countries = readCountries(countryPath);
const admins = readAdmins(adminPath);
const rows = fs
  .readFileSync(citiesPath, 'utf8')
  .trim()
  .split(/\r?\n/)
  .map((line) => line.split('\t'))
  .filter((cols) => cols[6] === 'P' && allowedFeatureCodes.has(cols[7]) && Number(cols[14]) > 0)
  .sort((a, b) => Number(b[14]) - Number(a[14]))
  .slice(0, 100);

const nameCounts = new Map();
for (const cols of rows) {
  const key = normalizeName(cols[2] || cols[1]);
  nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
}

const usedAliases = new Map();
const cities = rows.map((cols) => {
  const [
    geonameId,
    name,
    asciiName,
    alternateNames,
    lat,
    lon,
    ,
    featureCode,
    countryCode,
    ,
    admin1Code,
    ,
    ,
    ,
    population,
    ,
    ,
    timezone,
  ] = cols;
  const country = countries.get(countryCode) ?? { name: countryCode, continent: 'Unknown' };
  const admin1 = admins.get(`${countryCode}.${admin1Code}`) ?? admin1Code;
  const baseName = asciiName || name;
  const canonicalName = nameCounts.get(normalizeName(baseName)) > 1 ? `${baseName}, ${countryCode}` : baseName;
  const city = {
    entityId: `city:geonames:${geonameId}`,
    assetSlug: slugify(`${baseName}-${countryCode}-${geonameId}`),
    canonicalName,
    aliases: [],
    countryCode,
    country: country.name,
    admin1,
    continent: country.continent,
    lat: round(Number(lat), 6),
    lon: round(Number(lon), 6),
    population: Number(population),
    populationBand: populationBand(Number(population)),
    coastal: false,
    hasMajorRapidTransit: Number(population) >= 3_000_000,
    bbox: bboxAround(Number(lat), Number(lon), Number(population)),
    sourceExtractId: sourceId,
    sourceData: {
      geonameId,
      featureCode,
      timezone,
      alternateNameCount: alternateNames ? alternateNames.split(',').length : 0,
    },
  };

  city.aliases = uniqueAliases(city, [canonicalName, baseName, name, `${baseName}, ${countryCode}`, `${baseName} ${country.name}`, `${baseName} ${admin1}`], usedAliases);
  return city;
});

if (cities.length !== 100) throw new Error(`Expected 100 cities, generated ${cities.length}`);
for (const city of cities) {
  if (city.aliases.length < 3) throw new Error(`${city.entityId}: expected at least three unique aliases`);
}

writeJson(root, CANDIDATE_PATH, {
  schemaVersion: 'city-grid-candidates.v1',
  candidateSetId: 'world-top-100-cities-geonames-v1',
  generatedAt: new Date().toISOString(),
  source: {
    name: 'GeoNames cities15000',
    url: 'https://download.geonames.org/export/dump/',
    basis: 'Top 100 populated GeoNames populated places after filtering to PPLC, PPLA, PPLA2, and PPL feature codes.',
  },
  minimumUniqueAnswers: 100,
  cities,
});

writeJson(root, SOURCE_MANIFEST_PATH, {
  schemaVersion: 'city-grid-osm-source-manifest.v1',
  mode: 'unlocked',
  generatedAt: new Date().toISOString(),
  sources: [
    {
      id: sourceId,
      kind: 'overpass-api-json',
      localPath: '.cache/osm/city-grid-real-osm-world-top-100-geonames-v1.json',
      attribution: 'OpenStreetMap contributors',
      license: 'ODbL-1.0',
      upstream: 'https://overpass-api.de/api/interpreter',
      sha256: '',
    },
  ],
});

console.log(`Generated ${cities.length} GeoNames top-city candidates.`);

function readCountries(file) {
  const map = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    map.set(cols[0], { name: cols[4], continent: continentName(cols[8]) });
  }
  return map;
}

function readAdmins(file) {
  const map = new Map();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('\t');
    map.set(cols[0], cols[2] || cols[1]);
  }
  return map;
}

function uniqueAliases(city, values, usedAliases) {
  const aliases = [];
  const local = new Set();
  for (const value of values) {
    const normalized = normalizeName(value);
    if (normalized.length < 3 || local.has(normalized)) continue;
    const prior = usedAliases.get(normalized);
    if (prior && prior !== city.entityId) continue;
    usedAliases.set(normalized, city.entityId);
    local.add(normalized);
    aliases.push(value);
  }
  return aliases;
}

function bboxAround(lat, lon, population) {
  const radiusKm = population >= 10_000_000 ? 4.5 : population >= 5_000_000 ? 4.25 : population >= 3_000_000 ? 4 : 3.75;
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    left: round(Math.max(-180, lon - lonDelta), 6),
    bottom: round(Math.max(-85, lat - latDelta), 6),
    right: round(Math.min(180, lon + lonDelta), 6),
    top: round(Math.min(85, lat + latDelta), 6),
  };
}

function populationBand(population) {
  if (population >= 10_000_000) return '10m+';
  if (population >= 5_000_000) return '5m-10m';
  if (population >= 3_000_000) return '3m-5m';
  if (population >= 1_000_000) return '1m-3m';
  return 'under-1m';
}

function continentName(code) {
  return { AF: 'Africa', AN: 'Antarctica', AS: 'Asia', EU: 'Europe', NA: 'North America', OC: 'Oceania', SA: 'South America' }[code] ?? 'Unknown';
}

function slugify(value) {
  return normalizeName(value).replace(/\s+/g, '-');
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
