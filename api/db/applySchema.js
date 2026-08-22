// ============================================================================
//  Creates the database and all tables from schema.sql.
//  Run once:  npm run db:schema        (from the api folder, or from the root)
// ============================================================================
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');

// Note: we connect WITHOUT selecting a database, because schema.sql is the
// thing that creates it. `multipleStatements` lets us send the whole file at
// once - it is enabled only here, never on the request-serving pool.
const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  multipleStatements: true,
});

await conn.query(sql);
await conn.end();

console.log('[schema] field_defib database and tables are ready.');
