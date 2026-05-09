# AI 选基（第 1 步：LLM 解析筛选提示词）Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“AI 选基”子页实现“生成筛选方案”按钮：后端调用 LLM 将用户提示词解析为严格 JSON draft，并在前端展示该 draft（本计划仅实现第 1 步解析，不做能力裁剪与执行筛选）。

**Architecture:** 新增一个后端解析接口（仅做 LLM 调用 + JSON 容错/轻量校验），并在前端 `static/js/ai-pick.js` 里为“AI选基”子页补齐按钮绑定与渲染逻辑。LLM 配置复用现有 `/api/settings`（llm_provider/api_key/model/base_url）。

**Tech Stack:** Flask + 原生 JS；LLM 复用 `warehouse.llm`。

---

## References

- 设计文档：`docs/superpowers/specs/2026-05-09-ai-fund-pick-llm-parse-design.md`
- 现有 AI 分析：`app.py` 中 `/api/funds/<fund_code>/ai-analysis` 与 jobs 相关接口（可参考 LLM 调用方式与错误返回风格）
- 前端入口：`templates/partials/tab-ai-pick.html`（已有“AI选基”骨架）、`static/js/ai-pick.js`（目前仅实现“AI分析”逻辑）

## File map（将被创建/修改）

**Create**
- `warehouse/ai_fund_pick/__init__.py`：模块占位
- `warehouse/ai_fund_pick/prompt.py`：system_prompt/user_message 模板与 few-shot 示例常量
- `warehouse/ai_fund_pick/parser.py`：LLM 调用 + JSON 提取/轻量校验逻辑（返回 draft dict）
- `tests/test_ai_fund_pick_parser.py`：unittest 覆盖 JSON 提取与校验（不做真实 LLM 调用）

**Modify**
- `app.py`：新增解析接口 `POST /api/ai-fund-pick/parse`（命名可微调，但需稳定）
- `static/js/ai-pick.js`：新增“AI选基”子页交互：生成方案/清空/错误展示

> 说明：当前项目无自动化测试。本计划新增 **最小 unittest**，只测“输出清洗/解析/校验”，不引入 pytest，避免改动过大。

---

## Task 1：定义 draft 输出结构与提示词模板（不接入接口）

**Files:**
- Create: `warehouse/ai_fund_pick/prompt.py`

- [ ] **Step 1: 写 prompt 常量（system_prompt + user_message 组装函数）**
  - system_prompt 必须包含：
    - 只输出 JSON（禁止 markdown/解释）
    - 不许编造阈值；无数字表达→`soft_preference`
    - 每条 intent 必须带 `evidence`
    - `op` 枚举集合
    - `between` 形式：`{"min","max"}`
  - few-shot 示例放在同文件中（3 个示例，覆盖：TopN+软偏好、阈值+window、exclude+sort）
  - user_message 组装需包含：
    - “候选集默认全量（universe_default=all）”
    - 用户原文提示词

- [ ] **Step 2: 自检（人工）**
  - 确保 prompt 文本完全中文（除 JSON 关键字/字段名）
  - 确保示例 JSON 严格可解析

- [ ] **Step 3: Commit**
  - `git add warehouse/ai_fund_pick/prompt.py warehouse/ai_fund_pick/__init__.py`
  - `git commit -m "feat(ai-pick): add fund-pick prompt templates"`

---

## Task 2：实现 parser（LLM 调用 + JSON 提取 + 轻量校验）

**Files:**
- Create: `warehouse/ai_fund_pick/parser.py`
- Test: `tests/test_ai_fund_pick_parser.py`

- [ ] **Step 1: 写 failing tests（unittest）**
  - 覆盖点（不依赖真实 LLM）：
    1. 能从“包了 ```json … ```”的文本里提取 JSON
    2. 能从“前后有多余字符”的文本里提取首个 JSON object
    3. 校验顶层必须 object、`intents` 必须 list
    4. intent 最小字段缺失时能给出可读错误（返回结构化 error）
    5. `between` value 必须是 `{min,max}`（否则写入 warnings 或报错，按 spec 选择一条稳定策略）

  运行命令：
  - `python3 -m unittest -v tests/test_ai_fund_pick_parser.py`
  期望：FAIL（因为 parser 还没实现）

