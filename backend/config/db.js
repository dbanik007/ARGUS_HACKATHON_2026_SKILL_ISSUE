const { Pool } = require('pg');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@db:5432/boardroom';

const pool = new Pool({
  connectionString: dbUrl,
});

const connectWithRetry = (retries = 5, delay = 3000) => {
  return new Promise((resolve, reject) => {
    const attemptConnection = (attempt) => {
      console.log(`Connecting to PostgreSQL (Attempt ${attempt}/${retries})...`);
      pool.query('SELECT NOW()', (err, res) => {
        if (!err) {
          console.log('PostgreSQL connected successfully.');
          resolve(pool);
        } else {
          console.error('PostgreSQL connection failed:', err.message);
          if (attempt < retries) {
            setTimeout(() => attemptConnection(attempt + 1), delay);
          } else {
            reject(new Error('Failed to connect to database after maximum retries.'));
          }
        }
      });
    };
    attemptConnection(1);
  });
};

module.exports = {
  pool,
  connectWithRetry
};
