---
name: deploy
version: "3.8.0"
description: "Ritsu 部署发布管道。预发布检查 → 部署执行 → 冒烟验证 → 回滚方案。"
when_to_use: "/r-deploy, 部署, 发布, 上线, deploy, release, 推到生产"
complexity_grading: true
context_window_guidance: 6000
total_steps: 5
required_sections: [coding_disciplines]
hard_constraints:
  - id: HC-1
    rule: "部署前必须确认 review PASS 或用户明确跳过审查（风险已知悉）"
    severity: FATAL
  - id: HC-2
    rule: "必须有可执行的回滚方案，禁止无回滚部署"
    severity: FATAL
  - id: HC-3
    rule: "预发布检查未通过时禁止继续部署"
    severity: FATAL
---

# Deploy: 部署发布管道 (Release Pipeline)

**触发条件**：用户输入 `/r-deploy`，或 review PASS 后选择部署。

## 执行流水线

### 1. 领域解析

> 引用 `_shared/skill-common-steps.md` Step 1

### 2. 审查状态确认 (HC-1 执行)

`[Step 1 Complete]` 后进入步骤 2。

调用 **`ritsu_list_artifacts`**（type=review-stamp）获取最近一条审查结论：

- **PASS** → 继续步骤 3
- **FAIL** → 告知用户"最近审查未通过，禁止部署"，建议先执行 `/r-dev` 修复
- **无记录** → 告知用户"未发现 Review Stamp，建议先执行 `/r-review`"。用户确认跳过时继续，在交付摘要注明"无审查溯源（风险已知悉）"

### 3. 预发布检查 (Pre-flight Checklist)

`[Step 2 Complete]` 后进入步骤 3。

**版本一致性检查**：

```
1. 调用 ritsu_exec({command: "grep version package.json"}) 获取版本号
2. 调用 ritsu_get_changed_files 确认无未提交变更（或提示用户先提交）
3. 检查 CHANGELOG/Release Notes 是否包含当前版本条目（无则提示补充）
```

**环境配置验证**：

```
1. 读取 .env.production 或同等生产配置，确认关键变量已设置
2. 确认数据库迁移脚本（如有）已准备且可逆
3. 确认新依赖的 License 合规性（AGPL/SSPL 等需人工确认）
```

**回滚方案确认（HC-2 执行协议）**：

- 必须输出明确的回滚指令，格式：

```
回滚方案：
1. git revert {commit_hash} 或 git reset --hard {previous_tag}
2. 数据库回滚：{迁移脚本路径} --down
3. 重新部署：{部署命令}
4. 验证回滚：{验证命令}
```

- 若无法生成可执行回滚方案 → 停止部署，告知用户"回滚方案不可执行，部署中止"

### 4. 部署执行与冒烟测试

`[Step 3 Complete]` 后进入步骤 4。

**部署执行**：

- 按项目 `AGENTS.md` 中定义的部署命令执行（如 `npm run deploy`、`terraform apply` 等）
- 若 AGENTS.md 未定义部署命令 → 询问用户提供部署方式

**冒烟测试**（部署成功后执行）：

```
1. 调用 ritsu_exec({command: "curl -s -o /dev/null -w '%{http_code}' {health_endpoint}"}) 确认服务可达
2. 验证关键 API 端点返回预期状态码
3. 检查日志无 FATAL/ERROR 级别异常
```

- 冒烟测试失败 → 立即执行步骤 3 确认的回滚方案，并告知用户

### 5. 交付摘要

`[Step 4 Complete]` 后进入步骤 5。

```markdown
## 律 (Ritsu) 部署落盘清单

- 版本: {version}
- 环境: {staging/production}
- 部署方式: {命令}
- Review 溯源: .ritsu/review-stamp-{ts}.md 或 无（风险已知悉）
- 冒烟测试: ✅/❌
- 回滚方案: {已确认/执行中/无需回滚}
```

写入 ctx-{YYYY-MM}.jsonl：

> 引用 `_shared/skill-common-steps.md` Step 2（skill=deploy, artifact=null）

---

## 关联流转

> 引用 `_shared/skill-common-steps.md` Step 3（skill=deploy）
