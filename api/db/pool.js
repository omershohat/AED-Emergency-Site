// ============================================================================
//  MySQL connection layer (the SQL half of the project)
// ============================================================================
//  We use the mysql2 driver directly and write our own SQL - no ORM.
//  Reason: every query in this project must be readable and defendable line by
//  line. An ORM would hide the JOINs and the transactions behind method chains.
// ============================================================================
import mysql from 'mysql2/promise';

// A POOL, not a single connection: Express handles many requests at the same
// time, and a single connection would serialise them. The pool hands out an
// idle connection per query and returns it automatically.
export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'field_defib',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',   // Hebrew content must round-trip correctly
  timezone: 'Z',
});

/**
 * Run a query and return only the rows.
 *
 * `params` are ALWAYS passed as the second argument, never concatenated into
 * the SQL string. The driver sends them separately from the statement, so a
 * value like  "' OR 1=1 --"  can never become executable SQL.
 * This single rule is our SQL-injection defence.
 *
 * @param {string} sql    statement with ? placeholders
 * @param {Array}  params values for the placeholders
 */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Run several statements as ONE transaction.
 *
 * Used by the registration flow: inserting a responder and their devices must
 * either both succeed or both be undone - we must never store a responder with
 * no equipment, because that row would be invisible to the dispatch algorithm.
 *
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<any>} work
 */
export async function withTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();   // undo everything this function did
    throw err;
  } finally {
    conn.release();          // always give the connection back to the pool
  }
}

/** Fails fast on startup with a clear message instead of on the first request. */
export async function assertDbReachable() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
}
