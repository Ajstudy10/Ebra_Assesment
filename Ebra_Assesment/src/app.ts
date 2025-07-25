import express from 'express';
import { db } from '../db/index.js';
import { kafkaClient } from './kafka/index.js';
import { callbackRouter } from './callbacks.js';

const app = express();
app.use(express.json());

// Mount callbacks
app.use('/callbacks', callbackRouter);

// 1. Create Call
app.post('/calls', async (req, res) => {
  try {
    const { to, scriptId, metadata } = req.body;
    
    if (!to || !scriptId) {
      return res.status(400).json({ error: 'Missing to or scriptId' });
    }

    // Check for existing active call to same number
    const existing = await db.query(
      "SELECT id FROM calls WHERE payload->>'to' = $1 AND status = 'IN_PROGRESS'",
      [to]
    );
    
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Call already in progress to this number' });
    }

    // Create call
    const call = await db.createCall({ to, scriptId, metadata });
    
    // Queue for processing
    await kafkaClient.queueCall(call.id);
    
    res.status(201).json(call);
  } catch (error) {
    console.error('Error creating call:', error);
    res.status(500).json({ error: 'Internal error' });
  }
});

// 2. Get Call
app.get('/calls/:id', async (req, res) => {
  try {
    const call = await db.getCall(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    res.json(call);
  } catch (error) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// 3. Update Call
app.patch('/calls/:id', async (req, res) => {
  try {
    const call = await db.getCall(req.params.id);
    if (!call) return res.status(404).json({ error: 'Call not found' });
    
    if (call.status !== 'PENDING') {
      return res.status(409).json({ error: 'Can only update PENDING calls' });
    }

    const updated = await db.updateCall(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// 4. List Calls
app.get('/calls', async (req, res) => {
  try {
    const { status, page = '1', limit = '50' } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    
    if (status) {
      const calls = await db.getCallsByStatus(status as string, parseInt(limit as string), offset);
      res.json({ calls });
    } else {
      const result = await db.query(
        'SELECT * FROM calls ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
      const calls = result.rows.map(row => db.mapRow(row));
      res.json({ calls });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// 5. Metrics
app.get('/metrics', async (req, res) => {
  try {
    const metrics = await db.getMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;

async function start() {
  await kafkaClient.connect();
  app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
  });
}

start().catch(console.error);

export { app };