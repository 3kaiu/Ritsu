//! Ritsu Core — WASM 模块
//!
//! 热路径 Rust 实现，编译为 WASM 被 Node.js 调用：
//! - event_validator: JSON Schema 校验（替代 ajv）
//! - ctx_index: JSONL 行偏移索引（替代全文件扫描）
//! - correlation: correlation_id 原子递增生成器

pub mod event_validator;
pub mod ctx_index;
pub mod correlation;

use wasm_bindgen::prelude::*;

/// 模块版本
#[wasm_bindgen]
pub fn core_version() -> String {
    "3.5.1".to_string()
}
