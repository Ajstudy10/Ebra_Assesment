import { Kafka } from 'kafkajs';
import 'dotenv/config';

const kafka = new Kafka({
  clientId: 'ai-calls',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ 
  groupId: 'call-workers',
  // Important: Control concurrency at Redis level, not Kafka level
  maxInFlightRequests: 50 // Allow more in-flight requests
});

export const kafkaClient = {
  async connect() {
    await producer.connect();
    await consumer.connect();
    await consumer.subscribe({ topics: ['call-requests', 'call-retries'] });
  },

  // Add call to queue
  async queueCall(callId: string, isRetry = false) {
    const topic = isRetry ? 'call-retries' : 'call-requests';
    await producer.send({
      topic,
      messages: [{ 
        key: callId, 
        value: JSON.stringify({ 
          callId, 
          isRetry,
          timestamp: Date.now() 
        }) 
      }]
    });
  },

  // Start processing calls - Let Redis handle concurrency, process messages concurrently
  async startWorker(handler: (callId: string) => Promise<void>) {
    await consumer.run({
      eachBatchAutoResolve: false, // Manual commit for better control
      partitionsConsumedConcurrently: 10, // Process multiple partitions
      eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
        // Process messages concurrently - Redis will handle the limiting
        const tasks = batch.messages.map(async (message) => {
          try {
            if (message.value) {
              const { callId } = JSON.parse(message.value.toString());
              await handler(callId);
            }
            
            // Commit offset after successful processing
            resolveOffset(message.offset);
            
          } catch (err) {
            console.error('❌ Error processing call:', err);
            // Still resolve offset to avoid reprocessing
            resolveOffset(message.offset);
          }
        });

        // Process all messages in batch concurrently
        await Promise.all(tasks);
        await heartbeat();
      },
    });
  },

  async disconnect() {
    await producer.disconnect();
    await consumer.disconnect();
  }
};