import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { redisClient } from './redis/index.js';

const router = express.Router();

// Webhook secret from environment
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  console.error('❌ WEBHOOK_SECRET environment variable is required');
  process.exit(1);
}

// Store raw body for signature verification
interface RequestWithRawBody extends express.Request {
  rawBody?: Buffer;
}

// Middleware to capture raw body before JSON parsing
const captureRawBody = (req: RequestWithRawBody, res: express.Response, next: express.NextFunction) => {
  let rawBody = '';
  
  req.on('data', (chunk) => {
    rawBody += chunk;
  });
  
  req.on('end', () => {
    req.rawBody = Buffer.from(rawBody);
    next();
  });
};

// Middleware to verify webhook signature
const verifyWebhookSignature = (req: RequestWithRawBody, res: express.Response, next: express.NextFunction) => {
  const signature = req.headers['x-webhook-signature'] as string;
  const timestamp = req.headers['x-webhook-timestamp'] as string;
  
  console.log('🔐 Verifying webhook signature...');

  // Check if signature exists
  if (!signature) {
    console.log('❌ Missing webhook signature header');
    return res.status(401).json({ 
      error: 'Missing signature',
      message: 'X-Webhook-Signature header is required' 
    });
  }

  // Optional: Check timestamp to prevent replay attacks (within 5 minutes)
  if (timestamp) {
    const requestTime = parseInt(timestamp);
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(currentTime - requestTime);
    
    if (timeDiff > 300) { // 5 minutes
      console.log(`❌ Webhook timestamp too old: ${timeDiff}s difference`);
      return res.status(401).json({ 
        error: 'Request timestamp too old',
        message: 'Webhook must be delivered within 5 minutes'
      });
    }
    console.log(`✅ Timestamp check passed: ${timeDiff}s ago`);
  }

  // Get the raw body for signature verification
  const body = req.rawBody?.toString() || JSON.stringify(req.body);
  
  // Create expected signature
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  
  // Handle signature format (with or without sha256= prefix)
  const providedSignature = signature.startsWith('sha256=') 
    ? signature.slice(7) 
    : signature;

  // Use timing-safe comparison to prevent timing attacks
  const signaturesMatch = crypto.timingSafeEqual(
    Buffer.from(expectedSignature, 'hex'),
    Buffer.from(providedSignature, 'hex')
  );

  if (!signaturesMatch) {
    console.log('❌ Invalid webhook signature');
    console.log(`Expected: ${expectedSignature}`);
    console.log(`Received: ${providedSignature}`);
    return res.status(401).json({ 
      error: 'Invalid signature',
      message: 'Webhook signature verification failed'
    });
  }

  console.log('✅ Webhook signature verified successfully');
  next();
};

// Apply raw body capture middleware to call-status endpoint
router.use('/call-status', express.raw({ type: 'application/json' }));
router.use('/call-status', captureRawBody);

