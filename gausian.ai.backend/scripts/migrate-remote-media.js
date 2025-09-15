#!/usr/bin/env node
/**
 * Migration script to handle media files with storage_backend='remote' pointing to Modal URLs
 * This script will:
 * 1. Identify media files with expired Modal URLs
 * 2. Mark them for cleanup or attempt to migrate them to Backblaze
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://app:app@localhost:5432/app'
});

async function migrateRemoteMedia() {
  console.log('🔄 Starting migration of remote media files...');
  
  try {
    // Find all media with storage_backend='remote' pointing to Modal URLs
    const { rows: remoteMedia } = await pool.query(`
      SELECT id, filename, remote_url, project_id, user_id, created_at
      FROM media 
      WHERE storage_backend = 'remote' 
      AND (remote_url LIKE '%modal.run%' OR remote_url LIKE '%modal.com%')
      ORDER BY created_at DESC
    `);
    
    console.log(`📊 Found ${remoteMedia.length} media files with Modal URLs`);
    
    if (remoteMedia.length === 0) {
      console.log('✅ No remote media files found. Migration complete.');
      return;
    }
    
    // Display the problematic media files
    console.log('\n📋 Media files with Modal URLs:');
    remoteMedia.forEach((media, index) => {
      console.log(`${index + 1}. ${media.filename}`);
      console.log(`   ID: ${media.id}`);
      console.log(`   URL: ${media.remote_url}`);
      console.log(`   Created: ${media.created_at}`);
      console.log('');
    });
    
    // Check if any of these URLs are still accessible
    console.log('🔍 Checking URL accessibility...');
    const accessibleUrls = [];
    const expiredUrls = [];
    
    for (const media of remoteMedia) {
      try {
        const response = await fetch(media.remote_url, { 
          method: 'HEAD',
          timeout: 5000 
        });
        
        if (response.ok) {
          accessibleUrls.push(media);
          console.log(`✅ ${media.filename} - URL still accessible`);
        } else {
          expiredUrls.push(media);
          console.log(`❌ ${media.filename} - URL expired (${response.status})`);
        }
      } catch (error) {
        expiredUrls.push(media);
        console.log(`❌ ${media.filename} - URL unreachable (${error.message})`);
      }
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Accessible URLs: ${accessibleUrls.length}`);
    console.log(`   ❌ Expired URLs: ${expiredUrls.length}`);
    
    // For expired URLs, we can either:
    // 1. Delete them from the database
    // 2. Mark them as expired for manual review
    // 3. Try to find them in Backblaze with a different naming pattern
    
    if (expiredUrls.length > 0) {
      console.log('\n🗑️  Handling expired URLs...');
      
      // Option 1: Delete expired media from database
      const deleteExpired = process.argv.includes('--delete-expired');
      
      if (deleteExpired) {
        console.log('⚠️  Deleting expired media files from database...');
        
        for (const media of expiredUrls) {
          await pool.query('DELETE FROM media WHERE id = $1', [media.id]);
          console.log(`🗑️  Deleted: ${media.filename}`);
        }
        
        console.log(`✅ Deleted ${expiredUrls.length} expired media files`);
      } else {
        console.log('ℹ️  To delete expired media files, run with --delete-expired flag');
        console.log('   Example: node migrate-remote-media.js --delete-expired');
      }
    }
    
    // For accessible URLs, we could attempt to migrate them to Backblaze
    if (accessibleUrls.length > 0) {
      console.log('\n🔄 Accessible URLs found. Consider migrating these to Backblaze:');
      accessibleUrls.forEach(media => {
        console.log(`   - ${media.filename}: ${media.remote_url}`);
      });
      console.log('\n💡 To migrate these files to Backblaze, implement a download-and-reupload process.');
    }
    
    console.log('\n✅ Migration analysis complete!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the migration
if (require.main === module) {
  migrateRemoteMedia().catch(console.error);
}

module.exports = { migrateRemoteMedia };
