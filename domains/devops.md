# Domain: DevOps / Infra (运维与基础设施)

> 继承 `_base.md` 全部内容。以下仅声明 DevOps 领域增量。

## 领域增量诊断假设方向
- 配置漂移 (Config Drift) / 环境不一致
- 资源配额耗尽 (CPU/Memory/Disk)
- 网络分区 / DNS 解析失败
- 密钥轮换未生效 / 证书过期

## 领域增量编码纪律
- **IaC 幂等性**：基础设施变更必须可重复执行不产生副作用。
- **最小权限**：ServiceAccount / IAM Role 必须遵循最小权限原则。
- **可观测性**：所有变更必须关联 Metrics / Alerts / Logs。

## 领域增量审查攻击向量
- **密钥泄露**：Terraform/Ansible/Helm values 中是否硬编码了 Secret？
- **破坏性变更**：基础设施变更是否会导致服务中断？是否有蓝绿/金丝雀发布策略？

## 领域增量 PR 合并要求
- 必须提供 **Plan 输出** (terraform plan / helm diff) 或 **变更影响范围说明**
- 检查是否修改了生产环境的配额或安全组

## 纪律-攻击向量对偶映射 (领域增量)
| 编码纪律 (防守) | 审查攻击向量 (测试防守) |
|---|---|
| IaC 幂等性 | 重复 apply 是否产生副作用？ |
| 最小权限 | ServiceAccount 是否有超出必要的权限？ |
| 可观测性 | 变更后是否有对应的 Alert 规则？ |
