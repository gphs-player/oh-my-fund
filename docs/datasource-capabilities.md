# 数据源统一能力接口

## 1. 基金列表：get_fund_list

### 方法签名
`get_fund_list() -> list[dict]`

### 语义
返回“基金代码/名称/类型”的基础库，用于搜索补全、类型展示、以及其他能力的辅助信息。

### 输出字段（约定）
每个元素为 dict，常见字段：
- `fund_code`：基金代码（字符串，5-8 位数字为主）
- `fund_name`：基金名称（字符串）
- `fund_type`：基金类型（字符串，口径由数据源决定；可能为空）

---

## 2. 基金概况 / 基金详情：get_fund_overview（重点）

### 方法签名
`get_fund_overview(fund_code: str) -> dict[str, str] | list[dict]`

### 语义
返回“基金详情（概况）”信息，用于：
- 展示基金详情弹层中的“基金详情”类信息
- 为 AI 分析 / AI 选基提供“规模、成立时间、基金公司、基金经理、业绩比较基准”等可解析维度（具体可解析哪些字段取决于数据源）

### 入参
- `fund_code`：基金编码

### 出参格式
```json
{
  "success": true,
  "fund_code": "160225",
  "items": [
    {
      "section": "JJXQ",
      "section_name": "基金详情",
      "key": "基金规模",
      "label": "基金规模",
      "value": "12.34亿元"
    }
  ]
}
```

其中 `items[]` 的通用字段为：
- `section`：分区标识（例如 `JJXQ`）
- `section_name`：分区名称（例如 “基金详情”）
- `key`：字段 key（同一 section 下可扩展；以实际返回为准）
- `label`：字段展示名（通常为中文；未知字段可能直接等于 key）
- `value`：字段值（字符串；空值统一为 `"--"`）

### 当前实现会输出的 section / section_name 列表

当前 Default 数据源的基金详情优先返回多分区 items（用于详情弹层 5个 Tab）：

| section | section_name | 含义/对应 UI |
|---|---|---|
| JJXQ | 基金详情 | 基金基本概况/基础信息 |
| JDZF | 阶段涨幅 | 阶段涨幅对比 + 同类排名数据 |
| JJGM | 基金规模 | 基金规模序列数据（用于绘图） |
| JJCC | 基金持仓 | 十大持仓/资产配置/行业分布数据（用于绘图） |
| JJJL | 基金经理 | 基金经理任职变更数据（用于渲染表格） |

### 各 section 提供的字段

下面按 `section` 列出**该 section 实际承载的业务字段**（字段路径/结构），用于 AI 选基做结构化解析与筛选。

#### JJXQ（基金详情 / 基础信息）

数据来源：东财 j5 接口 `JJXQ.Datas`（对象）。

下发规则：`JJXQ.Datas` 对象中**出现的所有字段**，都会透传到前端（字段名作为 `key`；值统一转为字符串；空值为 `"--"`）。字段集合不固定，不同基金可能出现不同字段。

字段说明（常用字段，且在当前实现中会优先排序展示；其余字段同样会透传）：

| 字段路径 | 类型 | 说明/含义 |
|---|---|---|
| `JJXQ.Datas.FCODE` | string | 基金代码 |
| `JJXQ.Datas.SHORTNAME` | string | 基金简称 |
| `JJXQ.Datas.ESTABDATE` | string | 成立日期（`YYYY-MM-DD`） |
| `JJXQ.Datas.DWJZ` | string | 单位净值 |
| `JJXQ.Datas.LJJZ` | string | 累计净值 |
| `JJXQ.Datas.SGZT` | string | 申购状态 |
| `JJXQ.Datas.SHZT` | string | 赎回状态 |
| `JJXQ.Datas.RATE` | string | 费率（可能为百分比字符串，如 `0.16%`） |
| `JJXQ.Datas.RISKLEVEL` | string | 风险等级（数值字符串） |
| `JJXQ.Datas.BENCH` | string | 业绩比较基准 |
| `JJXQ.Datas.FTYPE` | string | 基金类型名称（示例：`QDII-混合偏股`） |
| `JJXQ.Datas.FUNDTYPE` | string | 基金类型编码（示例：`007`） |
| `JJXQ.Datas.SOURCERATE` | string | 原费率（可能为百分比字符串） |
| `JJXQ.Datas.MINSG` | string | 最小申购金额 |
| `JJXQ.Datas.MAXSG` | string | 最大申购金额（部分基金存在） |
| `JJXQ.Datas.JJGS` | string | 基金公司名称 |
| `JJXQ.Datas.JJGSID` | string | 基金公司 ID |
| `JJXQ.Datas.FSRQ` | string | 最新净值日期（`YYYY-MM-DD`） |
| `JJXQ.Datas.STDDEV1` | string | 标准差（近 1 年） |
| `JJXQ.Datas.SHARP1` | string | 夏普（近 1 年） |
| `JJXQ.Datas.MAXRETRA1` | string | 最大回撤（近 1 年） |

