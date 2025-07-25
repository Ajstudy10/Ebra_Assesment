import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'ai-calls',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'call-workers' });

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
      messages: [{ key: callId, value: JSON.stringify({ callId, isRetry }) }]
    });
  },

  // Start processing calls
  async startWorker(handler: (callId: string) => Promise<void>) {
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (message.value) {
          const { callId } = JSON.parse(message.value.toString());
          await handler(callId);
        }
      },
    });
  },

  async disconnect() {
    await producer.disconnect();
    await consumer.disconnect();
  }
};