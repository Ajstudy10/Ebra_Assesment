import { db } from '../db/index.js';
import { kafkaClient } from './kafka/index.js';
import { redisClient } from './redis/index.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5, 10, 20]; // 5s, 10s, 20s (shorter for demo)

async function processCall(callId: string) {
  console.log(`🔄 Processing call ${callId}`);

  try {
    // Check if we can start (concurrency limit)
    const canStart = await redisClient.startCall(callId);
    if (!canStart) {
      console.log(`⏸️ Concurrency limit reached, retrying call ${callId} later`);
      await sleep(2000); // Wait 2 seconds
      await kafkaClient.queueCall(callId, true);
      return;
    }

    // Get and lock the call
    const call = await db.fetchPendingCall();
    if (!call) {
      console.log(`⚠️ Call ${callId} not found or already processed`);
      await redisClient.endCall(callId);
      return;
    }

    // MOCK AI CALL - Just simulate the call instead of real HTTP
    try {
      console.log(`📞 Making MOCK AI call to ${call.payload.to} with script ${call.payload.scriptId}`);
      
      // Simulate API call delay (1-3 seconds)
      await sleep(Math.random() * 2000 + 1000);
      
      // Generate mock external call ID
      const mockExternalCallId = `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Simulate success/failure (90% success rate)
      const shouldSucceed = Math.random() > 0.1;
      
      if (shouldSucceed) {
        // Success - store mock external call ID
        await db.updateCall(call.id, { 
          externalCallId: mockExternalCallId 
        });
        console.log(`✅ MOCK AI call started for ${call.id} (external: ${mockExternalCallId})`);
        
        // Simulate the AI call completing after 10-30 seconds
        setTimeout(async () => {
          await simulateCallback(call.id, mockExternalCallId);
        }, Math.random() * 20000 + 10000); // 10-30 seconds
        
      } else {
        throw new Error('Mock API failure - simulating network error');
      }

    } catch (error) {
      console.error(`❌ MOCK AI call failed for ${call.id}:`, error);
      await handleFailure(call, error as Error);
    }

  } catch (error) {
    console.error(`Error processing call ${callId}:`, error);
    await redisClient.endCall(callId);
  }
}

// Simulate the callback that would normally come from the AI provider
async function simulateCallback(callId: string, externalCallId: string) {
  try {
    console.log(`🔔 Simulating callback for call ${callId}`);
    
    // Find the call
    const result = await db.query(
      'SELECT * FROM calls WHERE external_call_id = $1',
      [externalCallId]
    );
    
    if (result.rows.length === 0) {
      console.log(`❌ Call not found for callback simulation`);
      return;
    }
    
    const call = db.mapRow(result.rows[0]);
    
    // Simulate call outcome (80% success rate)
    const wasSuccessful = Math.random() > 0.2;
    const finalStatus = wasSuccessful ? 'COMPLETED' : 'FAILED';
    const mockReason = wasSuccessful ? null : ['BUSY', 'NO_ANSWER', 'FAILED'][Math.floor(Math.random() * 3)];
    
    // Update call status
    await db.updateCall(call.id, {
      status: finalStatus,
      endedAt: new Date(),
      lastError: mockReason ? `Call ${mockReason.toLowerCase()}` : undefined
    });
    
    // Release concurrency slot
    await redisClient.endCall(call.id);
    
    console.log(`🎉 MOCK callback completed: Call ${call.id} = ${finalStatus} ${mockReason ? `(${mockReason})` : ''}`);
    
  } catch (error) {
    console.error('Error in mock callback:', error);
  }
}

async function handleFailure(call: any, error: Error) {
  const shouldRetry = call.attempts < MAX_RETRIES && isRetriable(error);
  
  if (shouldRetry) {
    const delay = RETRY_DELAYS[call.attempts - 1] || 20;
    console.log(`🔄 Retrying call ${call.id} in ${delay} seconds (attempt ${call.attempts + 1}/${MAX_RETRIES})`);
    
    await db.updateCall(call.id, {
      status: 'PENDING',
      lastError: error.message
    });
    
    await sleep(delay * 1000);
    await kafkaClient.queueCall(call.id, true);
  } else {
    console.log(`💀 Call ${call.id} failed permanently after ${call.attempts} attempts`);
    await db.updateCall(call.id, {
      status: 'FAILED',
      lastError: error.message,
      endedAt: new Date()
    });
  }
  
  await redisClient.endCall(call.id);
}

function isRetriable(error: any): boolean {
  // In mock mode, simulate some errors as retriable
  if (error.message.includes('network error')) return true;
  if (error.message.includes('timeout')) return true;
  return Math.random() > 0.5; // 50% of errors are retriable
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Display current status every 10 seconds
setInterval(async () => {
  try {
    const activeCount = await redisClient.getActiveCount();
    const inProgress = await db.getInProgressCount();
    console.log(`📊 Status: ${activeCount}/30 active calls, ${inProgress} in database`);
  } catch (error) {
    // Ignore errors in status display
  }
}, 10000);

// Start worker
async function startWorker() {
  console.log('🤖 Starting MOCK worker (no real API calls)...');
  
  await kafkaClient.connect();
  await kafkaClient.startWorker(processCall);
  
  console.log('✅ MOCK Worker started - will simulate AI calls');
}

startWorker().catch(console.error);