// Main callback endpoint with authentication
router.post('/call-status', verifyWebhookSignature, async (req: RequestWithRawBody, res) => {
  try {
    // Parse the JSON body (it's raw at this point due to middleware)
    const body = JSON.parse(req.rawBody?.toString() || '{}');
    const { callId, status, completedAt, durationSec, failureReason } = body;
    
    console.log(`📞 Authenticated webhook received for ${callId}: ${status}`);

    // Validate required fields
    if (!callId || !status) {
      console.log('❌ Missing required fields in webhook payload');
      return res.status(400).json({ 
        error: 'Invalid payload',
        message: 'callId and status are required fields'
      });
    }

    // Find our call by external ID
    const result = await db.query(
      'SELECT * FROM calls WHERE external_call_id = $1',
      [callId]
    );

    if (result.rows.length === 0) {
      console.log(`❌ Call not found for external ID ${callId}`);
      return res.status(404).json({ 
        error: 'Call not found',
        message: `No call found with external ID: ${callId}`
      });
    }

    const call = db.mapRow(result.rows[0]);

    // Check if call is in the right state for updates
    if (call.status !== 'IN_PROGRESS') {
      console.log(`⚠️ Call ${call.id} is not IN_PROGRESS (current: ${call.status})`);
      // Return 200 to prevent webhook retries for already processed calls
      return res.json({ 
        message: 'Call already processed',
        currentStatus: call.status
      });
    }

    // Map external status to our internal status
    const finalStatus = mapExternalStatus(status);
    
    // Prepare update data
    const updateData: any = {
      status: finalStatus,
      endedAt: completedAt ? new Date(completedAt) : new Date()
    };

    // Add error details for failed calls
    if (finalStatus === 'FAILED') {
      updateData.lastError = failureReason || `Call ${status.toLowerCase()}`;
    }

    // Update call in database
    const updatedCall = await db.updateCall(call.id, updateData);
    
    if (!updatedCall) {
      throw new Error('Failed to update call in database');
    }

    // Release concurrency slot
    await redisClient.endCall(call.id);

    // Log success with details
    const duration = durationSec ? ` (${durationSec}s)` : '';
    console.log(`✅ Call ${call.id} updated: ${call.status} → ${finalStatus}${duration}`);
    
    // Log for monitoring/analytics
    if (finalStatus === 'COMPLETED') {
      console.log(`📈 SUCCESS: ${call.payload.to} (${call.payload.scriptId})${duration}`);
    } else {
      console.log(`📉 FAILED: ${call.payload.to} - ${updateData.lastError}`);
    }

    // Return success response
    res.json({ 
      message: 'Webhook processed successfully',
      callId: call.id,
      externalCallId: callId,
      status: finalStatus,
      duration: durationSec
    });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    
    // Determine if this is a retryable error
    if (isRetryableError(error)) {
      // Return 5xx for retryable errors so provider will retry
      res.status(500).json({ 
        error: 'Temporary error',
        message: 'Please retry webhook delivery'
      });
    } else {
      // Return 200 for non-retryable errors to stop retries
      res.status(200).json({ 
        error: 'Processing error',
        message: 'Webhook received but could not be processed'
      });
    }
  }
});

// Health check endpoint for webhook system
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    service: 'webhook-handler',
    timestamp: new Date().toISOString(),
    webhookSecret: WEBHOOK_SECRET ? 'configured' : 'missing'
  });
});

// Test endpoint to verify webhook signature (development only)
router.post('/test-signature', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const testPayload = { test: 'data', timestamp: Date.now() };
  const body = JSON.stringify(testPayload);
  
  const signature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  res.json({
    message: 'Test signature generated',
    payload: testPayload,
    signature: `sha256=${signature}`,
    timestamp: Math.floor(Date.now() / 1000).toString(),
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': `sha256=${signature}`,
      'X-Webhook-Timestamp': Math.floor(Date.now() / 1000).toString()
    }
  });
});

// Helper function to map external statuses to internal ones
function mapExternalStatus(externalStatus: string): 'COMPLETED' | 'FAILED' {
  const status = externalStatus.toUpperCase();
  
  // Map various success statuses
  const successStatuses = ['COMPLETED', 'SUCCESS', 'ANSWERED', 'FINISHED'];
  if (successStatuses.includes(status)) {
    return 'COMPLETED';
  }
  
  // Map various failure statuses
  const failureStatuses = [
    'FAILED', 'BUSY', 'NO_ANSWER', 'DECLINED', 
    'TIMEOUT', 'ERROR', 'CANCELLED', 'REJECTED'
  ];
  
  if (failureStatuses.includes(status)) {
    return 'FAILED';
  }
  
  // Default to FAILED for unknown statuses
  console.log(`⚠️ Unknown external status: ${externalStatus}, defaulting to FAILED`);
  return 'FAILED';
}

// Helper function to determine if an error is retryable
function isRetryableError(error: any): boolean {
  const message = error.message?.toLowerCase() || '';
  
  // Database connection issues are retryable
  if (message.includes('connection') || message.includes('timeout')) {
    return true;
  }
  
  // Redis connection issues are retryable
  if (message.includes('redis') || message.includes('econnrefused')) {
    return true;
  }
  
  // Network issues are retryable
  if (message.includes('network') || message.includes('enotfound')) {
    return true;
  }
  
  // Parsing errors are not retryable
  if (message.includes('json') || message.includes('parse')) {
    return false;
  }
  
  // Default to not retryable
  return false;
}

export { router as callbackRouter };