> 备注：`JJXQ.Datas` 字段非常多；SKILL 建议使用“字段名同义词表 + 缺省兜底”策略（例如优先解析 `BENCH/FTYPE/RISKLEVEL/RATE/ESTABDATE` 等关键维度）。

#### JDZF（阶段涨幅 / 同类对比）

下发规则：数组中每条记录会被展开为多个字段，字段名格式为：`{PERIOD}.{field}`，其中：
- `PERIOD` 取原始记录的 `title`（如 `Z/Y/3Y/6Y/1N/2N/3N/5N/JN/LN`）
- `field` 固定为：`syl/avg/hs300/rank/sc/diff`

字段明细（对每个 PERIOD 都会生成以下 6 个字段）：

| 字段路径（逻辑字段名） | 类型 | 说明/含义 |
|---|---|---|
| `JDZF.{PERIOD}.syl` | string | 本基金该阶段收益率 |
| `JDZF.{PERIOD}.avg` | string | 同类平均收益率 |
| `JDZF.{PERIOD}.hs300` | string | 沪深 300 对比值 |
| `JDZF.{PERIOD}.rank` | string | 同类排名（名次） |
| `JDZF.{PERIOD}.sc` | string | 同类总数（样本数） |
| `JDZF.{PERIOD}.diff` | string | 排名变化（可能为正负数） |

#### JJGM（基金规模 / 规模序列）

下发规则：完整数组会被统一包装为 `payload.Datas[]` 后透传，前端/AI 解析时按下列字段读取。

| 字段路径 | 类型 | 说明/含义 |
|---|---|---|
| `JJGM.Datas[].FSRQ` | string | 报告期/日期（`YYYY-MM-DD`） |
| `JJGM.Datas[].NETNAV` | string | 规模数值（字符串数字） |
| `JJGM.Datas[].CHANGE` | string | 相对上一期变化（字符串数字） |
| `JJGM.Datas[].ISSUM` | string | 标记字段（常见为 `0`） |

#### JJCC（基金持仓 / 资产配置 / 行业分布）

数据来源：优先 `JJCC.Datas`；当 `JJCC.Datas` 缺少可视化所需数据时回退 `JJCCNEW.data`；两者统一包装为 `payload.Datas`（对象）。

