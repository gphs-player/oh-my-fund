# 持仓数据持久化设计

## 背景

当前持仓数据存储在前端内存中，页面刷新后数据丢失。需要实现服务端持久化存储。

## 设计决策

- **使用场景**：个人本地使用
- **存储方式**：服务端 CSV 文件（与 markets.csv、datasources.csv 保持一致）
- **唯一标识**：使用 `fund_code` 作为主键，不再使用 `id`
- **重复处理**：同一基金只允许一条记录，添加重复基金时提示错误
- **加载时机**：页面加载时自动获取

## 文件结构

```
data/
├── markets.csv        # 已有 - 市场列表
├── datasources.csv    # 已有 - 数据源配置
├── settings.csv       # 已有 - 全局设置
└── investments.csv    # 新增 - 持仓数据
```

## CSV 结构

```csv
fund_code,fund_name,sector,position,trade_type,market,risk_level,holding_plan
000001,基金A,科技,10000,场内,A股,高,长期
```

字段说明：
- `fund_code`: 基金代码（主键，5-8位数字）
- `fund_name`: 基金名称
- `sector`: 板块
- `position`: 仓位金额
- `trade_type`: 场内/场外
- `market`: 市场
- `risk_level`: 风险等级（高/中高/中/低）
- `holding_plan`: 持有计划（长期/中期/短期）

## API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/investments` | 获取所有持仓 |
| POST | `/api/investments` | 添加持仓（fund_code 重复则返回错误） |
| PUT | `/api/investments/<fund_code>` | 更新持仓 |
| DELETE | `/api/investments/<fund_code>` | 删除持仓 |

### 响应格式

**GET /api/investments**
```json
[
  {
    "fund_code": "000001",
    "fund_name": "基金A",
    "sector": "科技",
    "position": 10000,
    "trade_type": "场内",
    "market": "A股",
    "risk_level": "高",
    "holding_plan": "长期"
  }
]
```

**POST /api/investments**
- 成功: `{"success": true}`
- 重复: `{"success": false, "error": "该基金已存在"}`

**PUT /api/investments/<fund_code>**
- 成功: `{"success": true}`
- 不存在: `{"success": false, "error": "持仓不存在"}`

**DELETE /api/investments/<fund_code>**
- 成功: `{"success": true}`
- 不存在: `{"success": false, "error": "持仓不存在"}`

## 后端改动

### app.py

新增函数：
- `ensure_investments_file()`: 确保 investments.csv 存在
- `read_investments()`: 读取所有持仓
- `write_investments()`: 写入所有持仓

新增路由：
- `GET /api/investments`
- `POST /api/investments`
- `PUT /api/investments/<fund_code>`
- `DELETE /api/investments/<fund_code>`

## 前端改动

### investment.js

**InvestmentManager 改动**：
- `init()`: 改为异步，调用 `GET /api/investments` 加载数据
- `add()`: 改为异步，调用 `POST /api/investments`
- `update()`: 改为异步，调用 `PUT /api/investments/<fund_code>`
- `delete()`: 改为异步，调用 `DELETE /api/investments/<fund_code>`
- 移除 `Date.now()` 生成 id 的逻辑

**InvestmentUI 改动**：
- 编辑/删除按钮的参数从 `id` 改为 `fund_code`
- `showEditModal(fund_code)`: 参数改为 fund_code
- `confirmDelete(fund_code)`: 参数改为 fund_code
- 表格渲染时使用 `fund_code` 作为标识

## 实现步骤

1. 后端：添加 investments.csv 读写函数
2. 后端：实现 4 个 API 路由
3. 前端：修改 InvestmentManager，改为异步 API 调用
4. 前端：修改 InvestmentUI，使用 fund_code 作为标识
5. 测试：验证增删改查功能正常
