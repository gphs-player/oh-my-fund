import os
import re
import shutil
from datetime import datetime
from glob import glob


PROJECT_ROOT = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

STORE_DIR = os.path.join(DATA_DIR, "store")

CACHE_DIR = os.path.join(DATA_DIR, "cache")
CACHE_FUNDS_LIST_DIR = os.path.join(CACHE_DIR, "funds_list")
CACHE_FUND_HISTORY_VALUE_DIR = os.path.join(CACHE_DIR, "fund_history_value")
CACHE_AI_ANALYSIS_DIR = os.path.join(CACHE_DIR, "ai_analysis")
CACHE_TODAY_BEST_DIR = os.path.join(CACHE_DIR, "today_best")

BACKUP_DIR = os.path.join(DATA_DIR, "_backup")


def ensure_dirs():
    os.makedirs(STORE_DIR, exist_ok=True)
    os.makedirs(CACHE_FUNDS_LIST_DIR, exist_ok=True)
    os.makedirs(CACHE_FUND_HISTORY_VALUE_DIR, exist_ok=True)
    os.makedirs(CACHE_AI_ANALYSIS_DIR, exist_ok=True)
    os.makedirs(CACHE_TODAY_BEST_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)


def _backup_then_move(src: str, dst: str, backup_root: str):
    if not os.path.exists(src):
        return
    if os.path.exists(dst):
        return

    rel = os.path.relpath(src, DATA_DIR)
    backup_path = os.path.join(backup_root, rel)
    os.makedirs(os.path.dirname(backup_path), exist_ok=True)
    shutil.copy2(src, backup_path)

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(src, dst)


def _backup_then_remove(src: str, backup_root: str):
    if not os.path.exists(src):
        return
    rel = os.path.relpath(src, DATA_DIR)
    backup_path = os.path.join(backup_root, rel)
    os.makedirs(os.path.dirname(backup_path), exist_ok=True)
    shutil.copy2(src, backup_path)
    try:
        os.remove(src)
    except Exception:
        pass


def migrate_data_layout_if_needed():
    """
    将旧 data/ 根目录混放文件迁移到：
    - data/store/：业务/配置 CSV
    - data/cache/*：缓存
    并在 data/_backup/<timestamp>/ 下保留备份。
    """
    ensure_dirs()

    ts = datetime.now().strftime("%Y_%m_%d_%H%M%S")
    backup_root = os.path.join(BACKUP_DIR, ts)
    os.makedirs(backup_root, exist_ok=True)

    # 1) store CSV（业务/配置）
    store_files = [
        "markets.csv",
        "investments.csv",
        "favorites.csv",
        "favorite_groups.csv",
        "favorite_group_memberships.csv",
        "datasources.csv",
        "settings.csv",
        "strategies.csv",
    ]
    for name in store_files:
        src = os.path.join(DATA_DIR, name)
        dst = os.path.join(STORE_DIR, name)
        _backup_then_move(src, dst, backup_root)

    # 2) 基金列表缓存：funds_list_cache_YYYY_MM_DD.csv -> cache/funds_list/YYYY_MM_DD.csv
    for src in glob(os.path.join(DATA_DIR, "funds_list_cache_*.csv")):
        filename = os.path.basename(src)
        tag = filename.replace("funds_list_cache_", "").replace(".csv", "")
        dst = os.path.join(CACHE_FUNDS_LIST_DIR, f"{tag}.csv")
        _backup_then_move(src, dst, backup_root)

    # 3) 历史净值缓存：fund_history_cache_<fund_code>_YYYY_MM_DD.csv -> cache/fund_history_value/<fund_code>/YYYY_MM_DD.csv
    history_re = re.compile(r"^fund_history_cache_(?P<code>[^_]+)_(?P<tag>\d{4}_\d{2}_\d{2})\.csv$")
    for src in glob(os.path.join(DATA_DIR, "fund_history_cache_*_*.csv")):
        filename = os.path.basename(src)
        m = history_re.match(filename)
        if not m:
            continue
        code = m.group("code")
        tag = m.group("tag")
        dst = os.path.join(CACHE_FUND_HISTORY_VALUE_DIR, code, f"{tag}.csv")
        _backup_then_move(src, dst, backup_root)

    # 5) AI 分析缓存（旧格式无截止时间信息，无法无损迁移到新命名）：备份后删除，让用户重新生成
    ai_re = re.compile(r"^ai_analysis_cache_(?P<code>.+)\.csv$")
    for src in glob(os.path.join(DATA_DIR, "ai_analysis_cache_*.csv")):
        _backup_then_remove(src, backup_root)

    # 6) 兼容旧 cache 目录命名：data/cache/fund_history/... -> data/cache/fund_history_value/...
    old_history_dir = os.path.join(CACHE_DIR, "fund_history")
    if os.path.isdir(old_history_dir):
        for src in glob(os.path.join(old_history_dir, "*", "*.csv")):
            fund_code = os.path.basename(os.path.dirname(src))
            filename = os.path.basename(src)
            dst = os.path.join(CACHE_FUND_HISTORY_VALUE_DIR, fund_code, filename)
            _backup_then_move(src, dst, backup_root)

    # 7) 兼容：data/cache 下旧的带前缀文件名（若曾迁移过一版命名规则）
    for src in glob(os.path.join(CACHE_FUNDS_LIST_DIR, "funds_list_cache_*.csv")):
        filename = os.path.basename(src)
        tag = filename.replace("funds_list_cache_", "").replace(".csv", "")
        dst = os.path.join(CACHE_FUNDS_LIST_DIR, f"{tag}.csv")
        _backup_then_move(src, dst, backup_root)

    # 兼容：data/cache/ai_analysis 下旧的带前缀文件（无截止时间信息）直接备份后删除
    for src in glob(os.path.join(CACHE_AI_ANALYSIS_DIR, "ai_analysis_cache_*.csv")):
        _backup_then_remove(src, backup_root)

    # 兼容：data/cache/ai_analysis 下旧的“<fund_code>.csv”文件（无截止时间信息）直接备份后删除
    for src in glob(os.path.join(CACHE_AI_ANALYSIS_DIR, "*.csv")):
        # 若已经是新格式（放在 <fund_code>/YYYYMMDD_1500.csv）不会匹配到这里
        _backup_then_remove(src, backup_root)