- [ ] **Step 2: 实现最小 parser**
  - 对外函数建议：
    - `parse_fund_pick_prompt(prompt: str, llm_config: dict) -> dict`
  - 内部步骤：
    1) 构造 LLM 客户端：复用 `warehouse.llm.create_llm(provider, config)`
    2) 调用 `llm.chat(system_prompt, user_message)`
    3) JSON 提取：优先直接 `json.loads`；失败则尝试：
       - 去除 ```json 包裹
       - 从字符串中定位首个 `{` 与匹配的 `}` 形成子串再 parse（实现一个简单括号计数器）
    4) 轻量结构校验与默认补齐：
       - 缺 `universe`/`warnings`/`notes` → 补默认值（不做能力判断）
       - intent 缺 `missing` → 补 `[]`
       - 对 `op` 不在枚举的：不抛异常，写入顶层 `warnings`
    5) 输出 draft dict（保证可 JSON 序列化）

- [ ] **Step 3: Run tests**
  - `python3 -m unittest -v tests/test_ai_fund_pick_parser.py`
  - 期望：PASS

- [ ] **Step 4: Commit**
  - `git add warehouse/ai_fund_pick/parser.py tests/test_ai_fund_pick_parser.py`
  - `git commit -m "feat(ai-pick): add fund-pick prompt parser with json sanitation"`

---

## Task 3：新增 Flask API（供前端“生成筛选方案”调用）

**Files:**
- Modify: `app.py`

- [ ] **Step 1: 新增接口**
  - `POST /api/ai-fund-pick/parse`
  - Request body：`{ "prompt": "..." }`
  - Response（成功）：
    - `{ "success": true, "draft": <draft_json> }`
  - Response（失败）：
    - `{ "success": false, "message": "..." }` + 合理 HTTP code
  - 行为约束：
    - prompt 为空/过短：400
    - LLM 未配置（settings 缺 provider/api_key）：400（提示去设置页）
    - LLM 调用失败：400（message 透传，但截断长度）
    - 解析失败：400（提示“模型输出格式错误”）

- [ ] **Step 2: 本地手测接口（不依赖前端）**
  - 用 `curl` 或浏览器 devtools 手动发请求，检查：
    - 正常返回 draft
    - settings 缺失时的错误信息
    - prompt 为空时 400

- [ ] **Step 3: Commit**
  - `git add app.py`
  - `git commit -m "feat(ai-pick): add api to parse fund-pick prompt into draft"`

---

## Task 4：前端接入“生成筛选方案”与“清空”

**Files:**
- Modify: `static/js/ai-pick.js`

- [ ] **Step 1: 增加 DOM 绑定**
  - 绑定按钮：
    - `#ai-fund-pick-generate-btn`：点击→调用 `/api/ai-fund-pick/parse`
    - `#ai-fund-pick-reset-btn`：清空 textarea、清空 plan 展示、隐藏 error/result、禁用 run 按钮
  - 状态管理：
    - 生成中按钮置 disabled + loading 文案（沿用你现有 showToast/alert 风格即可）

- [ ] **Step 2: 渲染 draft**
  - 将 `draft` 以 `JSON.stringify(draft, null, 2)` 显示到：
    - `#ai-fund-pick-plan-json`
  - 成功后启用 `#ai-fund-pick-run-btn`（但 run 暂不实现，可提示“下一步实现”或先保持 disabled；二者选其一并固定）

- [ ] **Step 3: 错误展示**
  - 失败时：
    - 显示 `#ai-fund-pick-error`，写入 `#ai-fund-pick-error-text`
    - 保持 plan 区不被污染（或写“（生成失败）”）

- [ ] **Step 4: 手动验证**
  - 首页→AI选基→输入示例提示词→点击生成→能看到 JSON
  - 未配置 LLM 时：提示去设置页
  - 输入空：有错误提示

- [ ] **Step 5: Commit**
  - `git add static/js/ai-pick.js`
  - `git commit -m "feat(ai-pick): wire fund-pick draft generation UI"`

---

## 最终回归（手动）

- [ ] 设置页配置 LLM（已有能力）后，AI选基子页“生成筛选方案”可用
- [ ] 任意提示词都能得到 draft 或明确错误（不出现前端 JS 崩溃）
- [ ] draft 中无阈值表达不会被硬筛化（value 不会被模型编出来）
- [ ] between 的结构固定为 `{min,max}`（或被 warnings 标记）

---

## Assumptions / Defaults

- 候选集默认 `universe.mode="all"`（全量）。
- 本计划仅实现“生成筛选方案”（解析 draft）。`执行筛选`按钮暂不实现或保持禁用（由实现者在 Task 4 固定一种行为并保持一致）。
- 不引入外部测试框架，使用 `unittest` 做最小覆盖。

