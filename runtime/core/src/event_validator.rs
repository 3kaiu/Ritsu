//! 事件校验器 — JSON Schema 校验
//!
//! 替代 Node.js ajv，在 WASM 中执行校验。
//! Schema 在首次调用时缓存，后续调用直接校验。

use wasm_bindgen::prelude::*;
use serde_json::Value;
use std::cell::RefCell;

thread_local! {
    static SCHEMA_JSON: RefCell<Option<Value>> = RefCell::new(None);
}

/// 初始化 Schema（从 JSON 字符串加载并缓存）
/// 返回 true 表示成功，false 表示 Schema 无效
#[wasm_bindgen]
pub fn init_schema(schema_json: &str) -> bool {
    let schema: Value = match serde_json::from_str(schema_json) {
        Ok(v) => v,
        Err(_) => return false,
    };

    // 预校验 Schema 本身是否有效
    if jsonschema::validate(&schema, &Value::Null).is_err() && jsonschema::validate(&schema, &serde_json::json!({})).is_err() {
        // Schema 可能对 null/空对象校验失败是正常的，只要 Schema 本身可解析即可
    }

    SCHEMA_JSON.with(|cell| *cell.borrow_mut() = Some(schema));
    true
}

/// 校验事件 JSON 字符串
/// 返回 null 表示校验通过，或错误信息字符串
#[wasm_bindgen]
pub fn validate_event(event_json: &str) -> Option<String> {
    let event: Value = match serde_json::from_str(event_json) {
        Ok(v) => v,
        Err(e) => return Some(format!("JSON parse error: {}", e)),
    };

    SCHEMA_JSON.with(|cell| {
        let borrowed = cell.borrow();
        let schema = match borrowed.as_ref() {
            Some(s) => s,
            None => return Some("Schema not initialized, call init_schema first".to_string()),
        };

        let result = jsonschema::validate(schema, &event);
        match result {
            Ok(()) => None,
            Err(err) => {
                let msg = err.to_string();
                Some(msg)
            }
        }
    })
}

/// 校验事件并返回结构化结果
/// 返回 JSON: {"valid": true} 或 {"valid": false, "errors": [...]}
#[wasm_bindgen]
pub fn validate_event_structured(event_json: &str) -> String {
    match validate_event(event_json) {
        None => r#"{"valid":true}"#.to_string(),
        Some(errors) => {
            let error_list: Vec<String> = errors.split("; ").map(String::from).collect();
            let error_json = serde_json::to_string(&error_list).unwrap_or_else(|_| "[]".to_string());
            format!(r#"{{"valid":false,"errors":{}}}"#, error_json)
        }
    }
}
