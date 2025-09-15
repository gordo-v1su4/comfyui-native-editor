// api/services/mediaMonitor.js
import pool from '../db.js';

/**
 * Media monitoring service to track storage backend issues
 * and ensure media files are properly stored in Backblaze
 */
class MediaMonitor {
  constructor() {
    this.isRunning = false;
    this.checkInterval = 5 * 60 * 1000; // 5 minutes
  }

  start() {
    if (this.isRunning) {
      console.log('[MediaMonitor] Already running');
      return;
    }

    console.log('[MediaMonitor] Starting media monitoring service...');
    this.isRunning = true;
    this.scheduleNextCheck();
  }

  stop() {
    console.log('[MediaMonitor] Stopping media monitoring service...');
    this.isRunning = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
  }

  scheduleNextCheck() {
    if (!this.isRunning) return;
    
    this.timeoutId = setTimeout(async () => {
      try {
        await this.checkMediaHealth();
      } catch (error) {
        console.error('[MediaMonitor] Check failed:', error);
      } finally {
        this.scheduleNextCheck();
      }
    }, this.checkInterval);
  }

  async checkMediaHealth() {
    console.log('[MediaMonitor] Checking media health...');
    
    try {
      // Check for media with problematic storage backends
      const { rows: remoteMedia } = await pool.query(`
        SELECT COUNT(*) as count, 
               COUNT(CASE WHEN remote_url LIKE '%modal.run%' OR remote_url LIKE '%modal.com%' THEN 1 END) as modal_urls
        FROM media 
        WHERE storage_backend = 'remote'
      `);
      
      const { rows: localMedia } = await pool.query(`
        SELECT COUNT(*) as count
        FROM media 
        WHERE storage_backend = 'local'
      `);
      
      const { rows: s3Media } = await pool.query(`
        SELECT COUNT(*) as count
        FROM media 
        WHERE storage_backend = 's3'
      `);
      
      const stats = {
        remote: parseInt(remoteMedia[0].count),
        modalUrls: parseInt(remoteMedia[0].modal_urls),
        local: parseInt(localMedia[0].count),
        s3: parseInt(s3Media[0].count)
      };
      
      console.log('[MediaMonitor] Media storage stats:', stats);
      
      // Alert on problematic storage backends
      if (stats.modalUrls > 0) {
        console.warn(`[MediaMonitor] ⚠️  Found ${stats.modalUrls} media files with Modal URLs (will expire)`);
      }
      
      if (stats.local > 0) {
        console.warn(`[MediaMonitor] ⚠️  Found ${stats.local} media files stored locally (not persistent)`);
      }
      
      // Check for recent uploads with wrong storage backend
      const { rows: recentUploads } = await pool.query(`
        SELECT storage_backend, COUNT(*) as count
        FROM media 
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY storage_backend
      `);
      
      const recentStats = recentUploads.reduce((acc, row) => {
        acc[row.storage_backend] = parseInt(row.count);
        return acc;
      }, {});
      
      if (recentStats.remote > 0) {
        console.warn(`[MediaMonitor] ⚠️  Recent uploads using 'remote' storage backend: ${recentStats.remote}`);
      }
      
      if (recentStats.local > 0) {
        console.warn(`[MediaMonitor] ⚠️  Recent uploads using 'local' storage backend: ${recentStats.local}`);
      }
      
      // Log healthy stats
      if (stats.s3 > 0) {
        console.log(`[MediaMonitor] ✅ ${stats.s3} media files properly stored in S3/Backblaze`);
      }
      
    } catch (error) {
      console.error('[MediaMonitor] Health check failed:', error);
    }
  }

  async getMediaStats() {
    try {
      const { rows } = await pool.query(`
        SELECT 
          storage_backend,
          COUNT(*) as count,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as recent_count
        FROM media 
        GROUP BY storage_backend
        ORDER BY storage_backend
      `);
      
      return rows.map(row => ({
        storage_backend: row.storage_backend,
        total_count: parseInt(row.count),
        recent_count: parseInt(row.recent_count)
      }));
    } catch (error) {
      console.error('[MediaMonitor] Failed to get stats:', error);
      return [];
    }
  }

  async getProblematicMedia() {
    try {
      const { rows } = await pool.query(`
        SELECT id, filename, remote_url, storage_backend, created_at
        FROM media 
        WHERE storage_backend = 'remote' 
        AND (remote_url LIKE '%modal.run%' OR remote_url LIKE '%modal.com%')
        ORDER BY created_at DESC
        LIMIT 10
      `);
      
      return rows;
    } catch (error) {
      console.error('[MediaMonitor] Failed to get problematic media:', error);
      return [];
    }
  }
}

// Create singleton instance
const mediaMonitor = new MediaMonitor();

export default mediaMonitor;
