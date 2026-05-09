# 全局状态机 (State Machine)
> Ritsu Bundle 共享协议 v2.1 · 定义技能间的合法流转路径与引导话术。
> 每个技能末尾必须引用此文件，禁止自行编写路由话术。

---

## 合法流转路径

```
[route] ──┬──→ [init]
          ├──→ [think]
          ├──→ [dev]
          ├──→ [hunt]
          ├──→ [review]
          └──→ [triage]

[init]   ──→ [route]（不确定下一步）
         ──→ [think]（新需求）
         ──→ [dev]（有明确任务）

[think]  ──→ [dev]（方案确认）
         ──→ [think]（方案被否决，重新设计，循环允许）

[dev]    ──→ [review]

[review] ──→ [dev]（FAIL，必须修复）
         ──→ [triage]（PASS，有工单待处理，可选）
         ──→ 结束（PASS，无工单，直接合并，可选）

[hunt]   ──→ [dev]（简单修复）
         ──→ [think]（架构级修复）

[triage] ──→ [hunt]（Bug 工单）
         ──→ [think]（Feature 工单）
         ──→ [review]（PR 工单）
         ──→ 结束（关闭/拒绝类工单）
```

> **可选路径**（标注"可选"的，不强制执行，由用户决定）。

---

## 标准引导话术模板

每个技能完成后，**必须从以下模板选取**，禁止自由发挥：

### route 完成
> 🧭 律 (Ritsu) 调度决策：已识别意图，领域已解析。
> 请执行：**`/r-{skill} [...]`**

### init 完成
> ✅ 律 (Ritsu) 初始化完毕，`AGENTS.md` 已生效。
> - 不确定下一步 → **`/r-route`**
> - 构思新特性 → **`/r-think [特性描述]`**
> - 直接开发 → **`/r-dev [需求描述]`**

### think 完成（Phase B 输出后）
> ✅ 律 (Ritsu) Handoff 已写入 `ritsu/handoff-{slug}.md`。
> 确认方案后 → **`/r-dev [执行此 Handoff: ritsu/handoff-{slug}.md]`**
> 方案需修改 → **`/r-think [修改意见]`**（循环允许）

### dev 完成
> ✅ 律 (Ritsu) 编码与自测落盘完毕。
> 进入防腐阶段 → **`/r-review`**

### review PASS
> ✅ 律 (Ritsu) 对抗审查通过，Review Stamp 已写入 `ritsu/review-stamp-{ts}.md`。
> - 有工单待处理 → **`/r-triage`**（可选）
> - 无工单 → 可直接合并

### review FAIL
> ❌ 律 (Ritsu) 拦截成功，Review Stamp 已写入 `ritsu/review-stamp-{ts}.md`。
> 携带 Stamp 修复 → **`/r-dev [修复 review-stamp-{ts}.md 中的问题]`**

### hunt 完成
> ✅ 律 (Ritsu) 根因已锁定，诊断报告已写入 `ritsu/diagnosis-{ts}.md`。
> - 简单修复 → **`/r-dev [依据 diagnosis-{ts}.md 修复]`**
> - 架构级修复 → **`/r-think [设计修复方案]`**

### triage 完成
> ✅ 律 (Ritsu) 工单裁决完毕。
> - Bug 工单 → **`/r-hunt [摘要: {一句话描述} | 复现: {步骤} | 环境: {信息}]`**
> - Feature 工单 → **`/r-think [特性描述]`**
> - PR 工单 → **`/r-review`**
