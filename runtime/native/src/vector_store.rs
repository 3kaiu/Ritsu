use rusqlite::{params, Connection, Result};
use serde_json;

pub struct VectorStore {
  conn: Connection,
}

impl VectorStore {
  pub fn new(db_path: &str) -> Result<Self> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
      "PRAGMA journal_mode = WAL;
       PRAGMA synchronous = NORMAL;
       CREATE TABLE IF NOT EXISTS vectors (
         id TEXT NOT NULL,
         collection TEXT NOT NULL,
         embedding TEXT NOT NULL,
         metadata TEXT,
         PRIMARY KEY (collection, id)
       );
       CREATE INDEX IF NOT EXISTS idx_vectors_collection ON vectors(collection);",
    )?;
    Ok(Self { conn })
  }

  pub fn insert(
    &self,
    collection: &str,
    id: &str,
    embedding: &[f64],
    metadata: Option<&str>,
  ) -> bool {
    let json = serde_json::to_string(embedding).unwrap_or_default();
    match self.conn.execute(
      "INSERT OR REPLACE INTO vectors (collection, id, embedding, metadata) VALUES (?1, ?2, ?3, ?4)",
      params![collection, id, json, metadata],
    ) {
      Ok(_) => true,
      Err(e) => {
        eprintln!("[ritsu-native] insert error: {}", e);
        false
      }
    }
  }

  pub fn search(
    &self,
    collection: &str,
    query: &[f64],
    top_k: usize,
  ) -> Vec<super::SearchResult> {
    let mut stmt = match self
      .conn
      .prepare("SELECT id, embedding, metadata FROM vectors WHERE collection = ?1")
    {
      Ok(s) => s,
      Err(e) => {
        eprintln!("[ritsu-native] search prepare error: {}", e);
        return vec![];
      }
    };

    let rows = match stmt.query_map(params![collection], |row| {
      let id: String = row.get(0)?;
      let embedding_json: String = row.get(1)?;
      let metadata: Option<String> = row.get(2)?;
      Ok((id, embedding_json, metadata))
    }) {
      Ok(r) => r,
      Err(e) => {
        eprintln!("[ritsu-native] search query error: {}", e);
        return vec![];
      }
    };

    let mut results: Vec<(f64, String, String)> = Vec::new();

    for row in rows {
      if let Ok((id, embedding_json, metadata)) = row {
        if let Ok(emb) = serde_json::from_str::<Vec<f64>>(&embedding_json) {
          let score = cosine_similarity(query, &emb);
          results.push((score, id, metadata.unwrap_or_default()));
        }
      }
    }

    // Sort by descending cosine similarity (higher = more similar)
    results.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(top_k);

    results
      .into_iter()
      .map(|(score, id, metadata)| super::SearchResult {
        id,
        score,
        metadata,
      })
      .collect()
  }

  pub fn remove(&self, collection: &str, id: &str) -> bool {
    match self
      .conn
      .execute("DELETE FROM vectors WHERE collection = ?1 AND id = ?2", params![collection, id])
    {
      Ok(_) => true,
      Err(e) => {
        eprintln!("[ritsu-native] remove error: {}", e);
        false
      }
    }
  }
}

fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
  if a.len() != b.len() || a.is_empty() {
    return 0.0;
  }

  let dot: f64 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
  let norm_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
  let norm_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();

  if norm_a == 0.0 || norm_b == 0.0 {
    return 0.0;
  }

  dot / (norm_a * norm_b)
}
