# 1 一个亿小目标

个人基金理财计算器：Flask 后端渲染 + 前端业务逻辑，服务端 CSV 持久化（市场、持仓、数据源、设置），支持基金列表缓存、数据源切换、基金基本信息抓取与多维选基详情弹层。

## 1.1 功能概览

### 1.1.1 我的持仓

- 持仓增删改查（`fund_code` 为主键）
- CSV 导入/导出
- 仓位合计与占比计算
- 图表：按板块 / 风险等级 / 持有计划（Chart.js 饼图）
- 市场管理（用于持仓表单下拉）
- 从「多维选基」一键跳转并预填“添加持仓”弹框

### 1.1.2 多维选基

- 进入 Tab 后懒加载基金列表（`/api/funds`）
- 关键字搜索（基金代码/名称）
- 基金类型筛选
- 分页与每页条数切换
- 行内“添加持仓”快捷入口
- 行内“详情”弹层（展示基金基本信息原始键值表）

### 1.1.3 计算器

- 主 Tab 已合并为「计算器」
- 子入口一：年化收益率计算器
  - 方式一：持有周期 + 总收益率 -> 年化
  - 方式二：期初净值 + 期末净值 + 持有周期 -> 总收益率 + 年化
- 子入口二：复利计算器
  - 多投资项对比
  - 折线图 + 明细表格
  - 动态添加/删除投资项

### 1.1.4 设置

- 数据源管理：新增/编辑/删除、启用/停用、测试连接
- 缓存管理：查看缓存状态、设置过期天数、手动刷新基金缓存

## 1.2 技术栈

- 后端：Flask 3.0.0（模板渲染 + API）
- 前端：Tailwind CSS（CDN）+ DaisyUI
- 图表：Chart.js
- 存储：服务端 CSV（`data/` 下文件）

## 1.3 运行

```bash
pip install -r requirements.txt
python3 app.py
```

浏览器访问：`http://localhost:5001`

说明：

- 本机若没有 `python` 命令，使用 `python3`
- 项目没有自动化测试，修改后请按“手动验证清单”自测

## 1.4 数据与持久化

所有数据默认写入项目目录下的 `data/`：

- `data/markets.csv`：市场列表
- `data/investments.csv`：持仓数据（`fund_code` 主键）
- `data/datasources.csv`：数据源配置（`is_active=true` 表示当前启用）
- `data/settings.csv`：全局设置（例如缓存过期天数）
- `data/funds_list_cache_YYYY_MM_DD.csv`：基金列表缓存（自动生成）

## 1.5 数据源与缓存

基金列表由数据仓库层统一提供（`warehouse/`）：

- 默认数据源：东方财富基金列表 + 基本概况（已实现，可直接使用）
- `tushare` / `lixinger`：适配器占位，尚未接入真实 API（调用会报 `NotImplementedError`）
- 缓存：内存 + CSV；是否过期由 `settings.csv` 的 `cache_expire_days` 控制，默认 7 天
- 数据源抽象层强制能力：
  - `get_fund_list()`
  - `get_fund_overview(fund_code)`

### 1.5.1 基金基本信息

- 仓库层统一入口：`FundRepository.get_fund_overview(fund_code)`
- 默认数据源通过东方财富“基本概况”页抓取原始键值表
- 辅助脚本：`tools/extract_fund_overview.py`
- 返回结构为原始键值表，例如：

```json
{
  "基金全称": "...",
  "基金简称": "...",
  "基金代码": "...",
  "基金类型": "..."
}
```

## 1.6 API

### 1.6.1 市场

- `GET /api/markets`：获取市场列表
- `POST /api/markets`：保存市场列表（JSON 数组，全量覆盖）

### 1.6.2 持仓

- `GET /api/investments`：获取所有持仓
- `POST /api/investments`：添加持仓（`fund_code` 重复会报错）
- `PUT /api/investments/<fund_code>`：更新持仓
- `DELETE /api/investments/<fund_code>`：删除持仓

### 1.6.3 数据源

- `GET /api/datasources/types`：获取支持的数据源类型
- `GET /api/datasources`：获取数据源列表（不返回敏感配置）
- `POST /api/datasources`：添加数据源
- `GET /api/datasources/<id>`：获取单个数据源详情（含配置）
- `PUT /api/datasources/<id>`：更新数据源
- `DELETE /api/datasources/<id>`：删除数据源
- `POST /api/datasources/<id>/activate`：激活数据源（自动停用其它）
- `POST /api/datasources/<id>/deactivate`：停用数据源
- `POST /api/datasources/<id>/test`：测试数据源连接

### 1.6.4 设置与缓存

- `GET /api/settings`：获取全局设置
- `PUT /api/settings`：更新全局设置
- `GET /api/cache/info`：获取缓存状态
- `POST /api/cache/refresh`：手动刷新缓存
- `GET /api/funds`：获取基金列表（走缓存逻辑）
- `GET /api/funds/<fund_code>/overview`：获取单只基金基本信息（原始键值表）

## 1.7 前端约定（强制）

所有 JS 模块使用对象字面量模式：

```javascript
const ModuleName = {
    init: function() { /* ... */ }
};
document.addEventListener('DOMContentLoaded', function() { ModuleName.init(); });
```

## 1.8 手动验证清单

- Tab 切换正常（我的持仓 / 多维选基 / 计算器 / 设置）
- 计算器二级入口切换正常（年化计算器 / 复利计算器）
- 持仓新增/编辑/删除正常，重复基金代码会提示错误
- CSV 导入/导出数据完整
- 市场管理（添加/删除/保存）正常，持仓表单市场下拉可用
- 图表正常渲染（持仓饼图、复利折线图）
- 设置页数据源管理与缓存刷新正常
- 多维选基基金详情弹层正常（加载动画 / 双列字段 / 关闭）

## 1.9 备注

仓库内旧文档（例如 `QUICKSTART.md`）可能仍描述 `localStorage` 持久化，以当前代码实现为准。
