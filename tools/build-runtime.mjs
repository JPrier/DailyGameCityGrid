import { loadCandidates, writeJson } from './city-grid/model.mjs';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const candidates = loadCandidates(root);
const out = path.join(root, 'dist/runtime/candidates.generated.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `export const CANDIDATE_SET_ID = ${JSON.stringify(candidates.candidateSetId)};\nexport const CANDIDATES = ${JSON.stringify(candidates.cities, null, 2)};\n`,
);
writeJson(root, 'dist/runtime/candidates.generated.meta.json', {
  schemaVersion: 'city-grid-runtime-candidates-meta.v1',
  candidateSetId: candidates.candidateSetId,
  candidateCount: candidates.cities.length,
});
console.log(`Runtime candidate module generated for ${candidates.cities.length} cities.`);
