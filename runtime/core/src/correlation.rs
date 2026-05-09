//! correlation_id 原子生成器
//!
//! 格式: cid-{YYYYMMDD}-{seq}
//! seq 为当日递增序号，线程安全原子递增。
//! 替代 Node.js 中的全扫找 max seq。

use wasm_bindgen::prelude::*;
use std::cell::RefCell;
use std::sync::atomic::{AtomicU32, Ordering};

static GLOBAL_SEQ: AtomicU32 = AtomicU32::new(0);

thread_local! {
    static LAST_DATE: RefCell<String> = RefCell::new(String::new());
}

/// 生成下一个 correlation_id
/// date_str: YYYYMMDD 格式
/// base_seq: 从 ctx 文件中扫描到的当日最大 seq（0 表示无历史）
#[wasm_bindgen]
pub fn next_correlation_id(date_str: &str, base_seq: u32) -> String {
    LAST_DATE.with(|cell| {
        let mut last_date = cell.borrow_mut();

        // 日期变更时重置
        if *last_date != date_str {
            *last_date = date_str.to_string();
            // 用 base_seq + 1 作为起点，但确保全局递增
            let current = GLOBAL_SEQ.load(Ordering::SeqCst);
            let start = if base_seq > current { base_seq } else { current };
            GLOBAL_SEQ.store(start, Ordering::SeqCst);
        }

        let seq = GLOBAL_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
        format!("cid-{}-{}", date_str, seq)
    })
}

/// 重置生成器状态（用于测试）
#[wasm_bindgen]
pub fn reset_correlation() {
    GLOBAL_SEQ.store(0, Ordering::SeqCst);
    LAST_DATE.with(|cell| *cell.borrow_mut() = String::new());
}

/// 获取当前 seq 值（不递增）
#[wasm_bindgen]
pub fn current_seq() -> u32 {
    GLOBAL_SEQ.load(Ordering::SeqCst)
}
