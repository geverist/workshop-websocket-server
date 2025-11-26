#!/usr/bin/env node
/**
 * Quick script to check database records
 */

import postgres from 'postgres';

const sql = postgres(process.env.POSTGRES_URL, {
  ssl: 'require',
  max: 1
});

async function checkDatabase() {
  try {
    const results = await sql`
      SELECT
        session_token,
        student_name,
        created_at,
        updated_at
      FROM student_configs
      ORDER BY created_at DESC
      LIMIT 20
    `;

    console.log('📊 Total records:', results.length);
    console.log('\n');

    results.forEach((record, index) => {
      console.log(`${index + 1}. ${record.student_name || 'Unknown'}`);
      console.log(`   Session: ${record.session_token.substring(0, 20)}...`);
      console.log(`   Created: ${record.created_at}`);
      console.log(`   Updated: ${record.updated_at}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Database error:', error);
  } finally {
    await sql.end();
  }
}

checkDatabase();
