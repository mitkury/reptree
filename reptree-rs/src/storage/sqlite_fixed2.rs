//! SQLite storage implementation for RepTree

use crate::types::{
    EncodedVertex, MoveVertex, Result, ScanOptions, SetVertexProperty, StorageError, VertexId,
};
use async_trait::async_trait;
use futures::{stream, Stream, StreamExt};
use rusqlite::{params, Connection, OptionalExtension, types::Type};
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

/// SQLite storage implementation for RepTree
#[derive(Clone)]
pub struct SqliteStorage {
    conn: Arc<TokioMutex<Connection>>,
}

impl SqliteStorage {
    /// Create a new SQLite storage instance
    pub async fn new(path: &str) -> Result<Self> {
        let conn = Connection::open(path).map_err(StorageError::Sqlite)?;
        
        // Create tables if they don't exist
        Self::init_schema(&conn)?;
        
        Ok(Self {
            conn: Arc::new(TokioMutex::new(conn)),
        })
    }
    
    /// Initialize the database schema
    fn init_schema(conn: &Connection) -> Result<()> {
        // Vertices table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS rt_vertices (
                id TEXT PRIMARY KEY,
                parent_id TEXT,
                idx INTEGER,
                payload TEXT
            )",
            [],
        )
        .map_err(StorageError::Sqlite)?;
        
        // Index for efficient child lookup
        conn.execute(
            "CREATE INDEX IF NOT EXISTS rt_vertices_parent_idx ON rt_vertices(parent_id, idx)",
            [],
        )
        .map_err(StorageError::Sqlite)?;
        
        // Move operations table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS rt_move_ops (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                peer_id TEXT NOT NULL,
                counter INTEGER NOT NULL,
                target_id TEXT NOT NULL,
                parent_id TEXT,
                timestamp INTEGER NOT NULL
            )",
            [],
        )
        .map_err(StorageError::Sqlite)?;
        
        // Property operations table
        conn.execute(
            "CREATE TABLE IF NOT EXISTS rt_prop_ops (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                peer_id TEXT NOT NULL,
                counter INTEGER NOT NULL,
                target_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                transient INTEGER NOT NULL
            )",
            [],
        )
        .map_err(StorageError::Sqlite)?;
        
        Ok(())
    }
}

#[async_trait]
impl super::VertexStore for SqliteStorage {
    async fn get_vertex(&self, id: &str) -> Result<Option<EncodedVertex>> {
        let id = id.to_string();
        let conn = self.conn.lock().await;
        
        let result = conn
            .query_row(
                "SELECT parent_id, idx, payload FROM rt_vertices WHERE id = ?",
                [&id],
                |row| {
                    let parent_id: Option<String> = row.get(0)?;
                    let idx: i64 = row.get(1)?;
                    let payload: String = row.get(2)?;
                    
                    let properties = match serde_json::from_str(&payload) {
                        Ok(props) => props,
                        Err(_) => return Err(rusqlite::Error::InvalidColumnType(2, "JSON".into(), Type::Text)),
                    };
                    
                    Ok(EncodedVertex {
                        id: id.clone(),
                        parent_id,
                        idx,
                        properties,
                    })
                },
            )
            .optional()
            .map_err(StorageError::Sqlite)?;
        
        Ok(result)
    }
    
    async fn put_vertex(&self, vertex: EncodedVertex) -> Result<()> {
        let conn = self.conn.lock().await;
        
        let payload = serde_json::to_string(&vertex.properties)?;
        
        conn.execute(
            "INSERT OR REPLACE INTO rt_vertices (id, parent_id, idx, payload) VALUES (?, ?, ?, ?)",
            params![vertex.id, vertex.parent_id, vertex.idx, payload],
        )
        .map_err(StorageError::Sqlite)?;
        
        Ok(())
    }
    
