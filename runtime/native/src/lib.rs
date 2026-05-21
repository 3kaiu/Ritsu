use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

mod vector_store;
mod ctx_store;

use vector_store::VectorStore;
use ctx_store::CtxStore;

static STORE: Mutex<Option<VectorStore>> = Mutex::new(None);
static CTX: Mutex<Option<CtxStore>> = Mutex::new(None);

// ─── Vector Store API ────────────────────────────────────────

#[napi(object)]
#[derive(Serialize, Deserialize, Clone)]
pub struct SearchResult {
  pub id: String,
  pub score: f64,
  pub metadata: String,
}

#[napi]
pub fn init_store(db_path: String) -> bool {
  let mut store = STORE.lock().unwrap();
  match VectorStore::new(&db_path) {
    Ok(s) => {
      *store = Some(s);
      true
    }
    Err(e) => {
      eprintln!("[ritsu-native] Failed to init store: {}", e);
      false
    }
  }
}

#[napi]
pub fn close_store() {
  let mut store = STORE.lock().unwrap();
  *store = None;
}

#[napi]
pub fn index_embedding(
  collection: String,
  id: String,
  embedding: Vec<f64>,
  metadata: Option<String>,
) -> bool {
  let store = STORE.lock().unwrap();
  match store.as_ref() {
    Some(s) => s.insert(&collection, &id, &embedding, metadata.as_deref()),
    None => false,
  }
}

#[napi]
pub fn search_similar(
  collection: String,
  query: Vec<f64>,
  top_k: Option<i32>,
) -> Vec<SearchResult> {
  let store = STORE.lock().unwrap();
  match store.as_ref() {
    Some(s) => s.search(&collection, &query, top_k.unwrap_or(10) as usize),
    None => vec![],
  }
}

#[napi]
pub fn remove_embedding(collection: String, id: String) -> bool {
  let store = STORE.lock().unwrap();
  match store.as_ref() {
    Some(s) => s.remove(&collection, &id),
    None => false,
  }
}

// ─── Ctx Store API (Rust-native ctx storage) ─────────────────

#[napi]
pub fn init_ctx_store(db_path: String) -> bool {
  let mut ctx = CTX.lock().unwrap();
  match CtxStore::new(&db_path) {
    Ok(s) => {
      *ctx = Some(s);
      true
    }
    Err(e) => {
      eprintln!("[ritsu-native] Failed to init ctx store: {}", e);
      false
    }
  }
}

#[napi]
pub fn close_ctx_store() {
  let mut ctx = CTX.lock().unwrap();
  *ctx = None;
}

#[napi]
pub fn ctx_insert(event_json: String) -> bool {
  let ctx = CTX.lock().unwrap();
  match ctx.as_ref() {
    Some(s) => s.insert(&event_json),
    None => false,
  }
}

#[napi]
pub fn ctx_query_last_incomplete() -> Option<String> {
  let ctx = CTX.lock().unwrap();
  ctx.as_ref().and_then(|s| s.query_last_incomplete())
}

#[napi]
pub fn ctx_query_last_completed() -> Option<String> {
  let ctx = CTX.lock().unwrap();
  ctx.as_ref().and_then(|s| s.query_last_completed())
}

#[napi]
pub fn ctx_query_recent(limit: i32) -> Vec<String> {
  let ctx = CTX.lock().unwrap();
  match ctx.as_ref() {
    Some(s) => s.query_recent(limit),
    None => vec![],
  }
}

#[napi]
pub fn ctx_query_all(limit: i32) -> Vec<String> {
  let ctx = CTX.lock().unwrap();
  match ctx.as_ref() {
    Some(s) => s.query_all(limit),
    None => vec![],
  }
}

#[napi]
pub fn ctx_count() -> i32 {
  let ctx = CTX.lock().unwrap();
  match ctx.as_ref() {
    Some(s) => s.count() as i32,
    None => 0,
  }
}
