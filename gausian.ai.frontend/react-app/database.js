import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Database {
  constructor() {
    this.db = null;
  }

  async init() {
    this.db = new sqlite3.Database(path.resolve(__dirname, "data", "app.db"));

    // Create tables
    await this.createTables();
    console.log("✅ Database initialized");
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      // Users table
      this.db.run(
        `
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `,
        (err) => {
          if (err) {
            reject(err);
            return;
          }

          // Projects table
          this.db.run(
            `
          CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            width INTEGER DEFAULT 1920,
            height INTEGER DEFAULT 1080,
            fps INTEGER DEFAULT 24, -- Locked to 24fps for export
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
          )
        `,
            (err) => {
              if (err) {
                reject(err);
                return;
              }

              // Media table
              this.db.run(
                `
            CREATE TABLE IF NOT EXISTS media (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              project_id TEXT,
              name TEXT NOT NULL,
              type TEXT NOT NULL,
              filename TEXT NOT NULL,
              size INTEGER,
              duration REAL,
              added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
              FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
            )
          `,
                (err) => {
                  if (err) {
                    reject(err);
                    return;
                  }

                  // Timeline items table
                  this.db.run(
                    `
              CREATE TABLE IF NOT EXISTS timeline_items (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                track_index INTEGER DEFAULT 0,
                type TEXT NOT NULL,
                src TEXT NOT NULL,
                from_frame INTEGER DEFAULT 0,
                duration_frames INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
              )
            `,
                    (err) => {
                      if (err) {
                        reject(err);
                      } else {
                        console.log("✅ Database tables created");
                        resolve();
                      }
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  }

  // User operations
  async createUser(userId, username, email, passwordHash) {
    const stmt = await this.db.prepare(
      "INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)"
    );
    await stmt.run(userId, username, email, passwordHash);
    await stmt.finalize();
  }

  async getUserByUsername(username) {
    const stmt = await this.db.prepare(
      "SELECT * FROM users WHERE username = ?"
    );
    const user = await stmt.get(username);
    await stmt.finalize();
    return user;
  }

  async getUserById(userId) {
    const stmt = await this.db.prepare("SELECT * FROM users WHERE id = ?");
    const user = await stmt.get(userId);
    await stmt.finalize();
    return user;
  }

  // Project operations
  async createProject(
    projectId,
    userId,
    name,
    description,
    width,
    height,
    fps
  ) {
    const stmt = await this.db.prepare(
      "INSERT INTO projects (id, user_id, name, description, width, height, fps) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    await stmt.run(projectId, userId, name, description, width, height, fps);
    await stmt.finalize();
  }

  async getProjectsByUserId(userId) {
    const stmt = await this.db.prepare(
      "SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC"
    );
    const projects = await stmt.all(userId);
    await stmt.finalize();
    return projects;
  }

  async getProjectById(projectId, userId) {
    const stmt = await this.db.prepare(
      "SELECT * FROM projects WHERE id = ? AND user_id = ?"
    );
    const project = await stmt.get(projectId, userId);
    await stmt.finalize();
    return project;
  }

  async deleteProject(projectId, userId) {
    const stmt = await this.db.prepare(
      "DELETE FROM projects WHERE id = ? AND user_id = ?"
    );
    const result = await stmt.run(projectId, userId);
    await stmt.finalize();
    return result.changes > 0;
  }

  // Media operations
  async addMedia(
    mediaId,
    userId,
    projectId,
    name,
    type,
    filename,
    size,
    duration
  ) {
    const stmt = await this.db.prepare(
      "INSERT INTO media (id, user_id, project_id, name, type, filename, size, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    await stmt.run(
      mediaId,
      userId,
      projectId,
      name,
      type,
      filename,
      size,
      duration
    );
    await stmt.finalize();
  }

  async getMediaByProjectId(projectId, userId) {
    const stmt = await this.db.prepare(
      "SELECT * FROM media WHERE project_id = ? AND user_id = ? ORDER BY added_at DESC"
    );
    const media = await stmt.all(projectId, userId);
    await stmt.finalize();
    return media;
  }

  async getMediaByUserId(userId) {
    const stmt = await this.db.prepare(
      "SELECT * FROM media WHERE user_id = ? ORDER BY added_at DESC"
    );
    const media = await stmt.all(userId);
    await stmt.finalize();
    return media;
  }

  async deleteMedia(mediaId, userId) {
    const stmt = await this.db.prepare(
      "DELETE FROM media WHERE id = ? AND user_id = ?"
    );
    const result = await stmt.run(mediaId, userId);
    await stmt.finalize();
    return result.changes > 0;
  }

  // Timeline operations
  async addTimelineItem(
    itemId,
    projectId,
    trackIndex,
    type,
    src,
    fromFrame,
    durationFrames
  ) {
    const stmt = await this.db.prepare(
      "INSERT INTO timeline_items (id, project_id, track_index, type, src, from_frame, duration_frames) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    await stmt.run(
      itemId,
      projectId,
      trackIndex,
      type,
      src,
      fromFrame,
      durationFrames
    );
    await stmt.finalize();
  }

  async getTimelineByProjectId(projectId, userId) {
    // First verify the project belongs to the user
    const project = await this.getProjectById(projectId, userId);
    if (!project) return null;

    const stmt = await this.db.prepare(
      "SELECT * FROM timeline_items WHERE project_id = ? ORDER BY track_index, from_frame"
    );
    const items = await stmt.all(projectId);
    await stmt.finalize();

    // Group by track
    const trackMap = new Map();

    items.forEach((item) => {
      if (!trackMap.has(item.track_index)) {
        trackMap.set(item.track_index, {
          name: `Track ${item.track_index + 1}`,
          items: [],
        });
      }
      trackMap.get(item.track_index).items.push({
        id: item.id,
        type: item.type,
        src: item.src,
        from: item.from_frame,
        durationInFrames: item.duration_frames,
      });
    });

    // Ensure at least 3 tracks are always present
    let finalTracks = Array.from(trackMap.values());
    const minTracks = 3;

    // Add default tracks if we have fewer than the minimum
    for (let i = finalTracks.length; i < minTracks; i++) {
      finalTracks.push({
        name: `Track ${i + 1}`,
        items: [],
      });
    }

    return {
      tracks: finalTracks,
      duration: Math.max(
        ...items.map((item) => item.from_frame + item.duration_frames),
        0
      ),
    };
  }

  async deleteTimelineItem(itemId, projectId, userId) {
    // First verify the project belongs to the user
    const project = await this.getProjectById(projectId, userId);
    if (!project) return false;

    const stmt = await this.db.prepare(
      "DELETE FROM timeline_items WHERE id = ? AND project_id = ?"
    );
    const result = await stmt.run(itemId, projectId);
    await stmt.finalize();
    return result.changes > 0;
  }

  async close() {
    if (this.db) {
      await this.db.close();
    }
  }
}

export default Database;