| 字段路径 | 类型 | 说明/含义 |
|---|---|---|
| `JJCC.Datas.InverstPosition` | object | 持仓概览 |
| `JJCC.Datas.InverstPosition.fundStocks[]` | array | 股票持仓列表（常用于“十大持仓”） |
| `JJCC.Datas.InverstPosition.fundStocks[].GPDM` | string | 股票代码（可能为数字或字母） |
| `JJCC.Datas.InverstPosition.fundStocks[].GPJC` | string | 股票简称 |
| `JJCC.Datas.InverstPosition.fundStocks[].JZBL` | string | 占净值比例（百分比字符串数字，如 `10.26`） |
| `JJCC.Datas.InverstPosition.fundStocks[].PCTNVCHGTYPE` | string | 持仓变动类型（如 `增持/减持/新增`） |
| `JJCC.Datas.InverstPosition.fundStocks[].PCTNVCHG` | string | 持仓变动幅度（字符串数字，正负皆可能） |
| `JJCC.Datas.InverstPosition.fundStocks[].TEXCH` | string | 交易所标识（部分返回存在） |
| `JJCC.Datas.InverstPosition.fundStocks[].NEWTEXCH` | string | 交易所标识（部分返回存在） |
| `JJCC.Datas.InverstPosition.fundStocks[].ISINVISBL` | string | 是否可见标记（常为 `--`） |
| `JJCC.Datas.InverstPosition.fundStocks[].INDEXCODE` | string | 指数代码（可能为 `--`） |
| `JJCC.Datas.InverstPosition.fundStocks[].INDEXNAME` | string | 指数名称（可能为空/`--`） |
| `JJCC.Datas.InverstPosition.fundStocks[].HOLDCOUNT` | string | 持股数量（部分基金存在，可能为 `--`） |
| `JJCC.Datas.InverstPosition.fundboods[]` | array | 债券持仓列表（可能为空） |
| `JJCC.Datas.InverstPosition.fundfofs[]` | array | 基金持仓列表（可能为空） |
| `JJCC.Datas.InverstPosition.ETFCODE` | string | ETF 代码（部分返回存在） |
| `JJCC.Datas.InverstPosition.ETFSHORTNAME` | string | ETF 简称（部分返回存在） |
| `JJCC.Datas.AssetAllocation` | object | 资产配置（key 为报告期日期字符串） |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[]` | array | 某期资产配置明细（通常仅一条） |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[].FSRQ` | string | 报告期日期 |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[].GP` | string | 股票占比 |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[].ZQ` | string | 债券占比 |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[].HB` | string | 货币/现金占比 |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[].QT` | string | 其他占比 |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[].JJ` | string | 基金占比（部分返回存在） |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[].JZC` | string | 净资产（部分返回存在） |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[].BZDM` | string | 基金代码（部分返回存在） |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[].GP_AVG_BTYPE` | string | 同类平均股票仓位（部分返回存在） |
| `JJCC.Datas.AssetAllocation.{REPORT_DATE}[].JJCHGRT` | string | 仓位变化率（部分返回存在） |
| `JJCC.Datas.SectorAllocation` | object | 行业配置（key 为报告期日期字符串） |
| `JJCC.Datas.SectorAllocation.{REPORT_DATE}[]` | array | 某期行业配置明细 |
| `JJCC.Datas.SectorAllocation.{REPORT_DATE}[].HYMC` | string | 行业名称 |
| `JJCC.Datas.SectorAllocation.{REPORT_DATE}[].ZJZBL` | string | 行业占比 |
| `JJCC.Datas.SectorAllocation.{REPORT_DATE}[].FSRQ` | string | 报告期日期 |
| `JJCC.Datas.SectorAllocation.{REPORT_DATE}[].SZ` | string | 市值/规模（部分返回存在） |

#### JJJL（基金经理 / 任职变更）

数据来源：优先 `JJJL.Datas[]`；为空时回退 `JJJLNEW.Datas[]`；两者统一包装为 `payload.Datas[]`（数组）。

| 字段路径 | 类型 | 说明/含义 |
|---|---|---|
| `JJJL.Datas[]` | array | 基金经理任职记录（可能为历史多段） |
| `JJJL.Datas[].MGRID` | string | 经理 ID（可能多个，用逗号分隔） |
| `JJJL.Datas[].MGRNAME` | string | 经理姓名（可能多个，用逗号分隔） |
| `JJJL.Datas[].FCODE` | string | 基金代码 |
| `JJJL.Datas[].DAYS` | string | 任职天数 |
| `JJJL.Datas[].FEMPDATE` | string | 任职开始日期（`YYYY-MM-DD`） |
| `JJJL.Datas[].LEMPDATE` | string | 任职结束日期（在任可能为 `--`） |
| `JJJL.Datas[].PENAVGROWTH` | string | 任职回报（百分比字符串数字，如 `103.6874`） |
| `JJJL.Datas[].NEWPHOTOURL` | string | 头像 URL（可能多个，用逗号分隔） |
| `JJJL.Datas[].ISINOFFICE` | string | 是否在任标记（可能多个，用逗号分隔） |

### 字段语义与“可用于 AI 选基”的解析建议
由于 `value` 为字符串，AI 选基/分析若要结构化筛选，建议在 SKILL 里制定解析策略：

1) **数值类（规模/费率/份额等）**
- 从 value 中提取数字（支持逗号、百分号、中文单位）
- 常见单位：`亿/万/元/%`
- 示例：`"12.34亿元"` → `scale_yi = 12.34`