    async fn get_children_page(
        &self,
        parent_id: &str,
        after_idx: Option<i64>,
        limit: usize,
    ) -> Result<Vec<(VertexId, i64)>> {
        let conn = self.conn.lock().await;
        
        let mut result = Vec::new();
        
        if let Some(after) = after_idx {
            let mut stmt = conn.prepare(
                "SELECT id, idx FROM rt_vertices 
                WHERE parent_id = ? AND idx > ? 
                ORDER BY idx LIMIT ?",
            )
            .map_err(StorageError::Sqlite)?;
            
            let rows = stmt.query_map(params![parent_id, after, limit as i64], |row| {
                let id: String = row.get(0)?;
                let idx: i64 = row.get(1)?;
                Ok((id, idx))
            })
            .map_err(StorageError::Sqlite)?;
            
            for row in rows {
                result.push(row.map_err(StorageError::Sqlite)?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, idx FROM rt_vertices 
                WHERE parent_id = ? 
                ORDER BY idx LIMIT ?",
            )
            .map_err(StorageError::Sqlite)?;
            
            let rows = stmt.query_map(params![parent_id, limit as i64], |row| {
                let id: String = row.get(0)?;
                let idx: i64 = row.get(1)?;
                Ok((id, idx))
            })
            .map_err(StorageError::Sqlite)?;
            
            for row in rows {
                result.push(row.map_err(StorageError::Sqlite)?);
            }
        }
        
        Ok(result)
    }
}

#[async_trait]
impl super::LogStore<MoveVertex> for SqliteStorage {
    async fn append(&self, op: MoveVertex) -> Result<u64> {
        let conn = self.conn.lock().await;
        
        conn.execute(
            "INSERT INTO rt_move_ops (peer_id, counter, target_id, parent_id, timestamp) 
            VALUES (?, ?, ?, ?, ?)",
            params![
                op.id.peer_id,
                op.id.counter,
                op.target_id,
                op.parent_id,
                op.timestamp
            ],
        )
        .map_err(StorageError::Sqlite)?;
        
        let seq = conn.last_insert_rowid() as u64;
        Ok(seq)
    }
    
    async fn latest_seq(&self) -> Result<u64> {
        let conn = self.conn.lock().await;
        
        let seq: Option<i64> = conn
            .query_row(
                "SELECT MAX(seq) FROM rt_move_ops",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(StorageError::Sqlite)?;
        
        Ok(seq.unwrap_or(0) as u64)
    }
    
    async fn scan_range(&self, opts: ScanOptions) -> Pin<Box<dyn Stream<Item = Result<MoveVertex>> + Send + 'static>> {
        // We'll use a simpler approach that doesn't have borrowing issues
        // First, we'll execute the query and collect all results
        let conn_clone = self.conn.clone();
        
        Box::pin(stream::once(async move {
            let conn = conn_clone.lock().await;
            
            // Build the query based on options
            let mut query = "SELECT seq, peer_id, counter, target_id, parent_id, timestamp FROM rt_move_ops".to_string();
            let mut conditions = Vec::new();
            let mut params = Vec::new();
            
            if let Some(peer_id) = &opts.peer_id {
                conditions.push("peer_id = ?");
                params.push(peer_id.clone());
            }
            
            if let Some(from) = opts.from_seq {
                conditions.push("seq >= ?");
                params.push(from.to_string());
            }
            
            if let Some(to) = opts.to_seq {
                conditions.push("seq <= ?");
                params.push(to.to_string());
            }
            
            if !conditions.is_empty() {
                query.push_str(" WHERE ");
                query.push_str(&conditions.join(" AND "));
            }
            
            query.push_str(" ORDER BY seq");
            if opts.reverse {
                query.push_str(" DESC");
            }
            
            if let Some(limit) = opts.limit {
                query.push_str(" LIMIT ");
                query.push_str(&limit.to_string());
            }
            
            // Execute the query and collect all results
            let mut stmt = match conn.prepare(&query) {
                Ok(stmt) => stmt,
                Err(e) => return stream::iter(vec![Err(StorageError::Sqlite(e).into())]),
            };
            
            let param_refs: Vec<&dyn rusqlite::ToSql> = params
                .iter()
                .map(|p| p as &dyn rusqlite::ToSql)
                .collect();
            
            let rows = match stmt.query(param_refs.as_slice()) {
                Ok(rows) => rows,
                Err(e) => return stream::iter(vec![Err(StorageError::Sqlite(e).into())]),
            };
            
            let mut ops = Vec::new();
            for row_result in rows.mapped(|row| {
                let _seq: i64 = row.get(0)?;
                let peer_id: String = row.get(1)?;
                let counter: i64 = row.get(2)?;
                let target_id: String = row.get(3)?;
                let parent_id: Option<String> = row.get(4)?;
                let timestamp: i64 = row.get(5)?;
                
                Ok(MoveVertex {
                    id: crate::types::OpId::new(peer_id, counter as u64),
                    target_id,
                    parent_id,
                    timestamp: timestamp as u64,
                })
            }) {
                match row_result {
                    Ok(op) => ops.push(Ok(op)),
                    Err(e) => ops.push(Err(StorageError::Sqlite(e).into())),
                }
            }
            
            stream::iter(ops)
        }).flatten())
    }
}

#[async_trait]
impl super::LogStore<SetVertexProperty> for SqliteStorage {
    async fn append(&self, op: SetVertexProperty) -> Result<u64> {
        let conn = self.conn.lock().await;
        
        let value = serde_json::to_string(&op.value)?;
        
        conn.execute(
            "INSERT INTO rt_prop_ops (peer_id, counter, target_id, key, value, transient) 
            VALUES (?, ?, ?, ?, ?, ?)",
            params![
                op.id.peer_id,
                op.id.counter,
                op.target_id,
                op.key,
                value,
                op.transient as i64
            ],
        )
        .map_err(StorageError::Sqlite)?;
        
        let seq = conn.last_insert_rowid() as u64;
        Ok(seq)
    }
    
