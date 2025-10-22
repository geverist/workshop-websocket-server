# Workshop WebSocket Server

Multi-tenant WebSocket server for the Twilio Voice AI Workshop.

## Architecture

This server handles ConversationRelay connections for all workshop students. Each student gets a unique WebSocket URL with their session token, and the server loads their configuration from the database.

### Student Flow

1. Student configures their AI in the workshop app (system prompt, tools, etc.)
2. App saves config to Vercel Postgres database
3. Student receives WebSocket URL: `wss://workshop-server.railway.app/ws/{session-token}`
4. Student connects Twilio to this URL
5. Server loads their config and handles calls with their custom settings

## Database Schema

```sql
CREATE TABLE student_configs (
  session_token TEXT PRIMARY KEY,
  student_name TEXT,
  openai_api_key TEXT,
  system_prompt TEXT,
  tools JSONB DEFAULT '[]',
  voice_settings JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Environment Variables

- `POSTGRES_URL` - Vercel Postgres connection string
- `OPENAI_API_KEY` - Fallback OpenAI key (if student doesn't provide one)
- `PORT` - Server port (Railway sets this automatically)

## Deployment

Deployed to Railway using the workshop admin's Railway token.

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy to Railway
railway up
```

## WebSocket Protocol

The server implements the Twilio ConversationRelay WebSocket protocol:

### Incoming Events (from Twilio)
- `setup` - Call metadata
- `prompt` - User speech (transcribed text)
- `dtmf` - Keypad input
- `interrupt` - User interrupted AI

### Outgoing Messages (to Twilio)
- `text` - AI response (will be spoken via TTS)

## Features

- ✅ Multi-tenant routing by session token
- ✅ Per-student configurations (prompts, tools, API keys)
- ✅ OpenAI function calling support
- ✅ Conversation history tracking
- ✅ Error handling and logging
- ✅ Health check endpoint
