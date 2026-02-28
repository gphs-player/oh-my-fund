# 数据仓库层设计文档

## 概述

设计一个数据仓库层，用于桥接多个数据源 API，提供统一的数据访问接口，支持本地缓存以提高稳定性。

### 设计目标

1. **多数据源可切换** — 支持理杏仁、Tushare 等数据源，通过配置切换
2. **本地缓存** — 内存 + CSV 两级缓存，减少 API 调用
3. **前端可配置** — 设置页面管理数据源、缓存策略

---

## 整体架构

```
┌─────────────────────────────────────────────────────┐
│                   应用层 (Flask API)                 │
│                     /api/funds                      │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│                 数据仓库层 (DataWarehouse)            │
│  ┌─────────────────────────────────────────────┐   │
│  │            FundRepository                    │   │
│  │  - get_fund_list() -> 统一接口               │   │
│  │  - refresh() -> 强制刷新                     │   │
│  └─────────────────────┬───────────────────────┘   │
│                        │                            │
│  ┌─────────┬───────────┼───────────┐               │
│  ▼         ▼           ▼           ▼               │
│ 内存     CSV缓存     理杏仁      Tushare           │
│ Cache    (本地)    DataSource  DataSource          │
│  L1        L2          └─────┬─────┘               │
│                              L3                     │
│                        (配置选择其一)                │
└─────────────────────────────────────────────────────┘
```

---

## 文件结构

```
fund-calculator/
├── warehouse/
│   ├── __init__.py
│   ├── cache.py              # 缓存管理 (FundCache)
│   ├── repository.py         # 统一入口 (FundRepository)
│   └── adapters/
│       ├── __init__.py
│       ├── base.py           # 基类 (BaseDataSource)
│       ├── factory.py        # 工厂方法 (create_datasource)
│       ├── lixinger.py       # 理杏仁 (LixingerDataSource)
│       └── tushare.py        # Tushare (TushareDataSource)
├── data/
│   ├── markets.csv                       # (已有)
│   ├── datasources.csv                   # 数据源配置
│   ├── settings.csv                      # 全局设置
│   └── funds_list_cache_yyyy_MM_dd.csv   # 基金列表缓存（按日期命名）
├── app.py                    # Flask API
├── templates/
│   └── index.html            # 新增设置 Tab
└── static/js/
    └── settings.js           # 设置页 JS 模块
```

---

## 数据存储

### datasources.csv

数据源配置，支持多个数据源，只有一个激活。

```csv
id,name,type,config,is_active
1,我的理杏仁,lixinger,"{""token"":""xxx""}",true
2,我的Tushare,tushare,"{""username"":""xxx"",""password"":""xxx""}",false
```

| 字段 | 说明 |
|------|------|
| id | 唯一标识 |
| name | 用户自定义名称 |
| type | 数据源类型 (lixinger / tushare) |
| config | JSON 格式的认证配置 |
| is_active | 是否激活 (true/false)，只有一个为 true |

### settings.csv

全局设置。

```csv
key,value
cache_expire_days,7
```

### funds_list_cache_yyyy_MM_dd.csv

基金列表缓存，文件名包含日期用于过期判断。

```csv
fund_code,fund_name
000001,华夏成长混合
510300,沪深300ETF
```

---

## API 设计

### 数据源管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/datasources` | 获取所有数据源 |
| GET | `/api/datasources/types` | 获取支持的数据源类型及配置字段 |
| POST | `/api/datasources` | 添加数据源 |
| PUT | `/api/datasources/<id>` | 编辑数据源 |
| DELETE | `/api/datasources/<id>` | 删除数据源 |
| POST | `/api/datasources/<id>/activate` | 激活（自动停用其他） |
| POST | `/api/datasources/<id>/deactivate` | 停用 |
| POST | `/api/datasources/<id>/test` | 测试连接（调用 get_fund_list 验证） |

