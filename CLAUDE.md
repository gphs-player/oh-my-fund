# 一个亿小目标 - 基金理财计算器

## 项目概述

个人基金理财管理系统，基于 Python Flask 后端 + 前端 DaisyUI/Tailwind CSS 实现毛玻璃科技感 UI。

## 技术栈

- **后端**: Flask 3.0.0 (页面渲染 + API 接口)
- **前端**: DaisyUI 4.6.0 + Tailwind CSS
- **图表**: Chart.js 4.4.1
- **数据存储**: 服务端 CSV 文件 (市场列表) + 前端内存 (投资数据)

## 项目结构

```
fund-calculator/
├── app.py                 # Flask 入口 (端口 5001)
├── data/
│   ├── markets.csv        # 市场列表 (服务端持久化)
│   ├── investments.csv    # 持仓数据 (服务端持久化，fund_code 为主键)
│   ├── datasources.csv    # 数据源配置
│   └── settings.csv       # 全局设置
├── warehouse/             # 数据仓库层
│   ├── __init__.py
│   ├── cache.py           # FundCache 缓存管理
│   ├── repository.py      # FundRepository 统一入口
│   └── adapters/          # 数据源适配器
│       ├── base.py        # BaseDataSource 基类
│       ├── factory.py     # 工厂方法 + 注册表
│       ├── lixinger.py    # 理杏仁适配器
│       └── tushare.py     # Tushare 适配器
├── templates/
│   ├── index.html         # 主页面模板
│   └── partials/          # 可复用模板片段
├── static/
│   ├── css/
│   │   └── style.css      # 自定义样式 (毛玻璃、霓虹效果)
│   ├── js/
│   │   ├── utils.js       # 工具函数 (CSV、验证、Toast)
│   │   ├── investment.js  # 我的持仓 + 市场管理
│   │   ├── annualized.js  # 年化计算器模块
│   │   ├── compound.js    # 复利计算器模块
│   │   └── settings.js    # 设置页管理
│   └── images/
│       ├── logo.svg       # 渐变色钱袋 Logo
│       ├── favicon.svg    # 网站图标
│       └── background.jpg # 背景图片
└── docs/
    └── plans/             # 设计文档
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 主页面 |
| GET | `/api/markets` | 获取市场列表 |
| POST | `/api/markets` | 保存市场列表 (全量覆盖) |
| GET | `/api/investments` | 获取所有持仓 |
| POST | `/api/investments` | 添加持仓 (fund_code 重复则报错) |
| PUT | `/api/investments/<fund_code>` | 更新持仓 |
| DELETE | `/api/investments/<fund_code>` | 删除持仓 |
| GET | `/api/datasources` | 获取数据源列表 |
| POST | `/api/datasources` | 添加数据源 |
| PUT | `/api/datasources/<id>` | 更新数据源 |
| DELETE | `/api/datasources/<id>` | 删除数据源 |
| GET | `/api/settings` | 获取全局设置 |
| PUT | `/api/settings` | 更新全局设置 |
| GET | `/api/cache/info` | 获取缓存状态 |
| POST | `/api/cache/refresh` | 手动刷新缓存 |

## 功能模块

### 1. 我的持仓
- 基金持仓记录的增删改查（数据持久化到服务端）
- 字段: 基金名称、基金代码(主键)、板块、仓位金额、场内外、市场、风险等级、持有计划
- 按仓位金额/风险等级/持有计划排序
- CSV 导入导出 (带时间戳命名)
- 饼图可视化 (按板块/风险等级/持有计划)
- **市场管理**: 工具栏“管理市场”按钮，可增删市场选项并同步服务端
### 2. 多维选基 (待实现)
- 预留 Tab，内容待开发

### 3. 年化计算器
- 方式一: 持有周期(年) + 总收益率 → 年化收益率
- 方式二: 期初净值 + 持有周期(年) + 期末净值 → 总收益率 + 年化收益率

### 4. 复利计算器
- 多投资项对比 (不同背景色区分)
- 参数: 名称、初始金额、预计年化、年末追加金额
- 默认计算 20 年
- 折线图展示增长曲线 (含汇总线)
- 表格展示每年明细 (金额自动转换为万/亿单位)

### 5. 设置
- 数据源管理: 添加/编辑/删除/激活数据源 (理杏仁、Tushare)
- 缓存设置: 缓存过期时间配置 + 手动刷新

## UI 特点

- 左右布局: Logo + 标题在左，Tab 导航在右
- 流光溢彩标题效果 (shimmer-text)
- 毛玻璃背景 (backdrop-blur)
- 霓虹边框和发光效果
- Material 描边风格 Tab
- 紧凑布局设计
- 渐变色按钮

## 启动方式

```bash
pip install -r requirements.txt
python app.py
# 访问 http://localhost:5001
```

## 部署 (PythonAnywhere)

1. 上传代码到 `/home/<用户名>/fund-calculator`
2. 创建虚拟环境并安装依赖
3. 配置 WSGI 文件:
```python
import sys
import os
project_home = '/home/<用户名>/fund-calculator'
if project_home not in sys.path:
    sys.path.insert(0, project_home)
os.chdir(project_home)
from app import app as application
```

## 开发注意事项

- 持仓数据存储在服务端 `data/investments.csv`，刷新页面不会丢失
- 市场列表存储在服务端 `data/markets.csv`
- 数据源配置存储在 `data/datasources.csv`
- Tab 切换使用 `[data-tab]` 和 `[data-subtab]` 属性选择器区分
- 金额显示使用 `formatMoney()` 自动转换单位
