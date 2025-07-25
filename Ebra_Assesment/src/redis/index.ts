import Redis from 'ioredis';
import 'dotenv/config';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

const ACTIVE_CALLS_KEY = 'active_calls';
const MAX_CALLS = 30;

export const redisClient = {
  // Try to start a call - returns true if we can, false if at limit
  async startCall(callId: string): Promise<boolean> {
    const count = await redis.scard(ACTIVE_CALLS_KEY);
    if (count >= MAX_CALLS) return false;
    
    await redis.sadd(ACTIVE_CALLS_KEY, callId);
    return true;
  },

  // End a call - remove from active set
  async endCall(callId: string): Promise<void> {
    await redis.srem(ACTIVE_CALLS_KEY, callId);
  },

  // Get current active call count
  async getActiveCount(): Promise<number> {
    return await redis.scard(ACTIVE_CALLS_KEY);
  }
};