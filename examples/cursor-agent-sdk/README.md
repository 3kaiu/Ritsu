# Cursor Agent SDK × Ritsu（可选示例）

非 Ritsu core 依赖。用于在 **Cursor** 上根据 `coordination-sheet` 派发子 Agent。

## 前置

- 已完成 `/r-init` 与 P2 think 产出的 coordination-sheet
- `npm i @cursor/sdk`（消费方项目）
- `CURSOR_API_KEY`

## 运行

```bash
export RITSU_PROJECT_ROOT=/path/to/your/project
node examples/cursor-agent-sdk/demo-cursor-sdk.mjs
```

Claude Code 用户无需此脚本；使用 marketplace Skills + `ritsu_preflight` 即可。
