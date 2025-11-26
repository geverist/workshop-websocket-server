/**
 * ConversationRelay Handler
 * Manages Twilio ConversationRelay WebSocket protocol with student-specific configs
 */

import OpenAI from 'openai';

/**
 * Handle ConversationRelay WebSocket connection
 * @param {WebSocket} ws - WebSocket connection from Twilio
 * @param {Object} studentConfig - Student's configuration from database
 * @param {string} sessionToken - Student's session token
 * @param {Function} requestCredentialsFn - Function to request credentials through tunnel
 */
export async function handleConversationRelay(ws, studentConfig, sessionToken, requestCredentialsFn) {
  console.log(`🎤 Starting ConversationRelay for ${studentConfig.student_name || sessionToken.substring(0, 8)}`);

  // Initialize OpenAI with student's API key
  let openaiApiKey = studentConfig.openai_api_key;

  // If no key in database, try to get it through credential tunnel
  if (!openaiApiKey && requestCredentialsFn) {
    console.log(`   🔑 No stored key - requesting through credential tunnel...`);
    try {
      openaiApiKey = await requestCredentialsFn(sessionToken);
      if (openaiApiKey) {
        console.log(`   ✅ Using student's OpenAI API key (from tunnel)`);
      }
    } catch (error) {
      console.log(`   ⚠️  Tunnel request failed: ${error.message}`);
    }
  }

  // Fall back to instructor's key if tunnel unavailable
  if (!openaiApiKey) {
    openaiApiKey = process.env.OPENAI_API_KEY;
    console.log(`   ⚠️  Using instructor's OpenAI API key (fallback)`);
  } else if (studentConfig.openai_api_key) {
    console.log(`   ✅ Using student's OpenAI API key (from database)`);
  }

  const openai = new OpenAI({
    apiKey: openaiApiKey
  });

  // Store conversation history
  const conversationHistory = [];

  // Store call metadata
  let callMetadata = {
    sessionToken,
    studentName: studentConfig.student_name,
    from: null,
    to: null,
    direction: null,
    callSid: null,
    startTime: new Date().toISOString()
  };

  // Handle incoming messages from Twilio
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        // ----------------------------------------------------------------------
        // Event: SETUP - Initial connection with call metadata
        // ----------------------------------------------------------------------
        case 'setup':
          console.log(`📞 Call Setup for ${studentConfig.student_name}:`);
          console.log(`  Session ID: ${data.sessionId}`);
          console.log(`  Call SID: ${data.callSid}`);
          console.log(`  From: ${data.from}`);
          console.log(`  To: ${data.to}`);

          callMetadata.callSid = data.callSid;
          callMetadata.from = data.from;
          callMetadata.to = data.to;
          callMetadata.direction = data.direction;
          callMetadata.sessionId = data.sessionId;
          break;

        // ----------------------------------------------------------------------
        // Event: PROMPT - Caller spoke, we got their words as TEXT
        // ----------------------------------------------------------------------
        case 'prompt':
          console.log(`🗣️  ${studentConfig.student_name} - Caller said: ${data.voicePrompt}`);

          // Add to conversation history
          conversationHistory.push({
            role: 'user',
            content: data.voicePrompt
          });

          try {
            // Call OpenAI with student's custom system prompt
            const defaultPrompt = `You are a helpful assistant.

# Voice Conversation Guidelines
- Keep responses BRIEF (1-2 sentences max)
- Be conversational and natural
- Avoid lists, bullet points, or structured formatting
- Don't say "as an AI" or mention you're artificial
- If you don't know something, say so briefly
- Respond quickly - every second matters in voice
- Use casual language, contractions, and natural speech patterns

# Response Style
- Short and direct
- Friendly but professional
- Natural and human-like`;

            const messages = [
              {
                role: 'system',
                content: studentConfig.system_prompt || defaultPrompt
              },
              ...conversationHistory
            ];

            // Add tools if student configured them
            const completionParams = {
              model: 'gpt-4o-mini',
              messages: messages,
              max_tokens: 150,
              temperature: 0.7
            };

            if (studentConfig.tools && studentConfig.tools.length > 0) {
              completionParams.tools = studentConfig.tools;
              completionParams.tool_choice = 'auto';
            }

            console.log(`🤖 ${studentConfig.student_name} - Calling OpenAI with ${conversationHistory.length} messages...`);
            const completion = await openai.chat.completions.create(completionParams);
            console.log(`✅ ${studentConfig.student_name} - OpenAI responded successfully`);
            const message = completion.choices[0].message;

            // Handle tool calls if present
            if (message.tool_calls) {
              console.log(`🔧 ${studentConfig.student_name} - AI wants to call tools:`,
                message.tool_calls.map(t => t.function.name));

              // Add assistant message with tool calls to history
              conversationHistory.push(message);

              // Execute tools and add results
              for (const toolCall of message.tool_calls) {
                const toolResult = await executeToolCall(
                  toolCall.function.name,
                  JSON.parse(toolCall.function.arguments),
                  studentConfig
                );

                conversationHistory.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(toolResult)
                });
              }

              // Get final response after tool execution
              const finalCompletion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                  { role: 'system', content: studentConfig.system_prompt },
                  ...conversationHistory
                ],
                max_tokens: 150,
                temperature: 0.7
              });

              const aiResponse = finalCompletion.choices[0].message.content;
              console.log(`🤖 ${studentConfig.student_name} - AI (after tools): ${aiResponse}`);

              conversationHistory.push({
                role: 'assistant',
                content: aiResponse
              });

              // Send response to Twilio
              ws.send(JSON.stringify({
                type: 'text',
                token: aiResponse,
                last: true
              }));

            } else {
              // No tool calls, just respond
              const aiResponse = message.content;
              console.log(`🤖 ${studentConfig.student_name} - AI: ${aiResponse}`);

              conversationHistory.push({
                role: 'assistant',
                content: aiResponse
              });

              // Send response to Twilio
              ws.send(JSON.stringify({
                type: 'text',
                token: aiResponse,
                last: true
              }));
            }

          } catch (aiError) {
            console.error(`❌ ${studentConfig.student_name} - OpenAI error:`, aiError.message);
            console.error(`   Error details:`, aiError);
            console.error(`   API Key exists:`, !!studentConfig.openai_api_key);
            console.error(`   API Key starts with:`, studentConfig.openai_api_key?.substring(0, 10));

            ws.send(JSON.stringify({
              type: 'text',
              token: 'I apologize, I encountered an error processing your request.',
              last: true
            }));
          }
          break;

        // ----------------------------------------------------------------------
        // Event: DTMF - Caller pressed a keypad button
        // ----------------------------------------------------------------------
        case 'dtmf':
          console.log(`🔢 ${studentConfig.student_name} - DTMF: ${data.digit}`);
          // Student can configure DTMF handling in their tools
          break;

        // ----------------------------------------------------------------------
        // Event: INTERRUPT - Caller interrupted the AI mid-sentence
        // ----------------------------------------------------------------------
        case 'interrupt':
          console.log(`⚠️  ${studentConfig.student_name} - Interrupted at: ${data.utteranceUntilInterrupt}`);
          break;

        default:
          console.log(`❓ ${studentConfig.student_name} - Unknown event: ${data.type}`);
      }

    } catch (error) {
      console.error(`❌ ${studentConfig.student_name} - Error parsing message:`, error);
    }
  });

  // Handle connection close
  ws.on('close', () => {
    console.log(`📞 ${studentConfig.student_name} - ConversationRelay disconnected`);
    console.log(`   Call duration: ${Math.round((Date.now() - new Date(callMetadata.startTime)) / 1000)}s`);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`❌ ${studentConfig.student_name} - WebSocket error:`, error.message);
  });
}

/**
 * Execute a tool call
 * @param {string} toolName - Name of the tool
 * @param {Object} args - Tool arguments
 * @param {Object} studentConfig - Student configuration
 */
async function executeToolCall(toolName, args, studentConfig) {
  console.log(`🔧 Executing tool: ${toolName}`, args);

  // Tool execution logic would go here
  // For now, return a placeholder
  return {
    success: true,
    message: `Tool ${toolName} executed with args: ${JSON.stringify(args)}`
  };
}
