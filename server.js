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
const server = http.createServer(async (req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'workshop-websocket-server',
      uptime: process.uptime()
    }));
  } else if (req.url === '/test-db') {
    // Test database connection
    try {
      const testConfig = await getStudentConfig('ws_1761110889775_ve2vtj28p6');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        hasConfig: !!testConfig,
        studentName: testConfig?.student_name || 'Not found'
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: error.message
      }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Create WebSocket server
// Note: Don't specify path - accept all WebSocket connections and filter in handler
const wss = new WebSocketServer({
  server
});

console.log('🚀 Multi-tenant WebSocket server starting...');

// Handle WebSocket connections
wss.on('connection', async (ws, req) => {
  console.log(`📡 WebSocket connection attempt: ${req.url}`);

  // Extract session token from URL: /ws/student-abc123
  if (!req.url.startsWith('/ws/')) {
    console.error(`❌ Invalid WebSocket path: ${req.url}`);
    ws.close(1008, 'Invalid WebSocket path - must start with /ws/');
    return;
  }

  const urlParts = req.url.split('/');
  const lastPart = urlParts[urlParts.length - 1];

  // Strip query parameters from session token (e.g., ?encryptedKey=...)
  const sessionToken = lastPart.split('?')[0];

  if (!sessionToken || sessionToken === 'ws') {
    console.error('❌ No session token provided in URL');
    ws.close(1008, 'Session token required');
    return;
  }

  console.log(`📞 New connection for session: ${sessionToken.substring(0, 8)}...`);

  try {
    // Fetch student settings from Vercel API (includes decrypted OpenAI key)
    const vercelApiUrl = process.env.VERCEL_API_URL || 'https://twilio-voice-ai-workshop-vercel.vercel.app';
    const settingsUrl = `${vercelApiUrl}/api/get-student-ai-settings?sessionToken=${encodeURIComponent(sessionToken)}`;

    console.log(`🔍 Fetching settings from: ${settingsUrl}`);
    const settingsResponse = await fetch(settingsUrl);

    if (!settingsResponse.ok) {
      console.error(`❌ Failed to fetch settings: ${settingsResponse.status}`);
      ws.close(1008, 'Failed to load student settings');
      return;
    }

    const settingsData = await settingsResponse.json();

    if (!settingsData.success || !settingsData.settings) {
      console.error(`❌ No settings found for session: ${sessionToken.substring(0, 8)}...`);
      ws.close(1008, 'Invalid session token');
      return;
    }

    // Convert Vercel API response to studentConfig format
    const studentConfig = {
      session_token: sessionToken,
      student_name: settingsData.settings.studentName,
      openai_api_key: settingsData.settings.openaiApiKey,  // Already decrypted by Vercel API
      system_prompt: settingsData.settings.systemPrompt,
      tools: settingsData.settings.tools ? JSON.parse(settingsData.settings.tools) : [],
      voice_settings: {
        voice: settingsData.settings.voice || 'alloy',
        greeting: settingsData.settings.greeting
      }
    };

    console.log(`✅ Loaded config for student: ${studentConfig.student_name || 'Unknown'}`);
    console.log(`   OpenAI key: ${studentConfig.openai_api_key ? '✓ Available (decrypted)' : '✗ Missing'}`);

    // Handle ConversationRelay protocol with student's config
    handleConversationRelay(ws, studentConfig, sessionToken);

  } catch (error) {
    console.error('❌ Error loading student config:', error);
    ws.close(1011, 'Server error');
  }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Multi-tenant WebSocket server running on port ${PORT}`);
  console.log(`   WebSocket endpoint: ws://0.0.0.0:${PORT}/ws/{session-token}`);
  console.log(`   Health check: http://0.0.0.0:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
