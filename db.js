const { Pool } = require('pg')

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
  database: process.env.PGDATABASE || 'KumarExports',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  max: 5,
})

pool.on('error', (err) => {
  console.error('Unexpected PG pool error', err)
})

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
}
