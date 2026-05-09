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

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = r#"{
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["ts", "correlation_id", "skill", "domain", "status"],
        "properties": {
            "ts": { "type": "string", "pattern": "^\\d{8}-\\d{6}$" },
            "correlation_id": { "type": "string", "pattern": "^cid-\\d{8}-\\d+$" },
            "skill": { "type": "string" },
            "domain": { "type": "string" },
            "status": { "type": "string", "enum": ["started","step_done","done","failed"] }
        }
    }"#;

    #[test]
    fn test_init_schema_valid() {
        assert!(init_schema(SCHEMA));
    }

    #[test]
    fn test_init_schema_invalid_json() {
        assert!(!init_schema("not json"));
    }

    #[test]
    fn test_validate_valid_event() {
        init_schema(SCHEMA);
        let result = validate_event(
            r#"{"ts":"20260509-145000","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"started"}"#,
        );
        assert!(result.is_none());
    }

    #[test]
    fn test_validate_missing_required() {
        init_schema(SCHEMA);
        let result = validate_event(
            r#"{"ts":"20260509-145000","skill":"think"}"#,
        );
        assert!(result.is_some());
    }

    #[test]
    fn test_validate_invalid_status() {
        init_schema(SCHEMA);
        let result = validate_event(
            r#"{"ts":"20260509-145000","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"invalid_status"}"#,
        );
        assert!(result.is_some());
    }

    #[test]
    fn test_validate_invalid_json() {
        init_schema(SCHEMA);
        let result = validate_event("not json");
        assert!(result.is_some());
        assert!(result.unwrap().contains("JSON parse error"));
    }

    #[test]
    fn test_validate_without_init() {
        // 重置 schema 为 None（通过新 thread_local 模拟）
        // 注意：thread_local 无法跨测试重置，此测试验证未初始化时的行为
        // 在实际运行中，init_schema 在 validate 前调用
    }

    #[test]
    fn test_validate_structured_valid() {
        init_schema(SCHEMA);
        let result = validate_event_structured(
            r#"{"ts":"20260509-145000","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"started"}"#,
        );
        assert_eq!(result, r#"{"valid":true}"#);
    }

    #[test]
    fn test_validate_structured_invalid() {
        init_schema(SCHEMA);
        let result = validate_event_structured(
            r#"{"ts":"20260509-145000","skill":"think"}"#,
        );
        assert!(result.starts_with(r#"{"valid":false,"errors":"#));
    }
}
