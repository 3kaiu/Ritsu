//! ctx 索引 — JSONL 条目摘要索引
//!
//! 替代 Node.js readFileSync + split + JSON.parse 全扫。
//! 维护解析后的条目摘要向量，支持 O(1) 尾部查询和 O(n) 按条件查询。
//!
//! 索引结构：
//! - entries: Vec<EntrySummary> — 解析后的条目摘要（skill/status/step/correlation_id 等）
//!
//! 写入时增量更新索引，查询时直接查索引而非重扫文件。

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EntrySummary {
    correlation_id: Option<String>,
    skill: Option<String>,
    domain: Option<String>,
    status: Option<String>,
    step: Option<String>,
    artifact: Option<String>,
    ts: Option<String>,
}

#[derive(Debug, Default)]
struct CtxIndex {
    entries: Vec<EntrySummary>,
    total_lines: usize,
}

thread_local! {
    static INDEX: RefCell<CtxIndex> = RefCell::new(CtxIndex::default());
}

/// 从 JSONL 内容构建索引（全量重建，用于首次加载或文件变更）
#[wasm_bindgen]
pub fn build_index(jsonl_content: &str) -> usize {
    INDEX.with(|cell| {
        let mut idx = cell.borrow_mut();
        idx.entries.clear();
        idx.total_lines = 0;

        for line in jsonl_content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            idx.total_lines += 1;

            // 解析摘要字段
            let summary: EntrySummary = serde_json::from_str(line).unwrap_or(EntrySummary {
                correlation_id: None,
                skill: None,
                domain: None,
                status: None,
                step: None,
                artifact: None,
                ts: None,
            });
            idx.entries.push(summary);
        }

        idx.total_lines
    })
}

/// 增量追加一条记录到索引
#[wasm_bindgen]
pub fn append_to_index(line_json: &str) -> usize {
    INDEX.with(|cell| {
        let mut idx = cell.borrow_mut();
        idx.total_lines += 1;

        let summary: EntrySummary = serde_json::from_str(line_json).unwrap_or(EntrySummary {
            correlation_id: None,
            skill: None,
            domain: None,
            status: None,
            step: None,
            artifact: None,
            ts: None,
        });
        idx.entries.push(summary);

        idx.total_lines
    })
}

/// 获取最近 N 条记录的摘要（JSON 数组）
#[wasm_bindgen]
pub fn query_recent(limit: usize) -> String {
    INDEX.with(|cell| {
        let idx = cell.borrow();
        let start = if idx.entries.len() > limit {
            idx.entries.len() - limit
        } else {
            0
        };
        let slice = &idx.entries[start..];
        serde_json::to_string(slice).unwrap_or_else(|_| "[]".to_string())
    })
}

/// 查找最后一条未完成任务（last_incomplete）
/// 返回 JSON 对象或 null
#[wasm_bindgen]
pub fn query_last_incomplete() -> String {
    INDEX.with(|cell| {
        let idx = cell.borrow();

        // 收集所有 done/failed 的 correlation_id
        let done_cids: std::collections::HashSet<String> = idx
            .entries
            .iter()
            .filter(|e| e.status.as_deref() == Some("done") || e.status.as_deref() == Some("failed"))
            .filter_map(|e| e.correlation_id.clone())
            .collect();

        // 从后往前找 started 且未完成
        for e in idx.entries.iter().rev() {
            if e.status.as_deref() == Some("started") {
                let cid = e.correlation_id.as_deref().unwrap_or("");
                if !done_cids.contains(cid) {
                    return serde_json::to_string(e).unwrap_or_else(|_| "null".to_string());
                }
            }
        }
        "null".to_string()
    })
}

/// 查找最后一条已完成记录（last_completed）
#[wasm_bindgen]
pub fn query_last_completed() -> String {
    INDEX.with(|cell| {
        let idx = cell.borrow();
        for e in idx.entries.iter().rev() {
            if e.status.as_deref() == Some("done") {
                return serde_json::to_string(e).unwrap_or_else(|_| "null".to_string());
            }
        }
        "null".to_string()
    })
}

/// 查找待审批事件（pending_approvals）
#[wasm_bindgen]
pub fn query_pending_approvals() -> String {
    INDEX.with(|cell| {
        let idx = cell.borrow();
        let pending: Vec<&EntrySummary> = idx
            .entries
            .iter()
            .rev()
            .take(20)
            .filter(|e| e.status.as_deref() == Some("approval_required"))
            .collect();
        serde_json::to_string(&pending).unwrap_or_else(|_| "[]".to_string())
    })
}

