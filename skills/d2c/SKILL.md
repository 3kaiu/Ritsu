---
name: d2c
version: "1.1.0"
description: "MasterGo 一比一还原。DSL → 脚本编译 → AI 序列化 → 脚本验证。"
when_to_use: "/r-d2c, 还原设计稿, MasterGo 链接"
---

# D2C: MasterGo 设计稿一比一还原

## Step 0: DSL 自动采集 (由 MasterGo URL 触发)
1. 当用户提供 MasterGo 链接（如 `https://mastergo.com/file/...` 或短链）时，首先调用 `mastergo-mcp` 中的 `mcp__getDesignSections`，将链接作为 `shortLink` 参数传入（不要传入 `sectionIndex`）。
2. 得到返回结果中的 `totalSections`、`rootMetadata` 和 `splitContainers` 信息。
3. 立即在下一个 Turn 中 **并行（Parallel）** 发起以下所有工具调用以提高效率：
   - 针对每个 section（`sectionIndex` 从 `0` 到 `totalSections - 1`），调用 `mcp__getDesignSections`（传入 `shortLink` 和 `sectionIndex`）。
   - 调用 `mcp__getDesignSvgs`（传入 `shortLink`）。
   - 调用 `mcp__getDesignTexts` (传入 `shortLink`)。
4. 收集齐所有 data 后，统一送入 `ritsu_d2c_compile` 脚本编译。

## Step 1: 编译 Spec（调脚本，不要自己算）
调用 `ritsu_d2c_compile`：
- 传入：所有 section DSL、root_metadata、split_containers、svgs、texts、styles_map。
- 返回：`d2c-spec.json` 的路径以及环境信息。

禁止自行心算颜色转换、单位换算、布局属性 and 标签。一切必须以 `d2c-spec.json` 为准。

## Step 2: 按 Spec 写代码

读取 `d2c-spec.json`，根据 `nodes` 树层级和 `environment`，为前端代码生成提供 1:1 还原：

### 1. 结构与嵌套关系
- **层级 (Hierarchy)**：严格按照 spec 中的 parent-child 嵌套关系组织 DOM/Component 结构。若某些 `div` 节点已被 tree-shaking 优化删除，则直接渲染其子节点。
- **目标标签 (Tag)**：必须使用 spec 中的 `tag`。
- **ID属性**：每个生成元素必须包含 `data-mg-id` 和 `data-mg-name` 属性（例如 `data-mg-id={node.id}`）。

### 2. 局部组件集成 (Partial Component Integration)
- 若 `environment.isPartialComponent === true`，根节点应使用灵活宽度（`width: 100%`，配合 `max-width` 限制最大宽度，且 `height` 设为 `auto` 或 `min-height`），而不是写死视口（Viewport）宽高，确保其能响应式嵌入已有页面布局中。
- 将布局中的硬编码主题属性（如颜色、边距、字体）映射或抽取为局部/全局 CSS 变量（例如 `var(--primary-color)`），便于人类二次修改和集成。

### 3. 多状态与交互变体 (Interactive States & Variants)
- 当节点中包含 `variants` 属性（如 `hover`, `active`, `disabled`）时，**禁止**将其渲染成多个静态兄弟节点。
- 应该将它们融合成**单个**动态元素，并根据当前项目的技术栈实现交互式状态切换：
  - **CSS/Tailwind 项目**：直接在元素上应用变体前缀，如 `hover:bg-[...]` 或 `disabled:opacity-50`。
  - **JS 状态管理**：使用 React `useState` 或 Vue `ref` 等切换活动类名或行内样式。
  - **表单状态**：对于 `disabled` 状态，确保在标签中绑定真实的 `disabled` 属性，并结合 CSS 优化鼠标指针表现（如 `cursor: not-allowed`）。

### 4. 性能优化：SVG 集中式精灵图 (SVG Sprite)
- 检查 `environment.svgSprites`。若存在，在生成的页面/文件 Body 顶部生成一个不可见的 centralized SVG symbol 容器：
  ```html
  <svg style="display: none;">
    <!-- 这里放置编译出的全部 symbol 定义 -->
    <symbol id="svg-sprite-1" viewBox="0 0 24 24">...</symbol>
  </svg>
  ```
- 任何拥有 `data-mg-svg-sprite` 属性的图标实例节点，不再嵌入长串的 SVG 代码，而是通过 `<use>` 元素极简地进行引用：
  ```html
  <svg class="icon"><use href="#svg-sprite-1" /></svg>
  ```
  这有助于大幅缩减生成的 HTML 文件体积，加快渲染速度。

## Step 3: 验证
修改完代码后，必须调用 `ritsu_dsl_validate` 验证结果：
- 传入：`html_path`（生成的代码文件路径）与 `spec_path`（`d2c-spec.json` 的路径）。
- 返回：`score`、`missing_nodes`、`mismatched_styles`（含修复建议 `suggestion`）。

若 `score` 小于 95，必须仔细查阅 `mismatched_styles` 中的每一项 `suggestion`（修复建议已指明具体的标签修改、Tailwind类添加、层级调整或SVG代码插入），按建议逐个修改代码，直至 `score >= 95`。

## Step 4: 视觉验证（可选）
如果需要进一步检查最终视觉呈现，可以调用 `ritsu_visual_check`。
