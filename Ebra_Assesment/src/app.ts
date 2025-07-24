import express from 'express';
import initDb from '../db/init';
import pool from '../db/index';
const app = express();
app.use(express.json());

(async () => {
  await initDb();

    app.post('/calls', async (req, res) => {
  const { to, scriptId, metadata } = req.body;

  // Basic validation
  if (!to || !scriptId) {
    return res.status(400).json({ error: "'to' and 'scriptId' are required." });
  }

  const payload = { to, scriptId, metadata };

  try {
    const result = await pool.query(
      `INSERT INTO calls (payload, status, attempts, createdAt)
       VALUES ($1, 'PENDING', 0, NOW())
       RETURNING *`,
      [payload]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/calls/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM calls WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Call not found.' });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/calls/:id', async (req, res) => {
  const { id } = req.params;
  const { to, scriptId, metadata } = req.body;

  // Build new payload
  const newPayload = { to, scriptId, metadata };

  try {
    // Only update if status is 'PENDING'
    const result = await pool.query(
      `UPDATE calls
       SET payload = $1
       WHERE id = $2 AND status = 'PENDING'
       RETURNING *`,
      [newPayload, id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: "Call not found or not in 'PENDING' status." });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/calls', async (req, res) => {
  const { status, page = 1, limit = 10 } = req.query;

  const validStatuses = ['PENDING', 'IN_PROGRESS', 'FAILED', 'COMPLETED'];
  if (status && !validStatuses.includes(String(status))) {
    return res.status(400).json({ error: 'Invalid status value.' });
  }

  const offset = (Number(page) - 1) * Number(limit);

  try {
    let result;
    if (status) {
      result = await pool.query(
        `SELECT * FROM calls
         WHERE status = $1
         ORDER BY createdAt DESC
         LIMIT $2 OFFSET $3`,
        [status, Number(limit), offset]
      );
    } else {
      result = await pool.query(
        `SELECT * FROM calls
         ORDER BY createdAt DESC
         LIMIT $1 OFFSET $2`,
        [Number(limit), offset]
      );
    }
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

  app.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
  });
})();