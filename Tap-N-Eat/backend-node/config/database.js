const mysql = require('mysql2/promise');
const path = require('path');
const fs   = require('fs');
// Look for .env in the backend root dir, then fall back to parent directory
const envA = path.join(__dirname, '../.env');
const envB = path.join(__dirname, '../../.env');
require('dotenv').config({ path: fs.existsSync(envA) ? envA : envB });

const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  database: process.env.DB_NAME     || 'qsr_system',
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 10000,   // 10 s — fail fast if MySQL is unreachable
  charset: 'utf8mb4',
});

module.exports = pool;
