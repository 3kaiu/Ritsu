import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const pv = pkg.ritsu_protocol_version;

const schemaPath = path.resolve('../_shared/ctx-event-schema.json');
const schema = fs.readFileSync(schemaPath, 'utf8');

const svMatch = JSON.parse(schema).description.match(/v(\d+\.\d+\.\d+)/);
const sv = svMatch ? svMatch[1] : null;

if (!sv) {
  console.error('Could not find version in schema description');
  process.exit(1);
}

if (pv !== sv) {
  console.error(`Protocol version mismatch: runtime expects ${pv} but schema defines ${sv}`);
  process.exit(1);
}

console.log(`Protocol aligned: ${pv}`);
