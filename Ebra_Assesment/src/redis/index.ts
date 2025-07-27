import Redis from 'ioredis';
import 'dotenv/config';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const ACTIVE_CALLS_KEY = 'active_calls';
const ENTITY_LOCK_PREFIX = 'entity_lock:'; // Lock by phone number
const CALL_LOCK_PREFIX = 'call_lock:';     // Lock by call ID
const MAX_CALLS = 30;
const LOCK_TTL = 300; // 5 minutes TTL for locks

// Lua script for atomic concurrency + entity locking
const START_CALL_SCRIPT = `
  local active_key = KEYS[1]           -- active_calls
  local entity_lock_key = KEYS[2]      -- entity_lock:+966501234567
  local call_lock_key = KEYS[3]        -- call_lock:call-uuid
  local call_id = ARGV[1]
  local entity_id = ARGV[2]            -- phone number
  local max_calls = tonumber(ARGV[3])
  local lock_ttl = tonumber(ARGV[4])
  
  -- Check if this specific call is already being processed
  if redis.call('EXISTS', call_lock_key) == 1 then
    return {0, 'CALL_ALREADY_PROCESSING'}
  end
  
  -- Check if this entity (phone number) is already being called
  if redis.call('EXISTS', entity_lock_key) == 1 then
    return {0, 'ENTITY_ALREADY_CALLING'}
  end
  
  -- Check global concurrency limit
  local current_count = redis.call('SCARD', active_key)
  if current_count >= max_calls then
    return {0, 'CONCURRENCY_LIMIT'}
  end
  
  -- Atomically acquire all locks
  redis.call('SADD', active_key, call_id)
  redis.call('SETEX', entity_lock_key, lock_ttl, call_id)
  redis.call('SETEX', call_lock_key, lock_ttl, '1')
  
  return {1, 'SUCCESS'}
`;

// Lua script for atomic cleanup
const END_CALL_SCRIPT = `
  local active_key = KEYS[1]        -- active_calls
  local entity_lock_key = KEYS[2]   -- entity_lock:+966501234567
  local call_lock_key = KEYS[3]     -- call_lock:call-uuid
  local call_id = ARGV[1]
  
  -- Remove from active calls
  redis.call('SREM', active_key, call_id)
  
  -- Release entity lock only if this call owns it
  local entity_lock_owner = redis.call('GET', entity_lock_key)
  if entity_lock_owner == call_id then
    redis.call('DEL', entity_lock_key)
  end
  
  -- Release call lock
  redis.call('DEL', call_lock_key)
  
  return 1
`;

export const redisClient = {
  // Try to start a call with both concurrency and entity locking
  async startCall(callId: string, phoneNumber: string): Promise<{ canStart: boolean; reason?: string }> {
    // Normalize phone number for consistent locking
    const normalizedPhone = phoneNumber.replace(/[^\d+]/g, '');
    
    const result = await redis.eval(
      START_CALL_SCRIPT,
      3,
      ACTIVE_CALLS_KEY,
      `${ENTITY_LOCK_PREFIX}${normalizedPhone}`,
      `${CALL_LOCK_PREFIX}${callId}`,
      callId,
      normalizedPhone,
      MAX_CALLS.toString(),
      LOCK_TTL.toString()
    ) as [number, string];

    const [success, reason] = result;
    return {
      canStart: success === 1,
      reason: success === 0 ? reason : undefined
    };
  },

  // End a call - remove from active set and release locks atomically
  async endCall(callId: string, phoneNumber: string): Promise<void> {
    const normalizedPhone = phoneNumber.replace(/[^\d+]/g, '');
    
    await redis.eval(
      END_CALL_SCRIPT,
      3,
      ACTIVE_CALLS_KEY,
      `${ENTITY_LOCK_PREFIX}${normalizedPhone}`,
      `${CALL_LOCK_PREFIX}${callId}`,
      callId
    );
  },

  // Get current active call count
  async getActiveCount(): Promise<number> {
    return await redis.scard(ACTIVE_CALLS_KEY);
  },

  // Check if an entity (phone number) is currently being called
  async isEntityLocked(phoneNumber: string): Promise<{ locked: boolean; byCallId?: string }> {
    const normalizedPhone = phoneNumber.replace(/[^\d+]/g, '');
    const lockOwner = await redis.get(`${ENTITY_LOCK_PREFIX}${normalizedPhone}`);
    
    return {
      locked: !!lockOwner,
      byCallId: lockOwner || undefined
    };
  },

  // Check if a specific call is locked
  async isCallLocked(callId: string): Promise<boolean> {
    const exists = await redis.exists(`${CALL_LOCK_PREFIX}${callId}`);
    return exists === 1;
  },

  // Emergency cleanup functions
  async forceReleaseEntityLock(phoneNumber: string): Promise<void> {
    const normalizedPhone = phoneNumber.replace(/[^\d+]/g, '');
    await redis.del(`${ENTITY_LOCK_PREFIX}${normalizedPhone}`);
  },

  async forceReleaseCallLock(callId: string): Promise<void> {
    await redis.del(`${CALL_LOCK_PREFIX}${callId}`);
  },

  // Debug function to see all active locks
  async getDebugInfo(): Promise<{
    activeCount: number;
    entityLocks: string[];
    callLocks: string[];
  }> {
    const activeCount = await this.getActiveCount();
    const entityLocks = await redis.keys(`${ENTITY_LOCK_PREFIX}*`);
    const callLocks = await redis.keys(`${CALL_LOCK_PREFIX}*`);
    
    return {
      activeCount,
      entityLocks,
      callLocks
    };
  }
};