import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'content/manifest.json'), 'utf8'));
const poolSize = manifest.puzzleResolver.poolVersions[0].poolSize;
const puzzleDir = path.join(root, 'content/puzzles/v1');
const errors = new Set();

for (let index = 0; index < poolSize; index += 1) {
  const file = path.join(puzzleDir, `puzzle-${String(index).padStart(4, '0')}.json`);
  if (!fs.existsSync(file)) {
    errors.add(`missing puzzle ${file}`);
    continue;
  }
  const puzzle = JSON.parse(fs.readFileSync(file, 'utf8'));
  const answer = puzzle.extension?.answer;
  if (!Number.isFinite(answer?.lat) || !Number.isFinite(answer?.lon)) errors.add(`${file}: invalid answer coordinates`);
  if (!Array.isArray(answer?.aliases) || answer.aliases.length < 3) errors.add(`${file}: answer needs at least three aliases/variants`);
  for (const stage of puzzle.extension?.assetStages ?? []) {
    const assetPath = path.join(root, stage.assetPath);
    if (!fs.existsSync(assetPath)) {
      errors.add(`${file}: missing asset ${stage.assetPath}`);
      continue;
    }
    const svg = fs.readFileSync(assetPath, 'utf8');
    if (!svg.includes('<path')) errors.add(`${stage.assetPath}: expected non-empty road geometry`);
    if (/<text[\s>]/i.test(svg)) errors.add(`${stage.assetPath}: SVG must not contain visible text labels`);
    for (const forbidden of [answer.canonicalName, answer.admin1, ...(answer.aliases ?? [])].filter((value) => String(value).trim().length >= 3)) {
      if (forbidden && svg.toLowerCase().includes(String(forbidden).toLowerCase())) {
        errors.add(`${stage.assetPath}: SVG leaks answer text ${forbidden}`);
      }
    }
  }
}

if (errors.size) {
  console.error([...errors].join('\n'));
  process.exit(1);
}

console.log(`Validated ${poolSize} City Grid puzzles and referenced SVG assets.`);
