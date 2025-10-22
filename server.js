/**
 * Multi-Tenant WebSocket Server for Twilio Voice AI Workshop
 *
 * This server handles ConversationRelay connections for all workshop students.
 * Each student gets a unique WebSocket URL with their session token.
 * The server loads student-specific configs from the database.
 */

import { WebSocketServer } from 'ws';
import http from 'http';
import { getStudentConfig } from './database.js';
import { handleConversationRelay } from './conversation-handler.js';

const PORT = process.env.PORT || 3000;

// Create HTTP server
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'workshop-websocket-server',
      uptime: process.uptime()
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Create WebSocket server
const wss = new WebSocketServer({
  server,
  path: '/ws'
});

console.log('🚀 Multi-tenant WebSocket server starting...');

// Handle WebSocket connections
wss.on('connection', async (ws, req) => {
  // Extract session token from URL: /ws/student-abc123
  const urlParts = req.url.split('/');
  const sessionToken = urlParts[urlParts.length - 1];

  if (!sessionToken || sessionToken === 'ws') {
    console.error('❌ No session token provided in URL');
    ws.close(1008, 'Session token required');
    return;
  }

  console.log(`📞 New connection for session: ${sessionToken.substring(0, 8)}...`);

  try {
    // Load student configuration from database
    const studentConfig = await getStudentConfig(sessionToken);

    if (!studentConfig) {
      console.error(`❌ No config found for session: ${sessionToken.substring(0, 8)}...`);
      ws.close(1008, 'Invalid session token');
      return;
    }

    console.log(`✅ Loaded config for student: ${studentConfig.student_name || 'Unknown'}`);

    // Handle ConversationRelay protocol with student's config
    handleConversationRelay(ws, studentConfig, sessionToken);

  } catch (error) {
    console.error('❌ Error loading student config:', error);
    ws.close(1011, 'Server error');
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`✅ Multi-tenant WebSocket server running on port ${PORT}`);
  console.log(`   WebSocket endpoint: ws://localhost:${PORT}/ws/{session-token}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
