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

// Store active credential tunnels (browser connections)
// Key: sessionToken, Value: WebSocket
const activeTunnels = new Map();

// Handle WebSocket connections
wss.on('connection', async (ws, req) => {
  console.log(`📡 WebSocket connection attempt: ${req.url}`);

  // Determine connection type: /ws/ = Twilio, /tunnel/ = Browser
  const isTunnelConnection = req.url.startsWith('/tunnel/');
  const isCallConnection = req.url.startsWith('/ws/');

  if (!isTunnelConnection && !isCallConnection) {
    console.error(`❌ Invalid WebSocket path: ${req.url}`);
    ws.close(1008, 'Invalid WebSocket path - must start with /ws/ or /tunnel/');
    return;
  }

  const urlParts = req.url.split('/');
  const lastPart = urlParts[urlParts.length - 1];

  // Strip query parameters from session token (e.g., ?encryptedKey=...)
  const sessionToken = lastPart.split('?')[0];

  if (!sessionToken || sessionToken === 'ws' || sessionToken === 'tunnel') {
    console.error('❌ No session token provided in URL');
    ws.close(1008, 'Session token required');
    return;
  }

  // Handle browser credential tunnel connection
  if (isTunnelConnection) {
    console.log(`🔐 Browser tunnel connected for session: ${sessionToken.substring(0, 8)}...`);
    activeTunnels.set(sessionToken, ws);

    // Send confirmation
    ws.send(JSON.stringify({
      type: 'tunnel_connected',
      sessionToken: sessionToken.substring(0, 20) + '...'
    }));

    // Handle tunnel disconnection
    ws.on('close', () => {
      console.log(`🔐 Browser tunnel disconnected: ${sessionToken.substring(0, 8)}...`);
      activeTunnels.delete(sessionToken);
    });

    // Handle credential responses from browser
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.type === 'credential_response') {
          console.log(`🔑 Received credentials from browser for session: ${sessionToken.substring(0, 8)}...`);
          // Credentials are handled by pending promise in handleConversationRelay
        }
      } catch (error) {
        console.error('❌ Error parsing tunnel message:', error);
      }
    });

    return; // Don't proceed to ConversationRelay handler
  }

  // Handle Twilio ConversationRelay connection
  console.log(`📞 Twilio connection for session: ${sessionToken.substring(0, 8)}...`);

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

    const responseText = await settingsResponse.text();
    console.log(`📄 Response length: ${responseText.length} bytes`);

    let settingsData;
    try {
      settingsData = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`❌ JSON parse error:`, parseError.message);
      console.error(`   Response text (first 200 chars):`, responseText.substring(0, 200));
      ws.close(1008, 'Invalid settings response from API');
      return;
    }

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
    // Pass credential tunnel function for real-time key retrieval
    // Pass activeTunnels map for streaming events to browser
    await handleConversationRelay(ws, studentConfig, sessionToken, requestCredentialsThroughTunnel, activeTunnels);

  } catch (error) {
    console.error('❌ Error loading student config:', error);
    ws.close(1011, 'Server error');
  }
});

/**
 * Request OpenAI API key through secure credential tunnel
 * @param {string} sessionToken - Student's session token
 * @returns {Promise<string|null>} OpenAI API key or null if tunnel not available
 */
export async function requestCredentialsThroughTunnel(sessionToken) {
  const tunnelWs = activeTunnels.get(sessionToken);

  if (!tunnelWs || tunnelWs.readyState !== 1) { // 1 = OPEN
    console.log(`⚠️  No active tunnel for session: ${sessionToken.substring(0, 8)}...`);
    return null;
  }

  return new Promise((resolve, reject) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const timeout = setTimeout(() => {
      tunnelWs.removeEventListener('message', messageHandler);
      reject(new Error('Credential request timeout - browser may be closed'));
    }, 10000); // 10 second timeout

    const messageHandler = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'credential_response' && data.requestId === requestId) {
          clearTimeout(timeout);
          tunnelWs.removeEventListener('message', messageHandler);
          console.log(`✅ Received OpenAI key from browser tunnel`);
          resolve(data.openaiApiKey);
        }
      } catch (error) {
        // Ignore parse errors
      }
    };

    tunnelWs.addEventListener('message', messageHandler);

    // Send credential request to browser
    console.log(`🔑 Requesting credentials through tunnel for session: ${sessionToken.substring(0, 8)}...`);
    tunnelWs.send(JSON.stringify({
      type: 'credential_request',
      requestId: requestId
    }));
  });
}

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Multi-tenant WebSocket server running on port ${PORT}`);
  console.log(`   WebSocket endpoint: ws://0.0.0.0:${PORT}/ws/{session-token}`);
  console.log(`   Credential tunnel: ws://0.0.0.0:${PORT}/tunnel/{session-token}`);
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
