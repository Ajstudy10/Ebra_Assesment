# AI Call Orchestrator Service

Backend service for managing AI-driven calls with queue processing, concurrency control, and retry logic.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose

### Setup & Run

1. **Start infrastructure:**
```bash
docker-compose up -d
```

2. **Install & run application:**
```bash
npm install
cp .env.example .env
npm run build
```

3. **Start services:**
```bash
# Terminal 1: API Server
npm start

# Terminal 2: Worker Process  
npm run start:worker
```

4. **Test the API:**
```bash
curl -X POST http://localhost:3000/calls \
  -H "Content-Type: application/json" \
  -d '{"to": "+966501234567", "scriptId": "testScript"}'
```

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/calls` | Create a new call |
| GET | `/calls/:id` | Get call details |
| PATCH | `/calls/:id` | Update call (if PENDING) |
| GET | `/calls` | List calls with pagination |
| GET | `/metrics` | Get system metrics |

## 🏗️ Architecture

```
API Server ←→ Kafka Queue ←→ Worker Process
     ↓              ↓              ↓
Database    ←→    Redis     ←→   Mock AI
```

## ✅ Key Features

- **Concurrency Control**: Max 30 simultaneous calls
- **Duplicate Prevention**: One call per phone number
- **Retry Logic**: 3 attempts with exponential backoff  
- **Queue Processing**: Kafka for reliable message handling
- **Mock AI Calls**: Simulated for testing purposes

## 📁 Project Structure

```
src/
├── app.ts          # HTTP API server
├── worker.ts       # Background call processor
├── callbacks.ts    # Webhook handler
db/
├── schema.sql      # Database schema
├── index.ts        # Database client
kafka/index.ts      # Message queue client
redis/index.ts      # Concurrency control
```

## 🔧 Configuration

All settings are in `.env` file (copy from `.env.example`):
- Database connection
- Redis connection  
- Kafka broker
- API port

## 🧪 Testing

The system uses mock AI calls that:
- Complete in 10-30 seconds
- Have 90% success rate
- Show retry logic on failures
- Log all activity for debugging

Watch the worker terminal to see call processing in real-time.

---

**Note**: This is a mock implementation for assessment purposes. The AI calls are simulated and don't connect to external services.
"# AdventCode2025" 
