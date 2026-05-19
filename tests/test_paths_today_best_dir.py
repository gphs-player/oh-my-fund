import os


def test_ensure_dirs_creates_today_best_cache_dir(tmp_path, monkeypatch):
    from warehouse import paths

    # 将 DATA_DIR 指到临时目录（通过 monkeypatch module-level 常量）
    monkeypatch.setattr(paths, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(paths, "STORE_DIR", os.path.join(str(tmp_path), "store"))
    monkeypatch.setattr(paths, "CACHE_DIR", os.path.join(str(tmp_path), "cache"))
    monkeypatch.setattr(paths, "CACHE_FUNDS_LIST_DIR", os.path.join(paths.CACHE_DIR, "funds_list"))
    monkeypatch.setattr(paths, "CACHE_FUND_HISTORY_VALUE_DIR", os.path.join(paths.CACHE_DIR, "fund_history_value"))
    monkeypatch.setattr(paths, "CACHE_AI_ANALYSIS_DIR", os.path.join(paths.CACHE_DIR, "ai_analysis"))
    monkeypatch.setattr(paths, "CACHE_TODAY_BEST_DIR", os.path.join(paths.CACHE_DIR, "today_best"))
    monkeypatch.setattr(paths, "BACKUP_DIR", os.path.join(str(tmp_path), "_backup"))

    paths.ensure_dirs()
    assert os.path.isdir(paths.CACHE_TODAY_BEST_DIR)

