import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // optional: ssl for managed DBs later
  // ssl: { rejectUnauthorized: false }
});

export default pool;
