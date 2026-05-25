import fs from 'node:fs';
import path from 'node:path';
import { CANDIDATE_PATH, SOURCE_MANIFEST_PATH, normalizeName, writeJson } from './city-grid/model.mjs';

const root = process.cwd();
const cacheDir = path.join(root, '.cache/geonames');
const citiesPath = path.join(cacheDir, 'cities15000.txt');
const countryPath = path.join(cacheDir, 'countryInfo.txt');
const adminPath = path.join(cacheDir, 'admin1CodesASCII.txt');
const allowedFeatureCodes = new Set(['PPLC', 'PPLA', 'PPLA2', 'PPLA3', 'PPL']);
const sourceId = 'overpass-real-osm-world-famous-geonames-v1';
const candidateSetId = 'world-famous-cities-geonames-v1';
const sourceLocalPath = '.cache/osm/city-grid-real-osm-world-famous-geonames-v1.json';

const famousCitySeeds = [
  ['New York City', 'US'],
  ['London', 'GB'],
  ['Paris', 'FR'],
  ['Tokyo', 'JP'],
  ['Rome', 'IT'],
  ['Singapore', 'SG'],
  ['Hong Kong', 'HK'],
  ['Dubai', 'AE'],
  ['Istanbul', 'TR'],
  ['Los Angeles', 'US'],
  ['Bangkok', 'TH'],
  ['Barcelona', 'ES'],
  ['Amsterdam', 'NL'],
  ['Berlin', 'DE'],
  ['Madrid', 'ES'],
  ['Rio de Janeiro', 'BR'],
  ['Beijing', 'CN'],
  ['Shanghai', 'CN'],
  ['Seoul', 'KR'],
  ['Sydney', 'AU'],
  ['Moscow', 'RU'],
  ['Vienna', 'AT'],
  ['Prague', 'CZ'],
  ['Venice', 'IT'],
  ['Athens', 'GR'],
  ['Cairo', 'EG'],
  ['Jerusalem', 'IL'],
  ['Washington, D.C.', 'US'],
  ['San Francisco', 'US'],
  ['Las Vegas', 'US'],
  ['Miami', 'US'],
  ['Chicago', 'US'],
  ['Boston', 'US'],
  ['Toronto', 'CA'],
  ['Vancouver', 'CA'],
  ['Montreal', 'CA'],
  ['Mexico City', 'MX'],
  ['Buenos Aires', 'AR'],
  ['Santiago', 'CL'],
  ['Bogotá', 'CO'],
  ['Lima', 'PE'],
  ['São Paulo', 'BR'],
  ['Lisbon', 'PT'],
  ['Dublin', 'IE'],
  ['Edinburgh', 'GB'],
  ['Stockholm', 'SE'],
  ['Copenhagen', 'DK'],
  ['Oslo', 'NO'],
  ['Helsinki', 'FI'],
  ['Brussels', 'BE'],
  ['Zurich', 'CH'],
  ['Geneva', 'CH'],
  ['Munich', 'DE'],
  ['Frankfurt', 'DE'],
  ['Hamburg', 'DE'],
  ['Warsaw', 'PL'],
  ['Budapest', 'HU'],
  ['Krakow', 'PL'],
  ['Florence', 'IT'],
  ['Milan', 'IT'],
  ['Naples', 'IT'],
  ['Nice', 'FR'],
  ['Marseille', 'FR'],
  ['Reykjavik', 'IS'],
  ['Doha', 'QA'],
  ['Abu Dhabi', 'AE'],
  ['Riyadh', 'SA'],
  ['Tel Aviv', 'IL'],
  ['Beirut', 'LB'],
  ['Amman', 'JO'],
  ['Marrakesh', 'MA'],
  ['Casablanca', 'MA'],
  ['Cape Town', 'ZA'],
  ['Johannesburg', 'ZA'],
  ['Nairobi', 'KE'],
  ['Lagos', 'NG'],
  ['Accra', 'GH'],
  ['Dakar', 'SN'],
  ['Mumbai', 'IN'],
  ['New Delhi', 'IN'],
  ['Delhi', 'IN'],
  ['Jaipur', 'IN'],
  ['Agra', 'IN'],
  ['Kolkata', 'IN'],
  ['Chennai', 'IN'],
  ['Bangalore', 'IN'],
  ['Kathmandu', 'NP'],
  ['Kuala Lumpur', 'MY'],
  ['Jakarta', 'ID'],
  ['Manila', 'PH'],
  ['Hanoi', 'VN'],
  ['Ho Chi Minh City', 'VN'],
  ['Kyoto', 'JP'],
  ['Osaka', 'JP'],
  ['Taipei', 'TW'],
  ['Macau', 'MO'],
  ['Auckland', 'NZ'],
  ['Melbourne', 'AU'],
  ['Honolulu', 'US'],
  ['New Orleans', 'US'],
];

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
  .map(parseCityRow)
  .filter((row) => row.featureClass === 'P' && allowedFeatureCodes.has(row.featureCode) && row.population > 0);

