import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const puzzleDir = path.join(root, 'content/puzzles/v1');
const assetRoot = path.join(root, 'content/assets/v1/city-grid');

const cities = [
  { slug: 'boston', entityId: 'city:us:ma:boston', canonicalName: 'Boston', aliases: ['Boston, MA', 'Boston Massachusetts', 'Beantown', 'Boston MA'], countryCode: 'US', country: 'United States', admin1: 'Massachusetts', lat: 42.3601, lon: -71.0589, population: 675647, clues: { continent: 'North America', country: 'United States', populationBand: '500k-1m', coastal: true, hasMajorRapidTransit: true } },
  { slug: 'chicago', entityId: 'city:us:il:chicago', canonicalName: 'Chicago', aliases: ['Chicago, IL', 'Chicago Illinois', 'Windy City', 'Chicago IL'], countryCode: 'US', country: 'United States', admin1: 'Illinois', lat: 41.8781, lon: -87.6298, population: 2746388, clues: { continent: 'North America', country: 'United States', populationBand: '1m-5m', coastal: true, hasMajorRapidTransit: true } },
  { slug: 'new-york', entityId: 'city:us:ny:new-york', canonicalName: 'New York', aliases: ['New York City', 'NYC', 'New York, NY', 'New York NY'], countryCode: 'US', country: 'United States', admin1: 'New York', lat: 40.7128, lon: -74.006, population: 8804190, clues: { continent: 'North America', country: 'United States', populationBand: '5m+', coastal: true, hasMajorRapidTransit: true } },
  { slug: 'los-angeles', entityId: 'city:us:ca:los-angeles', canonicalName: 'Los Angeles', aliases: ['LA', 'L.A.', 'Los Angeles, CA', 'Los Angeles California'], countryCode: 'US', country: 'United States', admin1: 'California', lat: 34.0522, lon: -118.2437, population: 3898747, clues: { continent: 'North America', country: 'United States', populationBand: '1m-5m', coastal: true, hasMajorRapidTransit: true } },
  { slug: 'seattle', entityId: 'city:us:wa:seattle', canonicalName: 'Seattle', aliases: ['Seattle, WA', 'Seattle Washington', 'Emerald City', 'Seattle WA'], countryCode: 'US', country: 'United States', admin1: 'Washington', lat: 47.6062, lon: -122.3321, population: 737015, clues: { continent: 'North America', country: 'United States', populationBand: '500k-1m', coastal: true, hasMajorRapidTransit: true } },
  { slug: 'london', entityId: 'city:gb:eng:london', canonicalName: 'London', aliases: ['London, UK', 'London England', 'Greater London', 'London GB'], countryCode: 'GB', country: 'United Kingdom', admin1: 'England', lat: 51.5072, lon: -0.1276, population: 8982000, clues: { continent: 'Europe', country: 'United Kingdom', populationBand: '5m+', coastal: false, hasMajorRapidTransit: true } },
  { slug: 'paris', entityId: 'city:fr:idf:paris', canonicalName: 'Paris', aliases: ['Paris, France', 'Ville de Paris', 'Paris FR', 'City of Light'], countryCode: 'FR', country: 'France', admin1: 'Ile-de-France', lat: 48.8566, lon: 2.3522, population: 2161000, clues: { continent: 'Europe', country: 'France', populationBand: '1m-5m', coastal: false, hasMajorRapidTransit: true } },
  { slug: 'tokyo', entityId: 'city:jp:tokyo:tokyo', canonicalName: 'Tokyo', aliases: ['Tokyo, Japan', 'Tokyo Metropolis', 'Tokyo JP', 'Tokio'], countryCode: 'JP', country: 'Japan', admin1: 'Tokyo', lat: 35.6762, lon: 139.6503, population: 13960000, clues: { continent: 'Asia', country: 'Japan', populationBand: '5m+', coastal: true, hasMajorRapidTransit: true } },
];

const fixtureIndices = new Set([431, 748]);
const reveals = [
  ['roads-tight'],
  ['roads-wide'],
  ['water', 'coastline'],
  ['parks', 'rail'],
  ['landmarks', 'metro-outline'],
  ['full-map', 'answer-context'],
];

fs.mkdirSync(puzzleDir, { recursive: true });
fs.mkdirSync(assetRoot, { recursive: true });

