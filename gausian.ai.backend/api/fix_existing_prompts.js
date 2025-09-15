#!/usr/bin/env node

// Script to fix existing media records by updating their metadata with prompt information
// from the generation_prompts table

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://app:app@localhost:5432/app'
});

async function fixExistingPrompts() {
  try {
    console.log('🔍 Finding media records with missing prompt data...');
    
    // Find media records that have null prompts but should have them
    const { rows: mediaRecords } = await pool.query(`
      SELECT id, filename, meta
      FROM media 
      WHERE kind = 'video' 
      AND meta->'generation_settings'->>'prompt' IS NULL
      AND meta->'generation_settings'->>'source' = 'modal_generated'
      ORDER BY created_at DESC
    `);
    
    console.log(`📊 Found ${mediaRecords.length} media records to fix`);
    
    let fixedCount = 0;
    
    for (const media of mediaRecords) {
      // Extract filename prefix using the same logic as the upload endpoint
      const filenamePrefixMatch = media.filename.match(/^(u[a-f0-9\-]+_p[a-f0-9\-]+_g[a-zA-Z0-9]+_s\d+_sf\d+_df\d+_fps\d+)/);
      const filenamePrefix = filenamePrefixMatch ? filenamePrefixMatch[1] : null;
      
      if (!filenamePrefix) {
        console.log(`⚠️  Could not extract filename prefix for: ${media.filename}`);
        continue;
      }
      
      // Look up the generation prompt
      const { rows: promptRows } = await pool.query(`
        SELECT positive_prompt, negative_prompt, seed, width, height, length, fps
        FROM generation_prompts 
        WHERE filename_prefix = $1
        ORDER BY created_at DESC LIMIT 1
      `, [filenamePrefix]);
      
      if (promptRows.length === 0) {
        console.log(`⚠️  No generation prompt found for prefix: ${filenamePrefix}`);
        continue;
      }
      
      const prompt = promptRows[0];
      
      // Update the media record with the prompt data
      const updatedMeta = {
        ...media.meta,
        generation_settings: {
          ...media.meta.generation_settings,
          prompt: prompt.positive_prompt,
          negative_prompt: prompt.negative_prompt,
          seed: prompt.seed,
          resolution: `${prompt.width}x${prompt.height}`,
          duration_frames: prompt.length
        }
      };
      
      await pool.query(`
        UPDATE media 
        SET meta = $1
        WHERE id = $2
      `, [JSON.stringify(updatedMeta), media.id]);
      
      console.log(`✅ Fixed: ${media.filename}`);
      console.log(`   Prompt: ${prompt.positive_prompt.substring(0, 50)}...`);
      fixedCount++;
    }
    
    console.log(`🎉 Successfully fixed ${fixedCount} media records`);
    
  } catch (error) {
    console.error('❌ Error fixing prompts:', error);
  } finally {
    await pool.end();
  }
}

fixExistingPrompts();
