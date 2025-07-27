import { db } from '../db/index.js';
import { kafkaClient } from './kafka/index.js';
import { redisClient } from './redis/index.js';
import 'dotenv/config';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5, 10, 20]; // 5s, 10s, 20s

async function processCall(callId: string) {
  console.log(`🟡 [Start] Processing call ${callId}...`);

  let call: any = null;

  try {
    // First, fetch the call to get the phone number for entity locking
    call = await db.fetchCallById(callId);
    if (!call) {
      console.log(`⚠️ [Missing] Call ${callId} not found`);
      return;
    }

    // Check if call is still processable
    if (call.status !== 'PENDING') {
      console.log(`⚠️ [Invalid State] Call ${callId} is not PENDING (current: ${call.status})`);
      return;
    }

    // Extract phone number for entity locking
    const phoneNumber = call.payload.to;
    
    // Atomic concurrency check and entity locking
    const { canStart, reason } = await redisClient.startCall(callId, phoneNumber);
    
    if (!canStart) {
      if (reason === 'CALL_ALREADY_PROCESSING') {
        console.log(`🔒 [Locked] Call ${callId} is already being processed, skipping`);
        return;
      }
      
      if (reason === 'ENTITY_ALREADY_CALLING') {
        console.log(`📞 [Entity Busy] Phone ${phoneNumber} is already being called, re-queuing`);
        await sleep(5000 + Math.random() * 5000); // Longer wait for entity conflicts
        await kafkaClient.queueCall(callId, true);
        return;
      }
      
      if (reason === 'CONCURRENCY_LIMIT') {
        console.log(`⏸️ [Wait] Concurrency limit reached for call ${callId}, re-queuing`);
        await sleep(2000 + Math.random() * 3000);
        await kafkaClient.queueCall(callId, true);
        return;
      }
    }

    try {
      // Update status to IN_PROGRESS with startedAt timestamp
      await db.updateCall(call.id, {
        status: 'IN_PROGRESS',
        startedAt: new Date()
      });

      console.log(`📞 [Mock API] Simulating AI call to ${call.payload.to} with script ${call.payload.scriptId}`);

      // Mock API call simulation
      await sleep(2000); // Simulate API response time
      const shouldSucceed = Math.random() > 0.3;
      
      if (!shouldSucceed) {
        throw new Error('Mock API failure - simulating network error');
      }
      
      const externalCallId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Store the external call ID for webhook correlation
      await db.updateCall(call.id, {
        externalCallId: externalCallId
      });

      console.log(`✅ [Mock API Success] Call ${call.id} started with external ID: ${externalCallId}`);

      // Schedule mock webhook after 20 seconds (simulating 20-second call duration)
      setTimeout(async () => {
        await simulateWebhook(externalCallId);
      }, 20000);

    } catch (error) {
      console.error(`❌ [API Fail] Call ${call.id} failed:`);
      await handleFailure(call, error as Error, phoneNumber);
    }

  } catch (error) {
    console.error(`🔥 [System Error] Failed to process call ${callId}:`, error);
    
    // Cleanup locks if we have the phone number
    if (call?.payload?.to) {
      await redisClient.endCall(callId, call.payload.to);
    }
  }
}

async function handleFailure(call: any, error: Error, phoneNumber: string) {
  const shouldRetry = call.attempts < MAX_RETRIES && isRetriable(error);

  if (shouldRetry) {
    const delay = RETRY_DELAYS[call.attempts] || 20;
    console.warn(`🔁 [Retry] Call ${call.id} failed. Retrying in ${delay}s (attempt ${call.attempts + 1}/${MAX_RETRIES})`);

    await db.updateCall(call.id, {
      status: 'PENDING',
      lastError: error.message,
      attempts: call.attempts + 1
    });

    // Release locks immediately so retry can re-acquire them
    await redisClient.endCall(call.id, phoneNumber);

    await sleep(delay * 1000);
    await kafkaClient.queueCall(call.id, true);
    
  } else {
    console.error(`❌ [Dead] Call ${call.id} failed after ${call.attempts} attempts`);

    await db.updateCall(call.id, {
      status: 'FAILED',
      lastError: error.message,
      endedAt: new Date(),
      attempts: call.attempts + 1
    });

    // Always cleanup
    await redisClient.endCall(call.id, phoneNumber);
  }
}

async function simulateWebhook(externalCallId: string) {
  const wasSuccessful = Math.random() > 0.2;
  const status = wasSuccessful ? 'COMPLETED' : 'FAILED';
  const failureReason = wasSuccessful ? undefined : ['BUSY', 'NO_ANSWER', 'FAILED'][Math.floor(Math.random() * 3)];
  
  const webhookPayload = {
    callId: externalCallId,
    status: status,
    durationSec: 20, // Always 20 seconds for mock calls
    completedAt: new Date().toISOString(),
    failureReason: failureReason
  };

  console.log(`🔔 [Simulated Webhook] ${externalCallId}: ${status}`);

  // This would normally come from the external provider
  // For simulation, we'll directly call our webhook handler logic
  try {
    // Find our call by external ID
    const result = await db.query(
      'SELECT * FROM calls WHERE external_call_id = $1',
      [externalCallId]
    );

    if (result.rows.length === 0) {
      console.log(`❌ [Webhook] Call not found for external ID ${externalCallId}`);
      return;
    }

    const call = db.mapRow(result.rows[0]);
    
    if (call.status !== 'IN_PROGRESS') {
      console.log(`⚠️ [Webhook] Call ${call.id} is not IN_PROGRESS (current: ${call.status})`);
      return;
    }

    // Map status and update call
    const finalStatus = status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
    const updateData: any = {
      status: finalStatus,
      endedAt: new Date(webhookPayload.completedAt)
    };

    if (finalStatus === 'FAILED') {
      updateData.lastError = failureReason || `Call ${status.toLowerCase()}`;
    }

    await db.updateCall(call.id, updateData);

    // **CRITICAL**: Release locks
    await redisClient.endCall(call.id, call.payload.to);

    console.log(`🎉 [Webhook Complete] Call ${call.id}: ${call.status} → ${finalStatus}`);
    
  } catch (error) {
    console.error('🔥 [Webhook Error]:', error);
  }
}

function isRetriable(error: any): boolean {
  if (error.message.includes('network error')) return true;
  if (error.message.includes('timeout')) return true;
  return Math.random() > 0.5;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

setInterval(async () => {
  try {
    const activeCount = await redisClient.getActiveCount();
    const inProgress = await db.getInProgressCount();
    console.log(`📊 [Status] ${activeCount}/30 active calls in Redis | ${inProgress} in-progress in DB`);
  } catch (error) {
    // Silently ignore
  }
}, 10000);

async function startWorker() {
  console.log('🤖 [Init] Starting MOCK worker (no real API calls)...');

  await kafkaClient.connect();
  await kafkaClient.startWorker(processCall);

  console.log('✅ [Ready] MOCK Worker started - simulating AI calls');
}

startWorker().catch(console.error);