const rowIndexes = indexRows(rows);
const usedEntityIds = new Set();
const usedAliases = new Map();
const cities = famousCitySeeds.map(([displayName, countryCode], index) => {
  const row = findSeedRow(rowIndexes, displayName, countryCode, usedEntityIds);
  const country = countries.get(row.countryCode) ?? { name: row.countryCode, continent: 'Unknown' };
  const admin1 = admins.get(`${row.countryCode}.${row.admin1Code}`) ?? row.admin1Code;
  const city = {
    entityId: `city:geonames:${row.geonameId}`,
    assetSlug: slugify(`${displayName}-${row.countryCode}-${row.geonameId}`),
    canonicalName: displayName,
    aliases: [],
    countryCode: row.countryCode,
    country: country.name,
    admin1,
    continent: country.continent,
    lat: round(row.lat, 6),
    lon: round(row.lon, 6),
    population: row.population,
    populationBand: populationBand(row.population),
    coastal: false,
    hasMajorRapidTransit: row.population >= 1_000_000,
    bbox: bboxAround(row.lat, row.lon, row.population),
    sourceExtractId: sourceId,
    sourceData: {
      geonameId: row.geonameId,
      featureCode: row.featureCode,
      timezone: row.timezone,
      famousRank: index + 1,
      seedName: displayName,
      matchedName: row.name,
      alternateNameCount: row.alternateNames.length,
    },
  };

  city.aliases = uniqueAliases(city, [displayName, row.name, row.asciiName, `${displayName}, ${row.countryCode}`, `${displayName} ${country.name}`, `${displayName} ${admin1}`], usedAliases);
  if (city.aliases.length < 3) throw new Error(`${city.entityId}: expected at least three unique aliases`);
  usedEntityIds.add(city.entityId);
  return city;
});

if (cities.length !== 100) throw new Error(`Expected 100 cities, generated ${cities.length}`);

writeJson(root, CANDIDATE_PATH, {
  schemaVersion: 'city-grid-candidates.v1',
  candidateSetId,
  generatedAt: new Date().toISOString(),
  source: {
    name: 'Curated famous city seed list enriched by GeoNames cities15000',
    url: 'https://download.geonames.org/export/dump/',
    basis: 'A curated top-100 globally recognizable city order, enriched from GeoNames with coordinates, country ISO code, population, and provenance. Population is used only for map sizing, not ranking.',
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
      localPath: sourceLocalPath,
      attribution: 'OpenStreetMap contributors',
      license: 'ODbL-1.0',
      upstream: 'https://overpass-api.de/api/interpreter',
      sha256: '',
    },
  ],
});

console.log(`Generated ${cities.length} famous-city candidates from curated seeds and GeoNames.`);

function parseCityRow(line) {
  const [
    geonameId,
    name,
    asciiName,
    alternateNames,
    lat,
    lon,
    featureClass,
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
  ] = line.split('\t');
  return {
    geonameId,
    name,
    asciiName,
    alternateNames: alternateNames ? alternateNames.split(',') : [],
    lat: Number(lat),
    lon: Number(lon),
    featureClass,
    featureCode,
    countryCode,
    admin1Code,
    population: Number(population),
    timezone,
  };
}

function indexRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const exactNames = new Set([row.name, row.asciiName].filter(Boolean).map(normalizeName));
    const alternateNames = new Set(row.alternateNames.filter(Boolean).map(normalizeName));
    for (const name of exactNames) {
      const key = `${row.countryCode}:${name}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ row, priority: 2 });
    }
    for (const name of alternateNames) {
      if (exactNames.has(name)) continue;
      const key = `${row.countryCode}:${name}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ row, priority: 1 });
    }
  }
  for (const matches of map.values()) {
    matches.sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      return right.row.population - left.row.population;
    });
  }
  return map;
}

function findSeedRow(rowIndexes, displayName, countryCode, usedEntityIds) {
  const key = `${countryCode}:${normalizeName(displayName)}`;
  const matches = rowIndexes.get(key) ?? [];
  const match = matches.find((candidate) => !usedEntityIds.has(`city:geonames:${candidate.row.geonameId}`));
  const row = match?.row;
  if (!row) throw new Error(`GeoNames did not resolve famous city seed: ${displayName}, ${countryCode}`);
  return row;
}

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
  const radiusKm = population >= 5_000_000 ? 4.5 : population >= 1_000_000 ? 4.25 : 3.75;
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
  return '100k-1m';
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
