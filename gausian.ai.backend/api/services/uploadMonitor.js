// api/services/uploadMonitor.js
import pool from "../db.js";

/**
 * Upload monitoring service to track and retry failed uploads
 */
class UploadMonitor {
  constructor() {
    this.isRunning = false;
    this.checkInterval = 60000; // 1 minute
    this.maxRetries = 5;
    this.retryDelay = 300000; // 5 minutes
  }

  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log("[UPLOAD-MONITOR] Starting upload monitoring service");
    
    // Initial check
    this.checkPendingUploads();
    
    // Set up interval
    this.interval = setInterval(() => {
      this.checkPendingUploads();
    }, this.checkInterval);
  }

  stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
    }
    console.log("[UPLOAD-MONITOR] Stopped upload monitoring service");
  }

  async checkPendingUploads() {
    try {
      // Get pending uploads that need retry
      const { rows } = await pool.query(
        `SELECT * FROM pending_uploads 
         WHERE status = 'pending' 
         AND retry_count < $1
         AND (updated_at < NOW() - INTERVAL '5 minutes' OR updated_at IS NULL)
         ORDER BY created_at ASC
         LIMIT 10`,
        [this.maxRetries]
      );

      if (rows.length === 0) return;

      console.log(`[UPLOAD-MONITOR] Found ${rows.length} pending uploads to retry`);

      for (const upload of rows) {
        await this.retryUpload(upload);
      }

    } catch (error) {
      console.error("[UPLOAD-MONITOR] Error checking pending uploads:", error);
    }
  }

  async retryUpload(upload) {
    try {
      console.log(`[UPLOAD-MONITOR] Retrying upload: ${upload.filename}`);

      // Update retry count
      await pool.query(
        `UPDATE pending_uploads 
         SET retry_count = retry_count + 1, 
             updated_at = NOW(),
             last_error = NULL
         WHERE id = $1`,
        [upload.id]
      );

      // Attempt to upload the file
      const success = await this.attemptUpload(upload);

      if (success) {
        // Mark as completed
        await pool.query(
          `UPDATE pending_uploads 
           SET status = 'completed', 
               updated_at = NOW()
           WHERE id = $1`,
          [upload.id]
        );

        console.log(`[UPLOAD-MONITOR] ✅ Successfully retried upload: ${upload.filename}`);

        // Notify user via WebSocket
        this.notifyUploadSuccess(upload);

      } else {
        // Check if we should give up
        const newRetryCount = upload.retry_count + 1;
        
        if (newRetryCount >= this.maxRetries) {
          await pool.query(
            `UPDATE pending_uploads 
             SET status = 'failed', 
                 updated_at = NOW(),
                 last_error = 'Max retries exceeded'
             WHERE id = $1`,
            [upload.id]
          );

          console.log(`[UPLOAD-MONITOR] ❌ Upload failed permanently: ${upload.filename}`);
          this.notifyUploadFailure(upload);
        } else {
          console.log(`[UPLOAD-MONITOR] Upload retry failed, will try again later: ${upload.filename}`);
        }
      }

    } catch (error) {
      console.error(`[UPLOAD-MONITOR] Error retrying upload ${upload.filename}:`, error);
      
      // Update error status
      await pool.query(
        `UPDATE pending_uploads 
         SET last_error = $1, 
             updated_at = NOW()
         WHERE id = $2`,
        [error.message, upload.id]
      );
    }
  }

  async attemptUpload(upload) {
    try {
      // This would integrate with the Modal retry system
      // For now, we'll simulate the retry logic
      
      const fs = await import('fs');
      const path = await import('path');
      
      // Check if file still exists
      if (!fs.existsSync(upload.path)) {
        console.log(`[UPLOAD-MONITOR] File no longer exists: ${upload.path}`);
        return false;
      }

      // Here you would call the Modal retry endpoint or implement direct upload
      // For now, we'll return false to simulate retry failure
      // In production, this would call the actual upload function
      
      console.log(`[UPLOAD-MONITOR] Attempting to upload file: ${upload.path}`);
      
      // Simulate upload attempt (replace with actual upload logic)
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // For demo purposes, randomly succeed/fail
      const success = Math.random() > 0.3; // 70% success rate
      
      if (success) {
        console.log(`[UPLOAD-MONITOR] Upload attempt successful: ${upload.filename}`);
        return true;
      } else {
        console.log(`[UPLOAD-MONITOR] Upload attempt failed: ${upload.filename}`);
        return false;
      }

    } catch (error) {
      console.error(`[UPLOAD-MONITOR] Upload attempt error:`, error);
      return false;
    }
  }

  notifyUploadSuccess(upload) {
    try {
      if (global.io) {
        // Extract project info from filename
        const match = upload.filename.match(/ua([a-f0-9\-]+)_p([a-f0-9\-]+)_/);
        if (match) {
          const userId = match[1];
          const projectId = match[2];
          
          global.io.to(`project:${projectId}`).emit('upload-status', {
            type: 'success',
            filename: upload.filename,
            message: 'Video successfully uploaded to cloud storage',
            status: 'completed'
          });
        }
      }
    } catch (error) {
      console.error("[UPLOAD-MONITOR] Error notifying upload success:", error);
    }
  }

  notifyUploadFailure(upload) {
    try {
      if (global.io) {
        // Extract project info from filename
        const match = upload.filename.match(/ua([a-f0-9\-]+)_p([a-f0-9\-]+)_/);
        if (match) {
          const userId = match[1];
          const projectId = match[2];
          
          global.io.to(`project:${projectId}`).emit('upload-status', {
            type: 'error',
            filename: upload.filename,
            message: 'Video upload failed after multiple retries. Please contact support.',
            status: 'failed'
          });
        }
      }
    } catch (error) {
      console.error("[UPLOAD-MONITOR] Error notifying upload failure:", error);
    }
  }

  async getUploadStats() {
    try {
      const { rows } = await pool.query(`
        SELECT 
          status,
          COUNT(*) as count,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_duration_seconds
        FROM pending_uploads 
        WHERE created_at > NOW() - INTERVAL '24 hours'
        GROUP BY status
      `);

      return rows;
    } catch (error) {
      console.error("[UPLOAD-MONITOR] Error getting upload stats:", error);
      return [];
    }
  }

  async cleanupOldUploads() {
    try {
      // Clean up uploads older than 7 days
      const { rowCount } = await pool.query(
        `DELETE FROM pending_uploads 
         WHERE created_at < NOW() - INTERVAL '7 days'`
      );

      if (rowCount > 0) {
        console.log(`[UPLOAD-MONITOR] Cleaned up ${rowCount} old upload records`);
      }
    } catch (error) {
      console.error("[UPLOAD-MONITOR] Error cleaning up old uploads:", error);
    }
  }
}

// Create singleton instance
const uploadMonitor = new UploadMonitor();

export { uploadMonitor };
export default uploadMonitor;
