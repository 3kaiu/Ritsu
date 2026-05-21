use rusqlite::{params, Connection, Result};
use serde_json;

pub struct CtxStore {
  conn: Connection,
}

impl CtxStore {
  pub fn new(db_path: &str) -> Result<Self> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
      "PRAGMA journal_mode = WAL;
       PRAGMA synchronous = NORMAL;
       CREATE TABLE IF NOT EXISTS events (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         ts TEXT NOT NULL,
         correlation_id TEXT,
         trace_id TEXT,
         span_id TEXT,
         skill TEXT,
         domain TEXT,
         status TEXT NOT NULL,
         step TEXT,
         artifact TEXT,
         data TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
       CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
       CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);
       CREATE INDEX IF NOT EXISTS idx_events_trace_id ON events(trace_id);
       CREATE INDEX IF NOT EXISTS idx_events_skill ON events(skill);",
    )?;
    Ok(Self { conn })
  }

  pub fn insert(&self, event_json: &str) -> bool {
    let event: serde_json::Value = match serde_json::from_str(event_json) {
      Ok(v) => v,
      Err(_) => return false,
    };

    let get_str = |key: &str| -> String {
      event.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
    };

    match self.conn.execute(
      "INSERT INTO events (ts, correlation_id, trace_id, span_id, skill, domain, status, step, artifact, data)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
      params![
        get_str("ts"),
        get_str("correlation_id"),
        get_str("trace_id"),
        get_str("span_id"),
        get_str("skill"),
        get_str("domain"),
        get_str("status"),
        get_str("step"),
        get_str("artifact"),
        event_json,
      ],
    ) {
      Ok(_) => true,
      Err(e) => {
        eprintln!("[ritsu-native] ctx_store insert error: {}", e);
        false
      }
    }
  }

  pub fn query_last_incomplete(&self) -> Option<String> {
    self
      .conn
      .query_row(
        "SELECT data FROM events WHERE status = 'started' ORDER BY id DESC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
      )
      .ok()
  }

  pub fn query_last_completed(&self) -> Option<String> {
    self
      .conn
      .query_row(
        "SELECT data FROM events WHERE status IN ('done', 'failed') ORDER BY id DESC LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
      )
      .ok()
  }

  pub fn query_recent(&self, limit: i32) -> Vec<String> {
    let mut stmt = match self
      .conn
      .prepare("SELECT data FROM events ORDER BY id DESC LIMIT ?1")
    {
      Ok(s) => s,
      Err(_) => return vec![],
    };

    let rows = match stmt.query_map(params![limit], |row| row.get::<_, String>(0)) {
      Ok(r) => r,
      Err(_) => return vec![],
    };

    rows.filter_map(|r| r.ok()).collect()
  }

  pub fn query_all(&self, limit: i32) -> Vec<String> {
    let mut stmt = match self
      .conn
      .prepare("SELECT data FROM events ORDER BY id DESC LIMIT ?1")
    {
      Ok(s) => s,
      Err(_) => return vec![],
    };

    let rows = match stmt.query_map(params![limit], |row| row.get::<_, String>(0)) {
      Ok(r) => r,
      Err(_) => return vec![],
    };

    rows.filter_map(|r| r.ok()).collect()
  }

  pub fn count(&self) -> i64 {
    self
      .conn
      .query_row("SELECT COUNT(*) FROM events", [], |row| row.get::<_, i64>(0))
      .unwrap_or(0)
  }
}
