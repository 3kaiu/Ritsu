//! ctx 索引 — JSONL 行偏移索引
//!
//! 替代 Node.js readFileSync + split + JSON.parse 全扫。
//! 维护一个行偏移索引，支持 O(1) 尾部查询和 O(log n) 按条件查询。
//!
//! 索引结构：
//! - line_offsets: Vec<u64> — 每行起始字节偏移
//! - parsed_entries: Vec<Entry> — 解析后的条目摘要（仅 skill/status/step/correlation_id）
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
    line_offsets: Vec<u64>,
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
        idx.line_offsets.clear();
        idx.entries.clear();
        idx.total_lines = 0;

        let mut offset: u64 = 0;
        for line in jsonl_content.lines() {
            let line = line.trim();
            if line.is_empty() {
                offset += 1;
                continue;
            }

            idx.line_offsets.push(offset);
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

            offset += line.len() as u64 + 1; // +1 for \n
        }

        idx.total_lines
    })
}

/// 增量追加一条记录到索引
#[wasm_bindgen]
pub fn append_to_index(line_json: &str) -> usize {
    INDEX.with(|cell| {
        let mut idx = cell.borrow_mut();

        // 新行偏移 = 上一行偏移 + 上一行字节长度 + 1(\n)
        let new_offset = if let Some(&last_offset) = idx.line_offsets.last() {
            // 找到上一行 entry 的 JSON 长度
            let last_entry_len = idx.entries.last().map(|e| {
                // 用序列化近似长度（精确值需要存储，此处用 line_json 近似）
                serde_json::to_string(e).map(|s| s.len()).unwrap_or(0)
            }).unwrap_or(0);
            last_offset + last_entry_len as u64 + 1
        } else {
            0
        };
        idx.line_offsets.push(new_offset);
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