### 设置

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/settings` | 获取全局设置 |
| PUT | `/api/settings` | 更新全局设置 |

### 缓存

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/cache/info` | 获取缓存状态 |
| POST | `/api/cache/refresh` | 手动刷新缓存 |

### 基金数据

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/funds` | 获取基金列表 |

---

## 核心类设计

### BaseDataSource (adapters/base.py)

数据源基类，配置 + 初始化 + API 调用统一封装。

```python
class BaseDataSource:
    """数据源基类"""
    
    source_type: str = ""       # 类型标识
    source_label: str = ""      # 显示名称
    config_schema: list[dict] = []  # 配置字段定义
    
    def __init__(self, config: dict):
        """接收配置，完成初始化"""
        pass
    
    def test_connection(self) -> bool:
        """测试连接，调用 get_fund_list 验证"""
        try:
            result = self.get_fund_list()
            return len(result) > 0
        except:
            return False
    
    def get_fund_list(self) -> list[dict]:
        """获取基金列表 [{"fund_code": "", "fund_name": ""}, ...]"""
        raise NotImplementedError
```

### LixingerDataSource (adapters/lixinger.py)

```python
class LixingerDataSource(BaseDataSource):
    source_type = "lixinger"
    source_label = "理杏仁"
    config_schema = [
        {"field": "token", "label": "Token", "type": "password", "required": True}
    ]
    
    def __init__(self, config: dict):
        self.token = config["token"]
        # 初始化客户端
    
    def get_fund_list(self) -> list[dict]:
        # 调用理杏仁 API
        pass
```

### TushareDataSource (adapters/tushare.py)

```python
class TushareDataSource(BaseDataSource):
    source_type = "tushare"
    source_label = "Tushare"
    config_schema = [
        {"field": "username", "label": "用户名", "type": "text", "required": True},
        {"field": "password", "label": "密码", "type": "password", "required": True}
    ]
    
    def __init__(self, config: dict):
        self.username = config["username"]
        self.password = config["password"]
        # 初始化客户端
    
    def get_fund_list(self) -> list[dict]:
        # 调用 Tushare API
        pass
```

### create_datasource (adapters/factory.py)

工厂方法，根据类型创建数据源实例。

```python
from .lixinger import LixingerDataSource
from .tushare import TushareDataSource

DATASOURCE_CLASSES = {
    "lixinger": LixingerDataSource,
    "tushare": TushareDataSource,
}

def create_datasource(source_type: str, config: dict) -> BaseDataSource:
    """根据类型创建数据源"""
    cls = DATASOURCE_CLASSES.get(source_type)
    if cls is None:
        raise ValueError(f"Unknown datasource type: {source_type}")
    return cls(config)

def get_available_types() -> list[dict]:
    """获取所有支持的数据源类型（供前端渲染）"""
    return [
        {
            "type": cls.source_type,
            "label": cls.source_label,
            "config_schema": cls.config_schema
        }
        for cls in DATASOURCE_CLASSES.values()
    ]
```

### FundCache (cache.py)

缓存管理，内存 + CSV。

```python
import os
import csv
from datetime import datetime, timedelta
from glob import glob

