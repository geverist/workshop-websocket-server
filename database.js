/**
 * Database Module - Connects to Vercel Postgres
 * Stores and retrieves student configurations
 */

import postgres from 'postgres';

// Connect to Vercel Postgres
const sql = postgres(process.env.POSTGRES_URL, {
  ssl: 'require',
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

/**
 * Get student configuration by session token
 * @param {string} sessionToken - Student's unique session token
 * @returns {Object|null} Student config or null if not found
 */
export async function getStudentConfig(sessionToken) {
  try {
    const result = await sql`
      SELECT
        session_token,
        student_name,
        openai_api_key,
        system_prompt,
        tools,
        voice_settings,
        created_at,
        updated_at
      FROM student_configs
      WHERE session_token = ${sessionToken}
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    const config = result[0];

    // Parse JSON fields (handle both string and object formats)
    let tools = [];
    let voiceSettings = {};

    try {
      tools = typeof config.tools === 'string'
        ? JSON.parse(config.tools)
        : (config.tools || []);
    } catch (e) {
      console.error('Error parsing tools:', e);
      tools = [];
    }

    try {
      voiceSettings = typeof config.voice_settings === 'string'
        ? JSON.parse(config.voice_settings)
        : (config.voice_settings || {});
    } catch (e) {
      console.error('Error parsing voice_settings:', e);
      voiceSettings = {};
    }

    return {
      session_token: config.session_token,
      student_name: config.student_name,
      openai_api_key: config.openai_api_key,
      system_prompt: config.system_prompt,
      tools: tools,
      voice_settings: voiceSettings,
      created_at: config.created_at,
      updated_at: config.updated_at
    };

  } catch (error) {
    console.error('Database error:', error);
    throw error;
  }
}

/**
 * Save or update student configuration
 * @param {string} sessionToken - Student's unique session token
 * @param {Object} config - Configuration object
 */
export async function saveStudentConfig(sessionToken, config) {
  try {
    await sql`
      INSERT INTO student_configs (
        session_token,
        student_name,
        openai_api_key,
        system_prompt,
        tools,
        voice_settings,
        updated_at
      ) VALUES (
        ${sessionToken},
        ${config.student_name || null},
        ${config.openai_api_key || null},
        ${config.system_prompt || null},
        ${JSON.stringify(config.tools || [])},
        ${JSON.stringify(config.voice_settings || {})},
        NOW()
      )
      ON CONFLICT (session_token)
      DO UPDATE SET
        student_name = EXCLUDED.student_name,
        openai_api_key = EXCLUDED.openai_api_key,
        system_prompt = EXCLUDED.system_prompt,
        tools = EXCLUDED.tools,
        voice_settings = EXCLUDED.voice_settings,
        updated_at = NOW()
    `;

    console.log(`✅ Saved config for session: ${sessionToken.substring(0, 8)}...`);
    return true;

  } catch (error) {
    console.error('Database error:', error);
    throw error;
  }
}

/**
 * Initialize database schema
 * Creates the student_configs table if it doesn't exist
 */
export async function initializeDatabase() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS student_configs (
        session_token TEXT PRIMARY KEY,
        student_name TEXT,
        openai_api_key TEXT,
        system_prompt TEXT,
        tools JSONB DEFAULT '[]',
        voice_settings JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    console.log('✅ Database schema initialized');
    return true;

  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}
