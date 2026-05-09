# AI 选基：第 1 步（LLM 解析筛选提示词）设计说明

日期：2026-05-09  
范围：**仅覆盖 AI 选基链路的第 1 步：LLM 解析**（把用户提示词抽取为结构化草案 draft），不包含能力裁剪/降级（第 2 步）与执行筛选（第 3 步）。

## 目标

用户在“AI 选基”页面输入一段自然语言筛选提示词后，后端调用 LLM 将其解析为**结构化草案 JSON（draft）**，用于后续：

- 第 2 步：结合数据源 capabilities 做映射、校验、降级与可执行计划生成
- 第 3 步：按计划执行硬筛与打分排序

本步骤 **不做**：

- 不做指标计算（不拉历史净值、不算回撤等）
- 不判断是否可实现（不做 capabilities 决策）
- 不生成最终可执行计划（只输出 draft）

## 关键决策（已确认）

1. **不限制指标范围**：用户写什么就尽可能抽取什么（不限 key 白名单）。
2. `metric_name` 使用**自由中文**（贴近用户原话）。
3. **不许编造阈值**：用户未提供数字/区间/明确真假时，不得生成 hard_filter 的阈值。
4. **无阈值表达一律归类为 `soft_preference`**（例如“回撤小、波动低、股票仓位别太高、尽量分散、偏稳健”等）。
5. 仅当用户给出明确阈值/区间/真假时，才产出 `hard_filter`。
6. `between` 的 value 统一使用对象形式：`{"min": ..., "max": ...}`。
7. LLM 输出必须为**严格 JSON**（禁止 Markdown/解释性文本）。
8. 每条意图必须包含 `evidence`（来自原提示词的原文片段，便于解释与纠错）。
9. `op` 只允许从固定枚举选择（避免不可解析表达）。

## 输入输出

### 输入

- `prompt`：用户原始筛选提示词（字符串）
- 默认前提（写入 user_message）：
  - 候选集默认全量：`universe_default = "all"`（除非用户明确说自选/类型/关键词等）

### 输出（draft JSON）

顶层结构：

```json
{
  "universe": { "mode": "all", "hints": [] },
  "intents": [],
  "notes": "",
  "warnings": []
}
```

`universe`：

- `mode`：`all|favorites|type|search`
- `hints`：数组（可选），用于承载“股票型/指数/ETF/医药主题/关键词”等线索，**不要求可执行**，供第 2 步映射。

`intents[]` 每条字段（必须具备最小可解析性）：

```json
{
  "intent_type": "hard_filter",
  "metric_name": "自由中文",
  "op": "<=",
  "value": null,
  "unit": null,
  "window": null,
  "priority": "high",
  "evidence": "原文片段",
  "missing": []
}
```

字段说明：

- `intent_type`：`hard_filter|soft_preference|sort|limit|include|exclude`
- `metric_name`：自由中文，例如“近一年最大回撤”“股票仓位”“分散”“收益”
- `op`：必须从以下枚举中选择
  - hard_filter：`<=|>=|==|!=|between|in|contains`
  - soft_preference：`maximize|minimize`
  - sort：`rank_desc|rank_asc`
  - limit：`==`
- `value`：
  - hard_filter：
    - 数字阈值：例如 `0.6`、`15`
    - between：`{"min":10,"max":200}`
    - in：数组
    - 用户未给阈值：必须为 `null`（并将此条改为 soft_preference 或写 warnings）
  - soft_preference：通常为 `null`
  - limit：整数（例如 50）
- `unit`：`%|亿|count|年|月|天|...|null`（识别不了填 null）
- `window`：`1m|3m|6m|1y|2y|3y|5y|all|null`
- `priority`：`high|medium|low`
- `evidence`：必须为原提示词中可直接截取的片段
- `missing`：缺失槽位数组，例如 `["value"]`、`["window"]`

## LLM Prompt 约束（模板要点）

### system_prompt 要包含

1) 角色：筛选意图抽取器  
2) 强约束：

- 只输出 JSON
- 不许编造阈值/区间/真假
- 无阈值表达必须产出 soft_preference
- 每条 intent 必须带 evidence
- `op` 必须来自枚举
- 时间窗口只能来自允许集合，识别不了填 null

3) 输出字段与含义（按“输入输出”章节定义）

### user_message 要包含

- 候选集默认全量的前提说明
- 用户原始提示词全文

## Few-shot 示例（建议放 3 个）

示例目标：钉住 JSON 结构、op 枚举、软偏好优先、不编阈值、between 格式。

1) 全量 + TopN + 软偏好（无阈值）  
2) 明确阈值 hard_filter + 时间窗口  
3) include/exclude + 排序倾向 + TopN

（示例 JSON 内容在实现阶段写入 prompt 常量/模板中。）

## 后端最小容错（本步骤仅做格式层面）

- 尝试从输出中提取 JSON（剥离可能的多余前后缀）
- JSON 解析失败：返回“模型输出格式错误”（并截断返回原始输出以便排查）
- 轻量结构校验：顶层为 object、`intents` 为数组、intent 至少包含 `intent_type/metric_name/op/evidence`
- 对 `op` 不在枚举的情况：不报 500，写入 `warnings` 并尽量保留原 intent

## 验收标准

- 任意提示词输入都能返回**可解析 JSON**（失败时给出清晰错误）
- 无数字的偏好不会被错误地转成 hard_filter 阈值
- 每条 intent 有 evidence，便于 UI 展示与纠错
- between 格式固定为 `{"min","max"}`

