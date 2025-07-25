export interface Call {
  id: string;
  payload: {
    to: string;
    scriptId: string;
    metadata?: Record<string, any>;
  };
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  attempts: number;
  lastError?: string;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}

export interface CallMessage {
  callId: string;
  payload: {
    to: string;
    scriptId: string;
    metadata?: Record<string, any>;
  };
  attempts: number;
  priority?: 'low' | 'normal' | 'high';
  retryAt?: Date;
}

export interface WebhookPayload {
  callId: string;
  status: 'COMPLETED' | 'FAILED' | 'BUSY' | 'NO_ANSWER';
  durationSec?: number;
  completedAt: string;
}

export interface SystemMetrics {
  [status: string]: number;
  concurrent_in_progress: number;
  queue_size: number;
  total_processed: number;
}