for (const city of cities) {
  const dir = path.join(assetRoot, city.slug);
  fs.mkdirSync(dir, { recursive: true });
  for (let stage = 0; stage < 6; stage += 1) {
    fs.writeFileSync(path.join(dir, `stage-${stage}.svg`), svgFor(city, stage));
  }
}

for (let index = 0; index < 1000; index += 1) {
  const city = fixtureIndices.has(index) ? cities[0] : cities[index % cities.length];
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
      answer: {
        entityId: city.entityId,
        canonicalName: city.canonicalName,
        aliases: city.aliases,
        countryCode: city.countryCode,
        country: city.country,
        admin1: city.admin1,
        lat: city.lat,
        lon: city.lon,
        population: city.population,
      },
      candidateSetId: 'world-famous-cities-v1',
      assetStages: Array.from({ length: 6 }, (_, stage) => ({
        stage,
        assetPath: `content/assets/v1/city-grid/${city.slug}/stage-${stage}.svg`,
        reveals: reveals[stage],
      })),
      clues: city.clues,
    },
  };
  fs.writeFileSync(path.join(puzzleDir, `puzzle-${String(index).padStart(4, '0')}.json`), `${JSON.stringify(puzzle, null, 2)}\n`);
}

function svgFor(city, stage) {
  const hue = Math.abs(hash(city.slug) % 360);
  const roadColor = `hsl(${hue} 18% 28%)`;
  const minorColor = `hsl(${hue} 10% 48%)`;
  const water = stage >= 2 ? `<path d="M0 230 C80 210 140 260 220 238 S350 190 420 228 L420 320 L0 320 Z" fill="#9bc7d8" opacity="0.72"/>` : '';
  const parks = stage >= 3 ? `<path d="M252 52 l58 26 -16 62 -70 18 -30 -54z" fill="#83a66b" opacity="0.78"/><path d="M42 178 l74 -22 28 48 -38 50 -70 -10z" fill="#83a66b" opacity="0.65"/>` : '';
  const rail = stage >= 3 ? `<path d="M24 286 C96 236 164 224 226 180 S326 82 396 46" fill="none" stroke="#6f4f37" stroke-width="5" stroke-dasharray="12 9" opacity="0.8"/>` : '';
  const landmarks = stage >= 4 ? `<g fill="#bf5f45"><circle cx="144" cy="119" r="7"/><circle cx="247" cy="204" r="7"/><circle cx="333" cy="108" r="7"/></g>` : '';
  const metro = stage >= 4 ? `<path d="M82 80 C162 36 276 42 338 96 S368 222 282 252 96 238 74 158 82 80 82 80" fill="none" stroke="#2f6f73" stroke-width="4" opacity="0.7"/>` : '';
  const full = stage >= 5 ? `<rect x="14" y="14" width="392" height="292" rx="18" fill="none" stroke="#183a37" stroke-width="3" opacity="0.45"/>` : '';
  const roadCount = stage < 1 ? 9 : 16;
  const roads = Array.from({ length: roadCount }, (_, i) => {
    const y = 34 + ((i * 31 + hash(city.slug)) % 252);
    const x1 = 10 + ((i * 47) % 60);
    const x2 = 340 + ((i * 29) % 70);
    const control = 70 + ((i * 37 + stage * 17) % 230);
    return `<path d="M${x1} ${y} C${control} ${y - 40} ${control + 40} ${y + 60} ${x2} ${y + ((i % 3) - 1) * 22}" fill="none" stroke="${i % 2 ? minorColor : roadColor}" stroke-width="${i % 2 ? 3 : 5}" stroke-linecap="round" opacity="0.92"/>`;
  }).join('');
  const cross = Array.from({ length: stage < 1 ? 5 : 9 }, (_, i) => {
    const x = 34 + ((i * 43 + hash(city.entityId)) % 340);
    return `<path d="M${x} 22 C${x + 34} 88 ${x - 42} 168 ${x + 20} 300" fill="none" stroke="${minorColor}" stroke-width="3" stroke-linecap="round" opacity="0.8"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 320" role="img" aria-label="Unlabeled street grid stage ${stage}">
  <rect width="420" height="320" fill="#efe7d2"/>
  ${water}
  ${parks}
  ${rail}
  <g>${roads}${cross}</g>
  ${metro}
  ${landmarks}
  ${full}
</svg>
`;
}

function hash(value) {
  let out = 0;
  for (const char of value) out = (out * 31 + char.charCodeAt(0)) | 0;
  return out;
}
