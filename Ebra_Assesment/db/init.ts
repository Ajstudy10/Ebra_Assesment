import fs from 'fs';
import path from 'path';
import pool from './index';

const initDb = async () => {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  try {
    await pool.query(schema);
    console.log('✅ Database initialized from schema.sql');
  } catch (err) {
    console.error('❌ Failed to initialize database:', err);
  }
};

export default initDb;