class FundCache:
    """基金列表缓存：内存 + CSV"""
    
    CACHE_DIR = "data"
    CACHE_PREFIX = "funds_list_cache_"
    
    _memory_cache: list[dict] = None
    
    def _get_cache_file(self) -> str | None:
        """查找缓存文件"""
        pattern = os.path.join(self.CACHE_DIR, f"{self.CACHE_PREFIX}*.csv")
        files = glob(pattern)
        return files[0] if files else None
    
    def _parse_cache_date(self, filepath: str) -> datetime:
        """从文件名解析日期"""
        # funds_list_cache_2026_02_28.csv -> 2026-02-28
        filename = os.path.basename(filepath)
        date_str = filename.replace(self.CACHE_PREFIX, "").replace(".csv", "")
        return datetime.strptime(date_str, "%Y_%m_%d")
    
    def _is_expired(self, filepath: str, expire_days: int) -> bool:
        """判断缓存是否过期"""
        cache_date = self._parse_cache_date(filepath)
        return datetime.now() - cache_date > timedelta(days=expire_days)
    
    def get(self, expire_days: int) -> list[dict] | None:
        """获取缓存"""
        # 1. 先查内存
        if self._memory_cache is not None:
            return self._memory_cache
        
        # 2. 查 CSV
        cache_file = self._get_cache_file()
        if cache_file is None:
            return None
        
        # 3. 检查过期
        if self._is_expired(cache_file, expire_days):
            os.remove(cache_file)
            return None
        
        # 4. 读取 CSV 到内存
        self._memory_cache = self._read_csv(cache_file)
        return self._memory_cache
    
    def set(self, data: list[dict]):
        """写入缓存"""
        # 1. 删除旧文件
        old_file = self._get_cache_file()
        if old_file:
            os.remove(old_file)
        
        # 2. 写入新文件
        date_str = datetime.now().strftime("%Y_%m_%d")
        filepath = os.path.join(self.CACHE_DIR, f"{self.CACHE_PREFIX}{date_str}.csv")
        self._write_csv(filepath, data)
        
        # 3. 更新内存
        self._memory_cache = data
    
    def clear(self):
        """清空缓存"""
        self._memory_cache = None
        cache_file = self._get_cache_file()
        if cache_file:
            os.remove(cache_file)
    
    def get_cache_info(self) -> dict:
        """获取缓存状态"""
        cache_file = self._get_cache_file()
        if cache_file is None:
            return {"exists": False, "cached_at": None, "count": 0}
        
        cache_date = self._parse_cache_date(cache_file)
        data = self._read_csv(cache_file)
        return {
            "exists": True,
            "cached_at": cache_date.strftime("%Y-%m-%d"),
            "count": len(data)
        }
    
    def _read_csv(self, filepath: str) -> list[dict]:
        with open(filepath, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            return list(reader)
    
    def _write_csv(self, filepath: str, data: list[dict]):
        with open(filepath, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["fund_code", "fund_name"])
            writer.writeheader()
            writer.writerows(data)
```

### FundRepository (repository.py)

统一入口，外层调用无感知底层数据源。

```python
import json
import csv
import os
from .cache import FundCache
from .adapters.factory import create_datasource

class FundRepository:
    """基金数据仓库 - 统一入口"""
    
    DATASOURCES_FILE = "data/datasources.csv"
    SETTINGS_FILE = "data/settings.csv"
    
    def __init__(self):
        self.cache = FundCache()
        self.datasource = self._load_active_datasource()
    
    def _load_active_datasource(self):
        """加载激活的数据源"""
        if not os.path.exists(self.DATASOURCES_FILE):
            return None
        
        with open(self.DATASOURCES_FILE, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row["is_active"] == "true":
                    config = json.loads(row["config"])
                    return create_datasource(row["type"], config)
        return None
    
    def _get_expire_days(self) -> int:
        """获取缓存过期天数"""
        if not os.path.exists(self.SETTINGS_FILE):
            return 7  # 默认 7 天
        
        with open(self.SETTINGS_FILE, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row["key"] == "cache_expire_days":
                    return int(row["value"])
        return 7
    
    def get_fund_list(self) -> list[dict]:
        """获取基金列表"""
        expire_days = self._get_expire_days()
        
        # 1. 查缓存
        data = self.cache.get(expire_days)
        if data is not None:
            return data
        
        # 2. 无缓存或已过期 → 调远程
        if self.datasource is None:
            return []
        
        data = self.datasource.get_fund_list()
        
        # 3. 写入缓存
        self.cache.set(data)
        return data
    
    def refresh(self) -> list[dict]:
        """强制刷新缓存"""
        self.cache.clear()
        
        if self.datasource is None:
            return []
        
        data = self.datasource.get_fund_list()
        self.cache.set(data)
        return data
    
    def get_cache_info(self) -> dict:
        """获取缓存状态"""
        return self.cache.get_cache_info()
```

---

## 缓存流程

```
请求基金列表
      │
      ▼
  内存有数据？
  ┌───┴───┐
 Yes      No
  │       │
  ▼       ▼
返回    CSV存在？
        ┌───┴───┐
       Yes      No
        │       │
        ▼       ▼
    CSV过期？   调数据源
    ┌───┴───┐      │
   Yes      No     │
    │       │      │
    ▼       ▼      │
 删CSV    读CSV    │
    │    写内存    │
    │    返回     │
    ▼             │
 调数据源 ◄────────┘
    │
    ▼
写CSV + 写内存
    │
    ▼
  返回
```

**写入 CSV 的时机：**
1. 缓存不存在时，从数据源拉取后写入
2. 缓存过期时，从数据源拉取后写入
3. 手动点击"刷新缓存"按钮

---

## 前端设置页

### 页面布局

```
┌─────────────────────────────────────────────────────┐
│                      设置 Tab                        │
├─────────────────────────────────────────────────────┤
│  📡 数据源管理                                       │
│  ┌─────────────────────────────────────────────────┐│
│  │ 名称          类型       状态     操作           ││
│  │ 我的理杏仁    理杏仁     ✅激活   [测试][编辑][删除] ││
│  │ 我的Tushare  Tushare   ⚪停用   [测试][编辑][删除] ││
│  └─────────────────────────────────────────────────┘│
│  [+ 添加数据源]                                      │
│                                                     │
│  ⚙️ 缓存设置                                         │
│  ┌─────────────────────────────────────────────────┐│
│  │ 缓存失效时间: [  7  ] 天       [保存]            ││
│  │                                                 ││
│  │ 缓存状态: 2026-02-28 更新，共 10000 条          ││
│  │ [手动刷新缓存]                                   ││
│  └─────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### 交互说明

**数据源管理：**
- 列表展示所有配置的数据源
- 激活状态用图标区分（✅激活 / ⚪停用）
- 点击"测试"按钮 → 调用 `/api/datasources/<id>/test`，提示成功/失败
- 点击"编辑" → 弹窗修改配置
- 点击"删除" → 确认后删除
- 点击激活状态 → 切换激活/停用
- "添加数据源" → 弹窗选择类型，根据 config_schema 动态渲染表单

**缓存设置：**
- 输入框设置过期天数
- 显示当前缓存状态（日期、条数）
- "手动刷新缓存"按钮 → 调用 `/api/cache/refresh`

---

## 扩展性

### 新增数据源

1. 在 `adapters/` 下新建文件，如 `akshare.py`
2. 继承 `BaseDataSource`，实现 `get_fund_list()`
3. 在 `factory.py` 的 `DATASOURCE_CLASSES` 中注册

```python
# adapters/akshare.py
class AKShareDataSource(BaseDataSource):
    source_type = "akshare"
    source_label = "AKShare"
    config_schema = []  # 无需认证
    
    def get_fund_list(self) -> list[dict]:
        # 实现 API 调用
        pass

# adapters/factory.py
DATASOURCE_CLASSES = {
    "lixinger": LixingerDataSource,
    "tushare": TushareDataSource,
    "akshare": AKShareDataSource,  # 新增
}
```

### 新增数据接口

1. 在 `BaseDataSource` 中添加新方法，如 `get_fund_detail()`
2. 各适配器实现该方法
3. 在 `FundRepository` 中添加对应的缓存逻辑
4. 新增 API 路由

---

## 待定事项

- [ ] 理杏仁 API 具体调用方式（需查阅文档）
- [ ] Tushare API 具体调用方式（需查阅文档）
- [ ] 是否需要数据源连接池/复用
