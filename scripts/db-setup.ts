/** Optional: create the database tables now (the app also does this automatically on first sync). */
import { getDb } from '../server/db.js';
import { ensureSchema, schemaStatements } from '../server/schema.js';

const q = getDb();
await ensureSchema(q);
console.log(`✅ Database ready (${schemaStatements().length} statements checked).`);
process.exit(0);
