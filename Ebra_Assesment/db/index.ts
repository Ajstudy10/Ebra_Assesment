import { Pool } from 'pg';
import 'dotenv/config';

export interface Call {
  id: string;
  payload: { to: string; scriptId: string; metadata?: any };
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  attempts: number;
  lastError?: string;
  externalCallId?: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ai_calls',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

export const db = {
  async query(text: string, params?: any[]) {
    return pool.query(text, params);
  },

  async createCall(payload: Call['payload']): Promise<Call> {
    const result = await pool.query(
      'INSERT INTO calls (payload) VALUES ($1) RETURNING *',
      [JSON.stringify(payload)]
    );
    return this.mapRow(result.rows[0]);
  },

  async getCall(id: string): Promise<Call | null> {
    const result = await pool.query('SELECT * FROM calls WHERE id = $1', [id]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  },

  async updateCall(id: string, updates: Partial<Call>): Promise<Call | null> {
    const fields = [];
    const values = [];
    let i = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const dbKey = key === 'lastError' ? 'last_error' : 
                     key === 'externalCallId' ? 'external_call_id' :
                     key === 'startedAt' ? 'started_at' :
                     key === 'endedAt' ? 'ended_at' : key;
        fields.push(`${dbKey} = $${i++}`);
        values.push(key === 'payload' ? JSON.stringify(value) : value);
      }
    }

    if (fields.length === 0) return null;

    values.push(id);
    const result = await pool.query(
      `UPDATE calls SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  },

  async getCallsByStatus(status: string, limit = 50, offset = 0) {
    const result = await pool.query(
      'SELECT * FROM calls WHERE status = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [status, limit, offset]
    );
    return result.rows.map(row => this.mapRow(row));
  },

  async fetchPendingCall(): Promise<Call | null> {
    const result = await pool.query(`
      UPDATE calls 
      SET status = 'IN_PROGRESS', started_at = NOW(), attempts = attempts + 1
      WHERE id = (
        SELECT id FROM calls 
        WHERE status = 'PENDING' 
        AND (payload->>'to') NOT IN (
          SELECT payload->>'to' FROM calls WHERE status = 'IN_PROGRESS'
        )
        ORDER BY created_at 
        LIMIT 1
      )
      RETURNING *
    `);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  },

  async getInProgressCount(): Promise<number> {
    const result = await pool.query("SELECT COUNT(*) FROM calls WHERE status = 'IN_PROGRESS'");
    return parseInt(result.rows[0].count);
  },

  async getMetrics() {
    const result = await pool.query('SELECT status, COUNT(*) as count FROM calls GROUP BY status');
    const metrics: Record<string, number> = {};
    result.rows.forEach(row => {
      metrics[row.status] = parseInt(row.count);
    });
    return metrics;
  },

  mapRow(row: any): Call {
    return {
      id: row.id,
      payload: row.payload,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      externalCallId: row.external_call_id,
      createdAt: row.created_at,
      startedAt: row.started_at,
      endedAt: row.ended_at,
    };
  }
};