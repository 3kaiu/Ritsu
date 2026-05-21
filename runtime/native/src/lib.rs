use napi_derive::napi;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

mod vector_store;

use vector_store::VectorStore;

static STORE: Mutex<Option<VectorStore>> = Mutex::new(None);

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
