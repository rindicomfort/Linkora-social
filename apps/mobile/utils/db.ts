import * as SQLite from "expo-sqlite";
import { Post } from "../components/PostCard";

const db = SQLite.openDatabase("linkora_cache.db");

/**
 * Initializes the database schema and indices.
 */
export function initDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS cached_posts (
          id TEXT PRIMARY KEY,
          author TEXT NOT NULL,
          username TEXT NOT NULL,
          content TEXT NOT NULL,
          tip_total INTEGER NOT NULL,
          timestamp INTEGER NOT NULL,
          like_count INTEGER NOT NULL,
          has_liked INTEGER DEFAULT 0,
          sync_status TEXT NOT NULL, -- 'synced' | 'pending' | 'failed'
          created_at INTEGER NOT NULL
        );`,
        [],
        () => {
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_posts_timestamp ON cached_posts (timestamp DESC);`,
            [],
            () => resolve(),
            (_, err) => {
              reject(err);
              return false;
            }
          );
        },
        (_, err) => {
          reject(err);
          return false;
        }
      );
    });
  });
}

/**
 * Retrieves paginated posts from the local cache.
 */
export function getCachedPosts(limit: number, offset: number): Promise<Post[]> {
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        `SELECT * FROM cached_posts ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
        [limit, offset],
        (_, { rows }) => {
          const posts: Post[] = [];
          for (let i = 0; i < rows.length; i++) {
            const row = rows.item(i);
            posts.push({
              id: row.id,
              author: row.author,
              username: row.username,
              content: row.content,
              tip_total: Number(row.tip_total),
              timestamp: Number(row.timestamp),
              like_count: Number(row.like_count),
              has_liked: row.has_liked === 1,
              sync_status: row.sync_status as "synced" | "pending" | "failed",
            });
          }
          resolve(posts);
        },
        (_, err) => {
          reject(err);
          return false;
        }
      );
    });
  });
}

/**
 * Retrieves a single cached post by ID.
 */
export function getCachedPostById(id: string): Promise<Post | null> {
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        `SELECT * FROM cached_posts WHERE id = ?`,
        [id],
        (_, { rows }) => {
          if (rows.length === 0) {
            resolve(null);
            return;
          }
          const row = rows.item(0);
          resolve({
            id: row.id,
            author: row.author,
            username: row.username,
            content: row.content,
            tip_total: Number(row.tip_total),
            timestamp: Number(row.timestamp),
            like_count: Number(row.like_count),
            has_liked: row.has_liked === 1,
            sync_status: row.sync_status as "synced" | "pending" | "failed",
          });
        },
        (_, err) => {
          reject(err);
          return false;
        }
      );
    });
  });
}

/**
 * Reconciles remote posts with the local cache.
 */
export function reconcilePosts(remotePosts: Post[]): Promise<void> {
  return new Promise((resolve, reject) => {
    db.transaction(
      (tx) => {
        for (const post of remotePosts) {
          tx.executeSql(
            `INSERT INTO cached_posts (id, author, username, content, tip_total, timestamp, like_count, has_liked, sync_status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)
             ON CONFLICT(id) DO UPDATE SET
               tip_total = excluded.tip_total,
               like_count = excluded.like_count,
               has_liked = excluded.has_liked,
               content = excluded.content;`,
            [
              String(post.id),
              post.author,
              post.username || "stellar_user",
              post.content,
              post.tip_total,
              post.timestamp,
              post.like_count,
              post.has_liked ? 1 : 0,
              Math.floor(Date.now() / 1000),
            ]
          );
        }

        if (remotePosts.length > 0) {
          const remoteIds = remotePosts.map((p) => `'${p.id}'`).join(",");
          tx.executeSql(
            `DELETE FROM cached_posts WHERE sync_status = 'synced' AND id NOT IN (${remoteIds})`
          );
        }
      },
      (err) => reject(err),
      () => resolve()
    );
  });
}

/**
 * Inserts an optimistic/pending post.
 */
export function addOptimisticPost(
  author: string,
  content: string,
  username: string
): Promise<string> {
  const localId = `opt_${Date.now()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        `INSERT INTO cached_posts (id, author, username, content, tip_total, timestamp, like_count, has_liked, sync_status, created_at)
         VALUES (?, ?, ?, ?, 0, ?, 0, 0, 'pending', ?)`,
        [localId, author, username, content, timestamp, timestamp],
        () => resolve(localId),
        (_, err) => {
          reject(err);
          return false;
        }
      );
    });
  });
}

/**
 * Updates a pending post's sync status to synced and re-keys its ID.
 */
export async function confirmPendingPost(localId: string, realId: string): Promise<void> {
  const exists = await getCachedPostById(realId);
  return new Promise((resolve, reject) => {
    db.transaction(
      (tx) => {
        if (exists) {
          tx.executeSql(`DELETE FROM cached_posts WHERE id = ?`, [localId]);
        } else {
          tx.executeSql(`UPDATE cached_posts SET id = ?, sync_status = 'synced' WHERE id = ?`, [
            realId,
            localId,
          ]);
        }
      },
      (err) => reject(err),
      () => resolve()
    );
  });
}

/**
 * Marks a pending post as failed.
 */
export function markPendingPostFailed(localId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(`UPDATE cached_posts SET sync_status = 'failed' WHERE id = ?`, [localId]);
      },
      (err) => reject(err),
      () => resolve()
    );
  });
}

/**
 * Returns all pending or failed posts.
 */
export function getPendingPosts(): Promise<Post[]> {
  return new Promise((resolve, reject) => {
    db.transaction((tx) => {
      tx.executeSql(
        `SELECT * FROM cached_posts WHERE sync_status = 'pending' OR sync_status = 'failed'`,
        [],
        (_, { rows }) => {
          const posts: Post[] = [];
          for (let i = 0; i < rows.length; i++) {
            const row = rows.item(i);
            posts.push({
              id: row.id,
              author: row.author,
              username: row.username,
              content: row.content,
              tip_total: Number(row.tip_total),
              timestamp: Number(row.timestamp),
              like_count: Number(row.like_count),
              has_liked: row.has_liked === 1,
              sync_status: row.sync_status as "synced" | "pending" | "failed",
            });
          }
          resolve(posts);
        },
        (_, err) => {
          reject(err);
          return false;
        }
      );
    });
  });
}

/**
 * Evicts old posts to keep the cache lightweight.
 */
export function evictStaleCache(
  maxAgeSeconds: number = 86400 * 7,
  maxRows: number = 100
): Promise<void> {
  return new Promise((resolve, reject) => {
    db.transaction(
      (tx) => {
        const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
        tx.executeSql(`DELETE FROM cached_posts WHERE sync_status = 'synced' AND timestamp < ?`, [
          cutoff,
        ]);
        tx.executeSql(
          `DELETE FROM cached_posts 
           WHERE sync_status = 'synced' 
           AND id NOT IN (
             SELECT id FROM cached_posts 
             WHERE sync_status = 'synced' 
             ORDER BY timestamp DESC 
             LIMIT ?
           )`,
          [maxRows]
        );
      },
      (err) => reject(err),
      () => resolve()
    );
  });
}

/**
 * Deletes a cached post by its ID.
 */
export function deleteCachedPost(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(`DELETE FROM cached_posts WHERE id = ?`, [id]);
      },
      (err) => reject(err),
      () => resolve()
    );
  });
}
