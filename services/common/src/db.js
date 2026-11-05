const { Pool } = require('pg');
const { logger } = require('./logger');

function createPool() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_SIZE || 20),
    connectionTimeoutMillis: 3000,
  });
  // An idle client losing its connection must not crash the process.
  pool.on('error', (err) => logger.warn({ err: err.message }, 'idle database client error'));
  return pool;
}

async function withTx(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPool, withTx };