2) **日期类（成立日期/更新日期等）**
- 识别 `YYYY-MM-DD` 或 `YYYY/MM/DD`
- 示例：`"2013-01-01"` → `inception_date`

3) **枚举/文本类（基金类型/公司/经理/风险等级等）**
- 直接字符串匹配或包含匹配
- 示例：`基金类型` 包含 “混合/股票/债券/QDII/指数/ETF”等

> 注意：不同数据源字段名可能不完全一致。SKILL 建议使用“字段名同义词表 + 模糊匹配”策略。

---

## 3. 历史净值：get_fund_history

### 方法签名
`get_fund_history(fund_code: str, start_date: str | None = None, end_date: str | None = None) -> list[dict]`

### 语义
返回历史净值序列（通常为全量历史，过滤由上层完成或由数据源支持）。

### 输出字段（项目当前主口径）
每条记录常见字段：
- `date`：`YYYY-MM-DD`
- `unit_nav`：单位净值（float|null）
- `cumulative_nav`：累计净值（float|null）
- `daily_return`：日涨跌幅（float|null，数值为百分比，不带 `%`）

---

## 4. 基金榜/排名分页：get_fund_rank_page

### 方法签名
`get_fund_rank_page(page_num: int = 1, page_size: int = 50, fund_type: int = 0) -> tuple[list[dict], int]`

### 语义
返回基金榜分页数据（项目当前基金榜核心数据源）。

### 入参语义
- `page_num`：页码，从 1 开始
- `page_size`：每页条数（上层通常限制 <= 200）
- `fund_type`：基金类型筛选（项目当前沿用某些枚举；0=全部）

### 输出字段（约定）
- `items`：每项建议至少包含：
  - `fund_code`
  - `fund_name`
  - `percentage`（默认口径：日涨跌幅，float|null）
- `total`：总数（int）

> 某些数据源可能额外提供净值、申购状态等字段，上层可能会补齐 `fund_type_code/fund_type_name`（以最终 HTTP 输出为准）。

### 对应 HTTP API（上层调用）
- `GET /api/funds`：分页返回 `items/total/pageNum/pageSize` 等

---

## 5. 持仓日期列表：get_fund_holding_dates

### 方法签名
`get_fund_holding_dates(fund_code: str) -> list[str]`

### 语义
返回基金披露过的持仓报告日期列表，供上层选择“最近一期/最近 N 期”。

### 输出
- `["YYYY-MM-DD", ...]`

### 对应 HTTP API（上层调用）
- `GET /api/funds/<fund_code>/holdings/dates`
  - 返回 `data: {fund_code, dates}`

---

## 6. 持仓明细：get_fund_holdings

### 方法签名
`get_fund_holdings(fund_code: str, report_date: str) -> dict`

### 语义
返回某个披露期（report_date）的持仓结构化数据，用于：
- AI 分析的持仓指标（股票/债券/现金占比、集中度等）
- AI 选基的持仓过滤（例如“股票占比 < 60%”“前十集中度 < 40%”“持仓包含关键词”等）

### 入参
- `fund_code`：基金代码
- `report_date`：`YYYY-MM-DD`（上层接口要求必填）

### 输出字段（约定，常见口径）
常见字段：
- `report_date`
- `stock_percent` / `bond_percent` / `cash_percent` / `other_percent`：数字或 null
- `stock_list`：数组，元素常见字段：
  - `code`
  - `name`
  - `percent`
- `bond_list`：数组，元素常见字段：
  - `code`
  - `name`
  - `percent`

### 对应 HTTP API（上层调用）
- `GET /api/funds/<fund_code>/holdings?report_date=YYYY-MM-DD`
  - 返回 `data: {fund_code, report_date, ...holdings}`（holdings 会展开）



---

## 关键注意事项

1) `get_fund_overview`（对应 `/api/funds/<code>/overview`）返回的是字符串化字段（`items[]`），SKILL 需要定义：
   - 字段名同义词匹配规则
   - value 数值/日期提取规则
2) 持仓能力是两步：
   - dates → 选择 report_date → holdings
   - SKILL 需定义“取最近一期/最近 N 期”的策略与失败兜底
3) 候选集常来自 `get_fund_rank_page`（对应 `/api/funds` 分页）：
   - 若要全量扫描，SKILL 必须有终止条件与保护阈值（最大请求次数/最大耗时），避免不可控