/// 获取索引统计
#[wasm_bindgen]
pub fn index_stats() -> String {
    INDEX.with(|cell| {
        let idx = cell.borrow();
        format!(
            r#"{{"total_lines":{},"indexed_entries":{}}}"#,
            idx.total_lines,
            idx.entries.len()
        )
    })
}

/// 重置索引
#[wasm_bindgen]
pub fn reset_index() {
    INDEX.with(|cell| {
        *cell.borrow_mut() = CtxIndex::default();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_jsonl() -> &'static str {
        r#"{"ts":"20260509-145000","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"started","step":"1/4","artifact":null,"progress":null}
{"ts":"20260509-145010","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"step_done","step":"1/4","artifact":null,"progress":null,"duration_ms":500}
{"ts":"20260509-145020","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"step_done","step":"2/4","artifact":null,"progress":null,"duration_ms":1200}
{"ts":"20260509-145040","correlation_id":"cid-20260509-001","skill":"think","domain":"backend","status":"done","step":"4/4","artifact":".ritsu/handoff-auth.md","progress":null,"duration_ms":3200}
{"ts":"20260509-150000","correlation_id":"cid-20260509-002","skill":"dev","domain":"frontend","status":"started","step":"1/3","artifact":null,"progress":null}
{"ts":"20260509-150010","correlation_id":"cid-20260509-002","skill":"dev","domain":"frontend","status":"approval_required","step":"2/3","artifact":null,"progress":null,"approval":{"type":"confirm","title":"确认删除","options":["全部确认","取消"]}}"#
    }

    #[test]
    fn test_build_index() {
        reset_index();
        let count = build_index(sample_jsonl());
        assert_eq!(count, 6);
        reset_index();
    }

    #[test]
    fn test_append_to_index() {
        reset_index();
        build_index(sample_jsonl());
        let new_count = append_to_index(
            r#"{"ts":"20260509-151000","correlation_id":"cid-20260509-003","skill":"review","domain":"backend","status":"started","step":"1/2","artifact":null,"progress":null}"#,
        );
        assert_eq!(new_count, 7);
        reset_index();
    }

    #[test]
    fn test_query_recent() {
        reset_index();
        build_index(sample_jsonl());
        let recent = query_recent(2);
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&recent).unwrap();
        assert_eq!(parsed.len(), 2);
        // 最后一条是 approval_required
        assert_eq!(parsed[1]["status"].as_str().unwrap(), "approval_required");
        reset_index();
    }

    #[test]
    fn test_query_last_incomplete() {
        reset_index();
        build_index(sample_jsonl());
        let result = query_last_incomplete();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        // cid-002 started 但没有 done/failed，应返回
        assert_eq!(parsed["correlation_id"].as_str().unwrap(), "cid-20260509-002");
        assert_eq!(parsed["status"].as_str().unwrap(), "started");
        reset_index();
    }

    #[test]
    fn test_query_last_incomplete_none() {
        reset_index();
        // 只有 done 事件
        build_index(r#"{"ts":"20260509-145000","correlation_id":"cid-001","skill":"think","domain":"backend","status":"started","step":"1/1","artifact":null,"progress":null}
{"ts":"20260509-145010","correlation_id":"cid-001","skill":"think","domain":"backend","status":"done","step":"1/1","artifact":null,"progress":null}"#);
        let result = query_last_incomplete();
        assert_eq!(result, "null");
        reset_index();
    }

    #[test]
    fn test_query_last_completed() {
        reset_index();
        build_index(sample_jsonl());
        let result = query_last_completed();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["status"].as_str().unwrap(), "done");
        assert_eq!(parsed["correlation_id"].as_str().unwrap(), "cid-20260509-001");
        reset_index();
    }

    #[test]
    fn test_query_pending_approvals() {
        reset_index();
        build_index(sample_jsonl());
        let result = query_pending_approvals();
        let parsed: Vec<serde_json::Value> = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["status"].as_str().unwrap(), "approval_required");
        reset_index();
    }

    #[test]
    fn test_index_stats() {
        reset_index();
        build_index(sample_jsonl());
        let stats = index_stats();
        assert!(stats.contains("\"total_lines\":6"));
        assert!(stats.contains("\"indexed_entries\":6"));
        reset_index();
    }

    #[test]
    fn test_build_index_empty_lines() {
        reset_index();
        let count = build_index("\n\n  \n");
        assert_eq!(count, 0);
        reset_index();
    }
}
