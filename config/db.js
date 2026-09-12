// Reusable MySQL connection pool (mysql2/promise).
// Import `pool` anywhere a query is needed instead of opening new connections.

const mysql = require('mysql2/promise');
const config = require('./env');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.name,
  user: config.db.user,
  password: config.db.password,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log('[db] MySQL connection successful');
  } catch (err) {
    console.error('[db] MySQL connection failed:', err.message);
  }
}

module.exports = { pool, testConnection };