    async fn latest_seq(&self) -> Result<u64> {
        let conn = self.conn.lock().await;
        
        let seq: Option<i64> = conn
            .query_row(
                "SELECT MAX(seq) FROM rt_prop_ops",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(StorageError::Sqlite)?;
        
        Ok(seq.unwrap_or(0) as u64)
    }
    
    async fn scan_range(&self, opts: ScanOptions) -> Pin<Box<dyn Stream<Item = Result<SetVertexProperty>> + Send + 'static>> {
        // We'll use a simpler approach that doesn't have borrowing issues
        // First, we'll execute the query and collect all results
        let conn_clone = self.conn.clone();
        
        Box::pin(stream::once(async move {
            let conn = conn_clone.lock().await;
            
            // Build the query based on options
            let mut query = "SELECT seq, peer_id, counter, target_id, key, value, transient FROM rt_prop_ops".to_string();
            let mut conditions = Vec::new();
            let mut params = Vec::new();
            
            if let Some(peer_id) = &opts.peer_id {
                conditions.push("peer_id = ?");
                params.push(peer_id.clone());
            }
            
            if let Some(from) = opts.from_seq {
                conditions.push("seq >= ?");
                params.push(from.to_string());
            }
            
            if let Some(to) = opts.to_seq {
                conditions.push("seq <= ?");
                params.push(to.to_string());
            }
            
            if !conditions.is_empty() {
                query.push_str(" WHERE ");
                query.push_str(&conditions.join(" AND "));
            }
            
            query.push_str(" ORDER BY seq");
            if opts.reverse {
                query.push_str(" DESC");
            }
            
            if let Some(limit) = opts.limit {
                query.push_str(" LIMIT ");
                query.push_str(&limit.to_string());
            }
            
            // Execute the query and collect all results
            let mut stmt = match conn.prepare(&query) {
                Ok(stmt) => stmt,
                Err(e) => return stream::iter(vec![Err(StorageError::Sqlite(e).into())]),
            };
            
            let param_refs: Vec<&dyn rusqlite::ToSql> = params
                .iter()
                .map(|p| p as &dyn rusqlite::ToSql)
                .collect();
            
            let rows = match stmt.query(param_refs.as_slice()) {
                Ok(rows) => rows,
                Err(e) => return stream::iter(vec![Err(StorageError::Sqlite(e).into())]),
            };
            
            let mut ops = Vec::new();
            for row_result in rows.mapped(|row| {
                let _seq: i64 = row.get(0)?;
                let peer_id: String = row.get(1)?;
                let counter: i64 = row.get(2)?;
                let target_id: String = row.get(3)?;
                let key: String = row.get(4)?;
                let value_str: String = row.get(5)?;
                let transient: i64 = row.get(6)?;
                
                let value = match serde_json::from_str(&value_str) {
                    Ok(v) => v,
                    Err(_) => return Err(rusqlite::Error::InvalidColumnType(5, "JSON".into(), Type::Text)),
                };
                
                Ok(SetVertexProperty {
                    id: crate::types::OpId::new(peer_id, counter as u64),
                    target_id,
                    key,
                    value,
                    transient: transient != 0,
                })
            }) {
                match row_result {
                    Ok(op) => ops.push(Ok(op)),
                    Err(e) => ops.push(Err(StorageError::Sqlite(e).into())),
                }
            }
            
            stream::iter(ops)
        }).flatten())
    }
}
