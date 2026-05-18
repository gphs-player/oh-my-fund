from flask import Flask, render_template, jsonify, request
import os
import csv
import json
import uuid
from datetime import datetime, date, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

from strategies import registry as strategy_registry
from strategies.backtest import run_backtest
from warehouse import FundRepository
from warehouse.adapters import create_datasource, get_available_types
from warehouse.ai_fund_pick.parser import FundPickParseError, parse_fund_pick_prompt, parse_fund_pick_prompt_refine
from warehouse.ai_fund_pick.planner import FundPickPlanError, build_fund_pick_plan
from warehouse.ai_fund_pick.capabilities import CAPABILITIES_V1
from warehouse.ai_fund_pick.missing import build_missing_items, missing_signature
from warehouse.paths import STORE_DIR, migrate_data_layout_if_needed

app = Flask(__name__)

# 迁移并整理 data 目录结构（store/cache 分离、缓存去前缀命名）
migrate_data_layout_if_needed()

# 市场列表文件路径
MARKETS_FILE = os.path.join(STORE_DIR, 'markets.csv')

# 默认市场列表
DEFAULT_MARKETS = ['美股', 'A股', '亚太', '港股', '全球']
DEFAULT_DATASOURCE_TYPE = 'Default'
DEFAULT_DATASOURCE_NAME = '默认数据源'
LEGACY_DEFAULT_DATASOURCE_TYPES = {'default', DEFAULT_DATASOURCE_TYPE}
REMOVED_DATASOURCE_TYPES = {"EastMoneyMob"}


def ensure_markets_file():
    """确保市场文件存在，不存在则创建默认文件"""
    data_dir = os.path.dirname(MARKETS_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(MARKETS_FILE):
        with open(MARKETS_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['name'])
            for market in DEFAULT_MARKETS:
                writer.writerow([market])


def read_markets():
    """读取市场列表"""
    ensure_markets_file()
    markets = []
    with open(MARKETS_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            markets.append(row['name'])
    return markets


def write_markets(markets):
    """写入市场列表"""
    ensure_markets_file()
    with open(MARKETS_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['name'])
        for market in markets:
            writer.writerow([market])


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/strategies/new')
def strategy_detail_new_page():
    return render_template('strategy_detail.html', bootstrap=build_strategy_detail_bootstrap())


@app.route('/strategies/<strategy_id>')
def strategy_detail_page(strategy_id):
    strategies = read_strategies()
    item = next((x for x in strategies if x.get('strategy_id') == strategy_id), None)
    if item is None:
        return render_template('strategy_detail.html', bootstrap=build_strategy_detail_bootstrap(not_found=True, strategy_id=strategy_id)), 404
    return render_template('strategy_detail.html', bootstrap=build_strategy_detail_bootstrap(item=item))


@app.route('/api/markets', methods=['GET'])
def get_markets():
    """获取市场列表"""
    markets = read_markets()
    return jsonify(markets)


@app.route('/api/markets', methods=['POST'])
def save_markets():
    """保存市场列表（全量覆盖）"""
    markets = request.get_json()
    if not isinstance(markets, list):
        return jsonify({'error': '无效的数据格式'}), 400
    write_markets(markets)
    return jsonify({'success': True})


# =====================
# 策略类型 / 策略方案 API
# =====================
@app.route('/api/strategy-types', methods=['GET'])
def list_strategy_types():
    """获取动态注册的单一策略定义。"""
    data = []
    for item in get_builtin_strategy_types():
        normalized = dict(item or {})
        normalized['strategy_kind'] = 'single'
        normalized['is_builtin'] = True
        data.append(normalized)
    return jsonify(data)


@app.route('/api/strategies', methods=['GET'])
def list_strategies():
    """获取组合策略列表（轻量）。"""
    strategies = read_strategies()
    data = []
    for item in strategies:
        stack = item.get('stack') or []
        data.append({
            'strategy_id': item.get('strategy_id', ''),
            'name': item.get('name', ''),
            'type': item.get('type', 'strategy_plan'),
            'version': item.get('version', 1),
            'scope': item.get('scope', 'single_fund_analysis'),
            'fund_code': item.get('fund_code', ''),
            'fund_name': item.get('fund_name', ''),
            'strategy_kind': 'composite',
            'strategy_count': len(stack),
            'created_at': item.get('created_at', ''),
            'updated_at': item.get('updated_at', ''),
        })
    data.sort(key=lambda x: x.get('updated_at') or '', reverse=True)
    return jsonify(data)


@app.route('/api/strategies', methods=['POST'])
def create_strategy():
    """新建组合策略。"""
    data = request.get_json() or {}
    try:
        plan = build_strategy_plan_payload(data)
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    now = _now_iso()
    strategy_id = uuid.uuid4().hex
    item = {
        'strategy_id': strategy_id,
        'name': plan['name'],
        'type': 'strategy_plan',
        'strategy_kind': 'composite',
        'version': 1,
        'scope': plan['scope'],
        'fund_code': plan['fund_code'],
        'fund_name': plan['fund_name'],
        'date_range': plan['date_range'],
        'stack': plan['stack'],
        'backtest_config': plan.get('backtest_config') or {},
        'signal_overrides': plan.get('signal_overrides') or [],
        'created_at': now,
        'updated_at': now,
    }

    strategies = read_strategies()
    strategies.append(item)
    write_strategies(strategies)
    return jsonify({'success': True, 'strategy_id': strategy_id})


@app.route('/api/strategies/<strategy_id>', methods=['GET'])
def get_strategy(strategy_id):
    """获取单条组合策略详情。"""
    strategies = read_strategies()
    item = next((x for x in strategies if x.get('strategy_id') == strategy_id), None)
    if not item:
        return jsonify({'success': False, 'error': '策略方案不存在'}), 404
    return jsonify({'success': True, 'data': item})


@app.route('/api/strategies/<strategy_id>', methods=['PUT'])
def update_strategy(strategy_id):
    """覆盖更新组合策略。"""
    data = request.get_json() or {}
    try:
        plan = build_strategy_plan_payload(data)
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400

    strategies = read_strategies()
    found = False
    for item in strategies:
        if item.get('strategy_id') == strategy_id:
            item['name'] = plan['name']
            item['type'] = 'strategy_plan'
            item['version'] = 1
            item['scope'] = plan['scope']
            item['fund_code'] = plan['fund_code']
            item['fund_name'] = plan['fund_name']
            item['date_range'] = plan['date_range']
            item['stack'] = plan['stack']
            item['backtest_config'] = plan.get('backtest_config') or {}
            item['signal_overrides'] = plan.get('signal_overrides') or []
            item['updated_at'] = _now_iso()
            found = True
            break

    if not found:
        return jsonify({'success': False, 'error': '策略方案不存在'}), 404

    write_strategies(strategies)
    return jsonify({'success': True})


@app.route('/api/strategies/<strategy_id>', methods=['DELETE'])
def delete_strategy(strategy_id):
    """删除组合策略。"""
    strategies = read_strategies()
    new_items = [x for x in strategies if x.get('strategy_id') != strategy_id]
    if len(new_items) == len(strategies):
        return jsonify({'success': False, 'error': '策略方案不存在'}), 404
    write_strategies(new_items)
    return jsonify({'success': True})


@app.route('/api/strategy-analysis/run', methods=['POST'])
def run_strategy_analysis():
    """执行单基金策略分析。"""
    data = request.get_json() or {}
    fund_code = str(data.get('fund_code', '')).strip()
    if not fund_code:
        return jsonify({'success': False, 'message': '基金代码不能为空'}), 400

    date_range = normalize_strategy_date_range(data.get('date_range'))
    full_history = bool(data.get('full_history')) or bool(date_range.get('full_history'))
    start_date, end_date = resolve_date_range(
        str(data.get('start_date', '')).strip() or date_range.get('start_date') or None,
        str(data.get('end_date', '')).strip() or date_range.get('end_date') or None,
        full_history=full_history,
    )
    try:
        stack = strategy_registry.validate_stack(data.get('stack') or [])
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400

    active_stack = [item for item in stack if item.get('enabled', True)]
    if not active_stack:
        return jsonify({'success': False, 'message': '请至少启用一个策略'}), 400

    try:
        history = fund_repository.get_fund_history(fund_code, start_date, end_date)
        strategy_results = strategy_registry.run_stack(history, active_stack)
    except Exception as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400

    all_signals = []
    for item in strategy_results:
        all_signals.extend(item.get('signals') or [])
    all_signals.sort(key=lambda x: (x.get('date') or '', x.get('strategy_name') or ''))

    return jsonify({
        'success': True,
        'fund_code': fund_code,
        'history': history,
        'results': strategy_results,
        'signals': all_signals,
        'date_range': {'start_date': start_date, 'end_date': end_date},
        'summary': {
            'history_count': len(history),
            'strategy_count': len(strategy_results),
            'signal_count': len(all_signals),
        },
    })


@app.route('/api/strategy-run', methods=['POST'])
def run_strategy_and_backtest():
    """执行单基金策略分析 + 回测（统一接口）。"""
    data = request.get_json() or {}
    fund_code = str(data.get('fund_code', '')).strip()
    if not fund_code:
        return jsonify({'success': False, 'message': '基金代码不能为空'}), 400

    date_range = normalize_strategy_date_range(data.get('date_range'))
    full_history = bool(data.get('full_history')) or bool(date_range.get('full_history'))
    start_date, end_date = resolve_date_range(
        str(data.get('start_date', '')).strip() or date_range.get('start_date') or None,
        str(data.get('end_date', '')).strip() or date_range.get('end_date') or None,
        full_history=full_history,
    )
    try:
        stack = strategy_registry.validate_stack(data.get('stack') or [])
    except ValueError as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400

    active_stack = [item for item in stack if item.get('enabled', True)]
    if not active_stack:
        return jsonify({'success': False, 'message': '请至少启用一个策略'}), 400

    backtest_config = data.get('backtest_config') if isinstance(data.get('backtest_config'), dict) else {}
    signal_overrides = data.get('signal_overrides') if isinstance(data.get('signal_overrides'), list) else []

    try:
        history = fund_repository.get_fund_history(fund_code, start_date, end_date)
        strategy_results = strategy_registry.run_stack(history, active_stack)
    except Exception as exc:
        return jsonify({'success': False, 'message': str(exc)}), 400

    all_signals: list[dict] = []
    for item in strategy_results:
        all_signals.extend(item.get('signals') or [])
    all_signals.sort(key=lambda x: (x.get('date') or '', x.get('strategy_name') or '', x.get('title') or ''))

    try:
        backtest_result, backtest_trades = run_backtest(
            history=history,
            signals=all_signals,
            config=backtest_config,
            overrides=signal_overrides,
        )
    except Exception as exc:
        backtest_result, backtest_trades = {'error': str(exc)}, []

    return jsonify({
        'success': True,
        'fund_code': fund_code,
        'history': history,
        'analysis_results': strategy_results,
        'signals': all_signals,
        'date_range': {'start_date': start_date, 'end_date': end_date},
        'summary': {
            'history_count': len(history),
            'strategy_count': len(strategy_results),
            'signal_count': len(all_signals),
        },
        'backtest_result': backtest_result,
        'backtest_trades': backtest_trades,
    })


# =====================
# 自选基金 API
# =====================
@app.route('/api/favorites', methods=['GET'])
def list_favorites():
    """获取所有自选基金"""
    favorites = read_favorites()
    return jsonify(favorites)


@app.route('/api/favorites', methods=['POST'])
def add_favorite():
    """新增自选基金"""
    data = request.get_json() or {}
    fund_code = str(data.get('fund_code', '')).strip()
    fund_name = str(data.get('fund_name', '')).strip()

    if not fund_code:
        return jsonify({'success': False, 'error': '基金代码不能为空'}), 400

    favorites = read_favorites()
    for item in favorites:
        if item['fund_code'] == fund_code:
            return jsonify({'success': False, 'error': '该基金已在自选中'}), 400

    favorites.append({
        'fund_code': fund_code,
        'fund_name': fund_name,
        'created_at': str(data.get('created_at', '')).strip()
    })
    write_favorites(favorites)
    ensure_default_favorite_group()
    memberships = read_favorite_group_memberships()
    group_ids = [str(item).strip() for item in (data.get('group_ids') or []) if str(item).strip()]
    if not group_ids:
        group_ids = [DEFAULT_FAVORITE_GROUP_ID]
    for group_id in group_ids:
        memberships.append({'fund_code': fund_code, 'group_id': group_id})
    write_favorite_group_memberships(memberships)
    return jsonify({'success': True})


@app.route('/api/favorites/<fund_code>', methods=['DELETE'])
def delete_favorite(fund_code):
    """删除自选基金"""
    favorites = read_favorites()
    new_favorites = [item for item in favorites if item['fund_code'] != fund_code]

    if len(new_favorites) == len(favorites):
        return jsonify({'success': False, 'error': '自选基金不存在'}), 404

    write_favorites(new_favorites)
    memberships = [item for item in read_favorite_group_memberships() if item['fund_code'] != fund_code]
    write_favorite_group_memberships(memberships)
    return jsonify({'success': True})


@app.route('/api/favorite-groups', methods=['GET'])
def list_favorite_groups():
    """获取所有自选分组"""
    return jsonify(read_favorite_groups())


@app.route('/api/favorite-groups', methods=['POST'])
def add_favorite_group():
    """新增自选分组"""
    data = request.get_json() or {}
    group_name = str(data.get('group_name', '')).strip()
    if not group_name:
        return jsonify({'success': False, 'error': '分组名称不能为空'}), 400

    groups = read_favorite_groups()
    if any(item['group_name'] == group_name for item in groups):
        return jsonify({'success': False, 'error': '分组名称已存在'}), 400

    new_group = {
        'group_id': uuid.uuid4().hex,
        'group_name': group_name,
        'is_system': False,
        'created_at': str(data.get('created_at', '')).strip()
    }
    groups.append(new_group)
    write_favorite_groups(groups)
    return jsonify({'success': True, 'group_id': new_group['group_id']})


@app.route('/api/favorite-groups/<group_id>', methods=['PUT'])
def update_favorite_group(group_id):
    """重命名分组"""
    data = request.get_json() or {}
    group_name = str(data.get('group_name', '')).strip()
    if not group_name:
        return jsonify({'success': False, 'error': '分组名称不能为空'}), 400

    groups = read_favorite_groups()
    if any(item['group_id'] != group_id and item['group_name'] == group_name for item in groups):
        return jsonify({'success': False, 'error': '分组名称已存在'}), 400

    for item in groups:
        if item['group_id'] == group_id:
            item['group_name'] = group_name
            write_favorite_groups(groups)
            return jsonify({'success': True})

    return jsonify({'success': False, 'error': '分组不存在'}), 404


@app.route('/api/favorite-groups/<group_id>', methods=['DELETE'])
def delete_favorite_group(group_id):
    """删除分组"""
    if group_id == DEFAULT_FAVORITE_GROUP_ID:
        return jsonify({'success': False, 'error': '默认组不允许删除'}), 400

    groups = read_favorite_groups()
    if not any(item['group_id'] == group_id for item in groups):
        return jsonify({'success': False, 'error': '分组不存在'}), 404

    write_favorite_groups([item for item in groups if item['group_id'] != group_id])
    memberships = read_favorite_group_memberships()
    affected_fund_codes = {item['fund_code'] for item in memberships if item['group_id'] == group_id}
    memberships = [item for item in memberships if item['group_id'] != group_id]
    for fund_code in affected_fund_codes:
        if not any(item['fund_code'] == fund_code for item in memberships):
            memberships.append({'fund_code': fund_code, 'group_id': DEFAULT_FAVORITE_GROUP_ID})
    write_favorite_group_memberships(memberships)
    return jsonify({'success': True})


@app.route('/api/favorite-group-memberships', methods=['GET'])
def list_favorite_group_memberships():
    """获取所有自选基金分组关系"""
    ensure_favorites_default_group_memberships()
    return jsonify(read_favorite_group_memberships())


@app.route('/api/favorites/<fund_code>/groups', methods=['PUT'])
def update_favorite_groups(fund_code):
    """更新某只自选基金所属分组"""
    favorites = read_favorites()
    if not any(item['fund_code'] == fund_code for item in favorites):
        return jsonify({'success': False, 'error': '自选基金不存在'}), 404

    data = request.get_json() or {}
    group_ids = [str(item).strip() for item in (data.get('group_ids') or []) if str(item).strip()]
    if not group_ids:
        group_ids = [DEFAULT_FAVORITE_GROUP_ID]

    valid_group_ids = {item['group_id'] for item in read_favorite_groups()}
    if any(group_id not in valid_group_ids for group_id in group_ids):
        return jsonify({'success': False, 'error': '存在无效分组'}), 400

    memberships = [item for item in read_favorite_group_memberships() if item['fund_code'] != fund_code]
    for group_id in group_ids:
        memberships.append({'fund_code': fund_code, 'group_id': group_id})
    write_favorite_group_memberships(memberships)
    return jsonify({'success': True})


# =====================
# 持仓数据 API
# =====================
@app.route('/api/investments', methods=['GET'])
def list_investments():
    """获取所有持仓"""
    investments = read_investments()
    return jsonify(investments)


@app.route('/api/investments', methods=['POST'])
def add_investment():
    """添加持仓"""
    data = request.get_json()
    fund_code = data.get('fund_code')
    
    if not fund_code:
        return jsonify({'success': False, 'error': '基金代码不能为空'}), 400
    
    investments = read_investments()
    
    # 检查是否已存在
    for inv in investments:
        if inv['fund_code'] == fund_code:
            return jsonify({'success': False, 'error': '该基金已存在'}), 400
    
    investments.append({
        'fund_code': fund_code,
        'fund_name': data.get('fund_name', ''),
        'sector': data.get('sector', ''),
        'position': float(data.get('position', 0)),
        'trade_type': data.get('trade_type', ''),
        'market': data.get('market', ''),
        'risk_level': data.get('risk_level', '中'),
        'holding_plan': data.get('holding_plan', '中期')
    })
    
    write_investments(investments)
    return jsonify({'success': True})


@app.route('/api/investments/<fund_code>', methods=['PUT'])
def update_investment(fund_code):
    """更新持仓"""
    data = request.get_json()
    investments = read_investments()
    
    for i, inv in enumerate(investments):
        if inv['fund_code'] == fund_code:
            investments[i] = {
                'fund_code': fund_code,
                'fund_name': data.get('fund_name', inv['fund_name']),
                'sector': data.get('sector', inv['sector']),
                'position': float(data.get('position', inv['position'])),
                'trade_type': data.get('trade_type', inv['trade_type']),
                'market': data.get('market', inv['market']),
                'risk_level': data.get('risk_level', inv['risk_level']),
                'holding_plan': data.get('holding_plan', inv['holding_plan'])
            }
            write_investments(investments)
            return jsonify({'success': True})
    
    return jsonify({'success': False, 'error': '持仓不存在'}), 404


@app.route('/api/investments/<fund_code>', methods=['DELETE'])
def delete_investment(fund_code):
    """删除持仓"""
    investments = read_investments()
    new_investments = [inv for inv in investments if inv['fund_code'] != fund_code]
    
    if len(new_investments) == len(investments):
        return jsonify({'success': False, 'error': '持仓不存在'}), 404
    
    write_investments(new_investments)
    return jsonify({'success': True})


# =====================
# 数据源配置文件路径
# =====================
DATASOURCES_FILE = os.path.join(STORE_DIR, 'datasources.csv')
SETTINGS_FILE = os.path.join(STORE_DIR, 'settings.csv')
INVESTMENTS_FILE = os.path.join(STORE_DIR, 'investments.csv')
FAVORITES_FILE = os.path.join(STORE_DIR, 'favorites.csv')
FAVORITE_GROUPS_FILE = os.path.join(STORE_DIR, 'favorite_groups.csv')
FAVORITE_GROUP_MEMBERSHIPS_FILE = os.path.join(STORE_DIR, 'favorite_group_memberships.csv')
STRATEGIES_FILE = os.path.join(STORE_DIR, 'strategies.csv')
DEFAULT_FAVORITE_GROUP_ID = 'default'
DEFAULT_FAVORITE_GROUP_NAME = '默认组'


def ensure_investments_file():
    """确保持仓文件存在"""
    data_dir = os.path.dirname(INVESTMENTS_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(INVESTMENTS_FILE):
        with open(INVESTMENTS_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['fund_code', 'fund_name', 'sector', 'position', 'trade_type', 'market', 'risk_level', 'holding_plan'])


def read_investments():
    """读取所有持仓"""
    ensure_investments_file()
    investments = []
    with open(INVESTMENTS_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            investments.append({
                'fund_code': row['fund_code'],
                'fund_name': row['fund_name'],
                'sector': row['sector'],
                'position': float(row['position']) if row['position'] else 0,
                'trade_type': row['trade_type'],
                'market': row['market'],
                'risk_level': row['risk_level'],
                'holding_plan': row['holding_plan']
            })
    return investments


def write_investments(investments):
    """写入所有持仓"""
    ensure_investments_file()
    with open(INVESTMENTS_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['fund_code', 'fund_name', 'sector', 'position', 'trade_type', 'market', 'risk_level', 'holding_plan'])
        for inv in investments:
            writer.writerow([
                inv['fund_code'],
                inv['fund_name'],
                inv['sector'],
                inv['position'],
                inv['trade_type'],
                inv['market'],
                inv['risk_level'],
                inv['holding_plan']
            ])


def ensure_favorites_file():
    """确保自选基金文件存在"""
    data_dir = os.path.dirname(FAVORITES_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(FAVORITES_FILE):
        with open(FAVORITES_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['fund_code', 'fund_name', 'created_at'])


def read_favorites():
    """读取所有自选基金"""
    ensure_favorites_file()
    favorites = []
    with open(FAVORITES_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            favorites.append({
                'fund_code': row['fund_code'],
                'fund_name': row['fund_name'],
                'created_at': row['created_at']
            })
    return favorites


def write_favorites(favorites):
    """写入所有自选基金"""
    ensure_favorites_file()
    with open(FAVORITES_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['fund_code', 'fund_name', 'created_at'])
        for item in favorites:
            writer.writerow([
                item['fund_code'],
                item.get('fund_name', ''),
                item.get('created_at', '')
            ])


def ensure_favorite_groups_file():
    """确保自选分组文件存在"""
    data_dir = os.path.dirname(FAVORITE_GROUPS_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(FAVORITE_GROUPS_FILE):
        with open(FAVORITE_GROUPS_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['group_id', 'group_name', 'is_system', 'created_at'])
    ensure_default_favorite_group()


def ensure_favorite_group_memberships_file():
    """确保自选基金分组关系文件存在"""
    data_dir = os.path.dirname(FAVORITE_GROUP_MEMBERSHIPS_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(FAVORITE_GROUP_MEMBERSHIPS_FILE):
        with open(FAVORITE_GROUP_MEMBERSHIPS_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['fund_code', 'group_id'])


def read_favorite_groups():
    """读取所有自选分组"""
    ensure_favorite_groups_file()
    groups = []
    with open(FAVORITE_GROUPS_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            groups.append({
                'group_id': row['group_id'],
                'group_name': row['group_name'],
                'is_system': row['is_system'] == 'true',
                'created_at': row['created_at']
            })
    return groups


def write_favorite_groups(groups):
    """写入所有自选分组"""
    with open(FAVORITE_GROUPS_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['group_id', 'group_name', 'is_system', 'created_at'])
        for item in groups:
            writer.writerow([
                item['group_id'],
                item.get('group_name', ''),
                'true' if item.get('is_system') else 'false',
                item.get('created_at', '')
            ])


def ensure_default_favorite_group():
    """确保默认分组存在"""
    data_dir = os.path.dirname(FAVORITE_GROUPS_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(FAVORITE_GROUPS_FILE):
        with open(FAVORITE_GROUPS_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['group_id', 'group_name', 'is_system', 'created_at'])
            writer.writerow([DEFAULT_FAVORITE_GROUP_ID, DEFAULT_FAVORITE_GROUP_NAME, 'true', ''])
        return

    groups = []
    changed = False
    has_default = False
    with open(FAVORITE_GROUPS_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            item = {
                'group_id': row['group_id'],
                'group_name': row['group_name'],
                'is_system': row['is_system'] == 'true',
                'created_at': row['created_at']
            }
            if item['group_id'] == DEFAULT_FAVORITE_GROUP_ID:
                has_default = True
                if item['group_name'] != DEFAULT_FAVORITE_GROUP_NAME or not item['is_system']:
                    item['group_name'] = DEFAULT_FAVORITE_GROUP_NAME
                    item['is_system'] = True
                    changed = True
            groups.append(item)

    if not has_default:
        groups.insert(0, {
            'group_id': DEFAULT_FAVORITE_GROUP_ID,
            'group_name': DEFAULT_FAVORITE_GROUP_NAME,
            'is_system': True,
            'created_at': ''
        })
        changed = True

    if changed:
        write_favorite_groups(groups)


def read_favorite_group_memberships():
    """读取所有自选基金分组关系"""
    ensure_favorite_group_memberships_file()
    ensure_default_favorite_group()
    memberships = []
    with open(FAVORITE_GROUP_MEMBERSHIPS_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            memberships.append({
                'fund_code': row['fund_code'],
                'group_id': row['group_id']
            })
    return normalize_favorite_memberships(memberships)


def write_favorite_group_memberships(memberships):
    """写入所有自选基金分组关系"""
    ensure_favorite_group_memberships_file()
    memberships = normalize_favorite_memberships(memberships)
    with open(FAVORITE_GROUP_MEMBERSHIPS_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['fund_code', 'group_id'])
        for item in memberships:
            writer.writerow([item['fund_code'], item['group_id']])


def normalize_favorite_memberships(memberships):
    """去重并清洗分组关系"""
    dedup = []
    seen = set()
    valid_group_ids = {item['group_id'] for item in read_favorite_groups()}
    for item in memberships:
        fund_code = str(item.get('fund_code', '')).strip()
        group_id = str(item.get('group_id', '')).strip()
        if not fund_code or not group_id or group_id not in valid_group_ids:
            continue
        key = (fund_code, group_id)
        if key in seen:
            continue
        seen.add(key)
        dedup.append({'fund_code': fund_code, 'group_id': group_id})
    return dedup


def ensure_favorites_default_group_memberships():
    """确保每只自选基金至少属于默认组或其它分组"""
    favorites = read_favorites()
    memberships = read_favorite_group_memberships()
    favorite_codes = {item['fund_code'] for item in favorites}
    memberships = [item for item in memberships if item['fund_code'] in favorite_codes]
    mapped_codes = {item['fund_code'] for item in memberships}
    for fund_code in favorite_codes:
        if fund_code not in mapped_codes:
            memberships.append({'fund_code': fund_code, 'group_id': DEFAULT_FAVORITE_GROUP_ID})
    write_favorite_group_memberships(memberships)


def ensure_datasources_file():
    """确保数据源配置文件存在"""
    data_dir = os.path.dirname(DATASOURCES_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(DATASOURCES_FILE):
        with open(DATASOURCES_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['id', 'name', 'type', 'config', 'is_active'])
    ensure_default_datasource_record()


def build_default_datasource(next_id):
    """构建默认数据源记录"""
    return {
        'id': next_id,
        'name': DEFAULT_DATASOURCE_NAME,
        'type': DEFAULT_DATASOURCE_TYPE,
        'config': {},
        'is_active': False
    }


def is_builtin_datasource(datasource):
    """判断是否为系统内置数据源"""
    return datasource.get('type') in LEGACY_DEFAULT_DATASOURCE_TYPES


def ensure_default_datasource_record():
    """确保默认数据源记录存在且唯一"""
    with open(DATASOURCES_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        datasources = []
        for row in reader:
            datasources.append({
                'id': int(row['id']),
                'name': row['name'],
                'type': row['type'],
                'config': json.loads(row['config']),
                'is_active': row['is_active'] == 'true'
            })

    # 清理已下线的数据源类型（例如 EastMoneyMob）
    datasources = [ds for ds in datasources if ds.get('type') not in REMOVED_DATASOURCE_TYPES]

    default_datasources = [ds for ds in datasources if is_builtin_datasource(ds)]
    changed = False

    for ds in default_datasources:
        if ds['type'] != DEFAULT_DATASOURCE_TYPE:
            ds['type'] = DEFAULT_DATASOURCE_TYPE
            changed = True

    if not default_datasources:
        next_id = max((ds['id'] for ds in datasources), default=0) + 1
        datasources.append(build_default_datasource(next_id))
        changed = True
    elif len(default_datasources) > 1:
        primary_default = default_datasources[0]
        datasources = [
            ds for ds in datasources
            if not is_builtin_datasource(ds) or ds['id'] == primary_default['id']
        ]
        changed = True

    if changed:
        with open(DATASOURCES_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['id', 'name', 'type', 'config', 'is_active'])
            for ds in datasources:
                writer.writerow([
                    ds['id'],
                    ds['name'],
                    ds['type'],
                    json.dumps(ds['config'], ensure_ascii=False),
                    'true' if ds['is_active'] else 'false'
                ])


def read_datasources():
    """读取所有数据源配置"""
    ensure_datasources_file()
    datasources = []
    with open(DATASOURCES_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            datasources.append({
                'id': int(row['id']),
                'name': row['name'],
                'type': row['type'],
                'config': json.loads(row['config']),
                'is_active': row['is_active'] == 'true'
            })
    return datasources


def write_datasources(datasources):
    """写入所有数据源配置"""
    ensure_datasources_file()
    with open(DATASOURCES_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['id', 'name', 'type', 'config', 'is_active'])
        for ds in datasources:
            writer.writerow([
                ds['id'],
                ds['name'],
                ds['type'],
                json.dumps(ds['config'], ensure_ascii=False),
                'true' if ds['is_active'] else 'false'
            ])


def get_next_datasource_id():
    """获取下一个数据源 ID"""
    datasources = read_datasources()
    if not datasources:
        return 1
    return max(ds['id'] for ds in datasources) + 1


def ensure_settings_file():
    """确保设置文件存在"""
    data_dir = os.path.dirname(SETTINGS_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(SETTINGS_FILE):
        with open(SETTINGS_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['key', 'value'])
            writer.writerow(['cache_expire_days', '7'])


def read_settings():
    """读取所有设置"""
    ensure_settings_file()
    settings = {}
    with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            settings[row['key']] = row['value']
    return settings


def write_settings(settings):
    """写入所有设置"""
    ensure_settings_file()
    with open(SETTINGS_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['key', 'value'])
        for key, value in settings.items():
            writer.writerow([key, value])


# =====================
# 策略注册表 + 策略方案（CSV 持久化）
# =====================
def _now_iso():
    return datetime.now().isoformat(timespec='seconds')


def get_builtin_strategy_types():
    return strategy_registry.list_definitions()


def ensure_strategies_file():
    """确保策略方案文件存在"""
    data_dir = os.path.dirname(STRATEGIES_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(STRATEGIES_FILE):
        with open(STRATEGIES_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['strategy_id', 'name', 'type', 'version', 'params', 'created_at', 'updated_at'])


def read_strategies():
    """读取所有策略方案，并兼容旧版单策略模板。"""
    ensure_strategies_file()
    items = []
    with open(STRATEGIES_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                params = json.loads(row.get('params') or '{}')
            except Exception:
                params = {}
            item = normalize_strategy_record({
                'strategy_id': row.get('strategy_id', ''),
                'name': row.get('name', ''),
                'type': row.get('type', ''),
                'version': int(row.get('version') or 1),
                'params': params if isinstance(params, dict) else {},
                'created_at': row.get('created_at', ''),
                'updated_at': row.get('updated_at', ''),
            })
            items.append(item)
    return items


def write_strategies(items):
    """写入所有策略方案。"""
    ensure_strategies_file()
    with open(STRATEGIES_FILE, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['strategy_id', 'name', 'type', 'version', 'params', 'created_at', 'updated_at'])
        for item in items:
            normalized = normalize_strategy_record(item)
            writer.writerow([
                normalized.get('strategy_id', ''),
                normalized.get('name', ''),
                'strategy_plan',
                '1',
                json.dumps({
                    'scope': normalized.get('scope', 'single_fund_analysis'),
                    'fund_code': normalized.get('fund_code', ''),
                    'fund_name': normalized.get('fund_name', ''),
                    'date_range': normalized.get('date_range', default_strategy_date_range()),
                    'stack': normalized.get('stack', []),
                    'backtest_config': normalized.get('backtest_config') or {},
                    'signal_overrides': normalized.get('signal_overrides') or [],
                }, ensure_ascii=False),
                normalized.get('created_at', ''),
                normalized.get('updated_at', ''),
            ])


def default_strategy_date_range():
    today = date.today()
    return {
        'preset': '6m',
        'start_date': (today - timedelta(days=180)).isoformat(),
        'end_date': today.isoformat(),
        'full_history': False,
    }


def normalize_strategy_date_range(value):
    default = default_strategy_date_range()
    if not isinstance(value, dict):
        return default

    preset = str(value.get('preset') or default['preset']).strip() or default['preset']
    start_date = str(value.get('start_date') or '').strip()
    end_date = str(value.get('end_date') or '').strip()
    full_history = bool(value.get('full_history')) or preset == 'all'

    if full_history:
        return {
            'preset': 'all',
            'start_date': '',
            'end_date': '',
            'full_history': True,
        }

    resolved_start, resolved_end = resolve_date_range(start_date or None, end_date or None)
    return {
        'preset': preset,
        'start_date': resolved_start,
        'end_date': resolved_end,
        'full_history': False,
    }


def resolve_date_range(start_date: str | None, end_date: str | None, full_history: bool = False) -> tuple[str | None, str | None]:
    if full_history:
        return None, None
    today = date.today()
    resolved_end = end_date or today.isoformat()
    resolved_start = start_date or (today - timedelta(days=180)).isoformat()
    return resolved_start, resolved_end


def build_strategy_detail_bootstrap(item=None, not_found: bool = False, strategy_id: str = ''):
    record = normalize_strategy_record(item or {}) if item else None
    return {
        'mode': 'edit' if record else 'create',
        'not_found': not_found,
        'strategy_id': record.get('strategy_id', '') if record else strategy_id,
        'strategy': record,
    }


def normalize_strategy_record(item):
    item = item or {}
    item_type = str(item.get('type') or '').strip()
    params = item.get('params') if isinstance(item.get('params'), dict) else {}

    if item_type == 'strategy_plan':
        raw_stack = params.get('stack') if isinstance(params.get('stack'), list) else item.get('stack')
        stack = strategy_registry.validate_stack(raw_stack or [])
        backtest_config = params.get('backtest_config') if isinstance(params.get('backtest_config'), dict) else item.get('backtest_config')
        signal_overrides = params.get('signal_overrides') if isinstance(params.get('signal_overrides'), list) else item.get('signal_overrides')
        return {
            'strategy_id': item.get('strategy_id', ''),
            'name': item.get('name', ''),
            'type': 'strategy_plan',
            'strategy_kind': 'composite',
            'version': 1,
            'scope': params.get('scope') or item.get('scope') or 'single_fund_analysis',
            'fund_code': str(params.get('fund_code') or item.get('fund_code') or '').strip(),
            'fund_name': str(params.get('fund_name') or item.get('fund_name') or '').strip(),
            'date_range': normalize_strategy_date_range(params.get('date_range') if isinstance(params.get('date_range'), dict) else item.get('date_range')),
            'stack': stack,
            'backtest_config': backtest_config if isinstance(backtest_config, dict) else {},
            'signal_overrides': signal_overrides if isinstance(signal_overrides, list) else [],
            'created_at': item.get('created_at', ''),
            'updated_at': item.get('updated_at', ''),
        }

    legacy_type = item_type
    stack = []
    if legacy_type:
        strategy = strategy_registry.get(legacy_type)
        if strategy is not None:
            stack.append({
                'strategy_type': legacy_type,
                'enabled': True,
                'display_enabled': True,
                'params': strategy.normalize_params(params),
            })
    return {
        'strategy_id': item.get('strategy_id', ''),
        'name': item.get('name', ''),
        'type': 'strategy_plan',
        'version': 1,
        'scope': 'single_fund_analysis',
        'fund_code': '',
        'fund_name': '',
        'date_range': normalize_strategy_date_range(None),
        'stack': stack,
        'backtest_config': {},
        'signal_overrides': [],
        'created_at': item.get('created_at', ''),
        'updated_at': item.get('updated_at', ''),
    }


def build_strategy_plan_payload(data):
    name = str(data.get('name', '')).strip()
    if not name:
        raise ValueError('方案名称不能为空')

    stack = data.get('stack')
    if not isinstance(stack, list) or not stack:
        raise ValueError('至少需要一个策略')

    try:
        normalized_stack = strategy_registry.validate_stack(stack)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc

    fund_code = str(data.get('fund_code') or '').strip()
    fund_name = str(data.get('fund_name') or '').strip()
    backtest_config = data.get('backtest_config') if isinstance(data.get('backtest_config'), dict) else {}
    signal_overrides = data.get('signal_overrides') if isinstance(data.get('signal_overrides'), list) else []

    return {
        'name': name,
        'scope': str(data.get('scope') or 'single_fund_analysis'),
        'fund_code': fund_code,
        'fund_name': fund_name,
        'date_range': normalize_strategy_date_range(data.get('date_range')),
        'stack': normalized_stack,
        'backtest_config': backtest_config,
        'signal_overrides': signal_overrides,
    }


# =====================
# 基金仓库实例
# =====================
ensure_datasources_file()
ensure_favorite_groups_file()
ensure_favorite_group_memberships_file()
ensure_favorites_default_group_memberships()
ensure_strategies_file()
fund_repository = FundRepository()


# =====================
# 数据源管理 API
# =====================

@app.route('/api/datasources/types', methods=['GET'])
def get_datasource_types():
    """获取支持的数据源类型"""
    return jsonify(get_available_types())


@app.route('/api/datasources', methods=['GET'])
def list_datasources():
    """获取所有数据源"""
    datasources = read_datasources()
    # 不返回敏感配置信息（密码、token）
    safe_datasources = []
    for ds in datasources:
        safe_ds = {
            'id': ds['id'],
            'name': ds['name'],
            'type': ds['type'],
            'is_active': ds['is_active'],
            'is_builtin': is_builtin_datasource(ds)
        }
        safe_datasources.append(safe_ds)
    return jsonify(safe_datasources)


@app.route('/api/datasources', methods=['POST'])
def add_datasource():
    """添加数据源"""
    data = request.get_json()
    if not data or 'name' not in data or 'type' not in data or 'config' not in data:
        return jsonify({'error': '缺少必要字段'}), 400
    
    datasources = read_datasources()
    if data['type'] == DEFAULT_DATASOURCE_TYPE:
        return jsonify({'error': '默认数据源由系统内置管理，不能重复添加'}), 400

    new_ds = {
        'id': get_next_datasource_id(),
        'name': data['name'],
        'type': data['type'],
        'config': data['config'],
        'is_active': False
    }
    datasources.append(new_ds)
    write_datasources(datasources)
    
    return jsonify({'success': True, 'id': new_ds['id']})


@app.route('/api/datasources/<int:ds_id>', methods=['GET'])
def get_datasource(ds_id):
    """获取单个数据源详情（含配置，用于编辑）"""
    datasources = read_datasources()
    for ds in datasources:
        if ds['id'] == ds_id:
            return jsonify({**ds, 'is_builtin': is_builtin_datasource(ds)})
    return jsonify({'error': '数据源不存在'}), 404


@app.route('/api/datasources/<int:ds_id>', methods=['PUT'])
def update_datasource(ds_id):
    """编辑数据源"""
    data = request.get_json()
    if not data:
        return jsonify({'error': '缺少数据'}), 400
    
    datasources = read_datasources()
    for ds in datasources:
        if ds['id'] == ds_id:
            if 'name' in data:
                ds['name'] = data['name']
            if 'config' in data:
                ds['config'] = data['config']
            write_datasources(datasources)
            fund_repository.reload_datasource()
            return jsonify({'success': True})
    
    return jsonify({'error': '数据源不存在'}), 404


@app.route('/api/datasources/<int:ds_id>', methods=['DELETE'])
def delete_datasource(ds_id):
    """删除数据源"""
    datasources = read_datasources()
    target = next((ds for ds in datasources if ds['id'] == ds_id), None)
    if target is None:
        return jsonify({'error': '数据源不存在'}), 404
    if is_builtin_datasource(target):
        return jsonify({'error': '默认数据源不允许删除'}), 400

    new_datasources = [ds for ds in datasources if ds['id'] != ds_id]
    write_datasources(new_datasources)
    fund_repository.reload_datasource()
    return jsonify({'success': True})


@app.route('/api/datasources/<int:ds_id>/activate', methods=['POST'])
def activate_datasource(ds_id):
    """激活数据源（自动停用其他）"""
    datasources = read_datasources()
    found = False
    
    for ds in datasources:
        if ds['id'] == ds_id:
            ds['is_active'] = True
            found = True
        else:
            ds['is_active'] = False
    
    if not found:
        return jsonify({'error': '数据源不存在'}), 404
    
    write_datasources(datasources)
    fund_repository.reload_datasource()
    # 数据源切换后，强制清空本地缓存，避免继续返回旧数据
    try:
        fund_repository.clear_local_caches()
    except Exception:
        pass
    return jsonify({'success': True})


@app.route('/api/datasources/<int:ds_id>/deactivate', methods=['POST'])
def deactivate_datasource(ds_id):
    """停用数据源"""
    datasources = read_datasources()
    found = False
    
    for ds in datasources:
        if ds['id'] == ds_id:
            ds['is_active'] = False
            found = True
            break
    
    if not found:
        return jsonify({'error': '数据源不存在'}), 404
    
    write_datasources(datasources)
    fund_repository.reload_datasource()
    # 停用后同样清空本地缓存，避免继续展示旧数据
    try:
        fund_repository.clear_local_caches()
    except Exception:
        pass
    return jsonify({'success': True})


@app.route('/api/datasources/<int:ds_id>/test', methods=['POST'])
def test_datasource(ds_id):
    """测试数据源连接"""
    datasources = read_datasources()
    
    for ds in datasources:
        if ds['id'] == ds_id:
            try:
                source = create_datasource(ds['type'], ds['config'])
                items = source.get_fund_list()
                return jsonify({"success": True, "message": "连接成功", "count": min(len(items), 5)})
            except Exception as e:
                return jsonify({'success': False, 'message': str(e), 'count': 0})
    
    return jsonify({'error': '数据源不存在'}), 404


# =====================
# 设置 API
# =====================

@app.route('/api/settings', methods=['GET'])
def get_settings():
    """获取全局设置"""
    settings = read_settings()
    return jsonify(settings)


@app.route('/api/settings', methods=['PUT'])
def update_settings():
    """更新全局设置"""
    data = request.get_json()
    if not data:
        return jsonify({'error': '缺少数据'}), 400
    
    settings = read_settings()
    settings.update(data)
    write_settings(settings)
    return jsonify({'success': True})


# =====================
# AI 选基（第 1 步：解析提示词为 draft）
# =====================

@app.route('/api/ai-fund-pick/parse', methods=['POST'])
def ai_fund_pick_parse_prompt():
    """将用户筛选提示词解析为 draft JSON（仅解析，不做筛选/不做能力裁剪）。"""
    data = request.get_json(silent=True) or {}
    prompt = ""
    if isinstance(data, dict):
        prompt = str(data.get('prompt') or '').strip()
    if not prompt:
        return jsonify({'success': False, 'message': '提示词不能为空'}), 400
    if len(prompt) > 2000:
        return jsonify({'success': False, 'message': '提示词过长（建议不超过 2000 字符）'}), 400

    settings = read_settings()
    provider = str(settings.get('llm_provider') or '').strip()
    api_key = str(settings.get('llm_api_key') or '').strip()
    model = str(settings.get('llm_model') or '').strip()
    base_url = str(settings.get('llm_base_url') or '').strip()

    if not provider or not api_key:
        return jsonify({'success': False, 'message': '请先在「设置」页配置 AI 模型（provider/api_key）'}), 400

    try:
        draft = parse_fund_pick_prompt(prompt, {
            'provider': provider,
            'api_key': api_key,
            'model': model,
            'base_url': base_url,
        })
        missing_items = build_missing_items(draft)
        if missing_items:
            return jsonify({
                'success': True,
                'need_clarify': True,
                'round': 0,
                'missing_items': missing_items,
                'missing_signature': missing_signature(missing_items),
                'draft_preview': draft,
            })
        return jsonify({'success': True, 'need_clarify': False, 'round': 0, 'draft': draft})
    except FundPickParseError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        msg = str(e) or '解析失败'
        return jsonify({'success': False, 'message': msg[:500]}), 400


@app.route('/api/ai-fund-pick/parse/refine', methods=['POST'])
def ai_fund_pick_parse_refine():
    """提交边界补全信息后，二次调用 LLM 重新生成草案。"""
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'success': False, 'message': '无效请求'}), 400

    prompt = str(data.get('prompt') or '').strip()
    draft_preview = data.get('draft_preview')
    missing_items = data.get('missing_items')
    user_fills = data.get('user_fills')
    round_num = int(data.get('round') or 0)
    prev_signature = str(data.get('prev_missing_signature') or '').strip()

    if not prompt:
        return jsonify({'success': False, 'message': '提示词不能为空'}), 400
    if not isinstance(draft_preview, dict):
        return jsonify({'success': False, 'message': 'draft_preview 无效'}), 400
    if not isinstance(missing_items, list):
        return jsonify({'success': False, 'message': 'missing_items 无效'}), 400
    if not isinstance(user_fills, list):
        return jsonify({'success': False, 'message': 'user_fills 无效'}), 400

    # 最多 3 轮补全（A 策略：超限失败）
    if round_num >= 3:
        return jsonify({'success': False, 'message': '边界仍不明确，已达补全次数上限（3轮），请在提示词中补充关键阈值/时间窗口后再试', 'missing_items': missing_items}), 400

    # 校验 fills：必须覆盖 required 项，且 item_id 必须在 missing_items 中
    mi_map = {str(x.get('item_id')): x for x in missing_items if isinstance(x, dict) and x.get('item_id')}
    fills_map = {}
    for it in user_fills:
        if not isinstance(it, dict):
            continue
        item_id = str(it.get('item_id') or '').strip()
        if not item_id or item_id not in mi_map:
            return jsonify({'success': False, 'message': '包含未知的缺失项 item_id'}), 400
        val = it.get('value')
        if val is None or str(val).strip() == '':
            continue
        fills_map[item_id] = str(val).strip()

    for item_id, mi in mi_map.items():
        if mi.get('required') and item_id not in fills_map:
            title = str(mi.get('metric_name') or '') + ':' + str(mi.get('field') or '')
            return jsonify({'success': False, 'message': f'请先补全必填项：{title}'}), 400

    # 组装补充说明（给 LLM）
    lines = []
    for item_id, mi in mi_map.items():
        v = fills_map.get(item_id, '')
        if not v:
            continue
        metric = str(mi.get('metric_name') or '').strip()
        field = str(mi.get('field') or '').strip()
        if field == 'window':
            lines.append(f"「{metric}」的时间窗口 = {v}")
        elif field == 'value':
            lines.append(f"「{metric}」的阈值/区间 = {v}")
        elif field == 'limit':
            # TopN 必须为正整数
            try:
                n = int(str(v).strip())
                if n <= 0 or n > 500:
                    return jsonify({'success': False, 'message': 'TopN 必须为 1-500 的正整数'}), 400
            except Exception:
                return jsonify({'success': False, 'message': 'TopN 必须为正整数'}), 400
            lines.append(f"TopN = {n}")
        else:
            lines.append(f"「{metric}」补充 {field} = {v}")
    supplement = "；".join(lines) if lines else "（无）"

    settings = read_settings()
    provider = str(settings.get('llm_provider') or '').strip()
    api_key = str(settings.get('llm_api_key') or '').strip()
    model = str(settings.get('llm_model') or '').strip()
    base_url = str(settings.get('llm_base_url') or '').strip()
    if not provider or not api_key:
        return jsonify({'success': False, 'message': '请先在「设置」页配置 AI 模型（provider/api_key）'}), 400

    try:
        draft2 = parse_fund_pick_prompt_refine(prompt, supplement, draft_preview, {
            'provider': provider,
            'api_key': api_key,
            'model': model,
            'base_url': base_url,
        })
        missing2 = build_missing_items(draft2)
        sig2 = missing_signature(missing2)

        # 防止死循环：签名不变则失败
        if prev_signature and sig2 and prev_signature == sig2:
            return jsonify({'success': False, 'message': '补全后缺失项仍未变化，请在提示词中补充更明确的阈值/时间窗口', 'missing_items': missing2}), 400

        if missing2:
            next_round = round_num + 1
            if next_round >= 3:
                return jsonify({'success': False, 'message': '边界仍不明确，已达补全次数上限（3轮），请在提示词中补充关键阈值/时间窗口后再试', 'missing_items': missing2}), 400
            return jsonify({
                'success': True,
                'need_clarify': True,
                'round': next_round,
                'missing_items': missing2,
                'missing_signature': sig2,
                'draft_preview': draft2,
            })
        return jsonify({'success': True, 'need_clarify': False, 'round': round_num + 1, 'draft': draft2})
    except FundPickParseError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)[:500]}), 400


# AI 选基（第 2 步：将 draft 编译为可执行 plan）
@app.route('/api/ai-fund-pick/plan', methods=['POST'])
def ai_fund_pick_build_plan():
    try:
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({"success": False, "message": "请求体无效"}), 400

        draft = data.get("draft")
        if not isinstance(draft, dict) or not draft:
            return jsonify({"success": False, "message": "draft 缺失或无效"}), 400

        settings = read_settings()
        provider = str(settings.get('llm_provider') or '').strip()
        api_key = str(settings.get('llm_api_key') or '').strip()
        model = str(settings.get('llm_model') or '').strip()
        base_url = str(settings.get('llm_base_url') or '').strip()
        if not provider or not api_key:
            return jsonify({'success': False, 'message': '请先在「设置」页配置 AI 模型（provider/api_key）'}), 400

        plan = build_fund_pick_plan(draft, CAPABILITIES_V1, {
            "provider": provider,
            "api_key": api_key,
            "model": model,
            "base_url": base_url,
        })
        return jsonify({"success": True, "plan": plan})
    except FundPickPlanError as e:
        return jsonify({"success": False, "message": str(e)}), 400
    except Exception as e:
        return jsonify({"success": False, "message": str(e)[:500]}), 400


# =====================
# 缓存 API
# =====================

@app.route('/api/cache/info', methods=['GET'])
def get_cache_info():
    """获取缓存状态"""
    info = fund_repository.get_cache_info()
    return jsonify(info)


@app.route('/api/cache/refresh', methods=['POST'])
def refresh_cache():
    """手动刷新缓存"""
    try:
        data = fund_repository.refresh()
        return jsonify({'success': True, 'count': len(data)})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})


# =====================
# 基金数据 API
# =====================

FUND_TYPE_OPTIONS_EASTMONEY = [
    {"fund_type_code": "0", "fund_type_name": "全部"},
    {"fund_type_code": "25", "fund_type_name": "股票型"},
    {"fund_type_code": "27", "fund_type_name": "混合型"},
    {"fund_type_code": "26", "fund_type_name": "指数型"},
    {"fund_type_code": "31", "fund_type_name": "债券型"},
    {"fund_type_code": "35", "fund_type_name": "货币型"},
    {"fund_type_code": "15", "fund_type_name": "FOF"},
    {"fund_type_code": "6", "fund_type_name": "QDII"},
    {"fund_type_code": "3", "fund_type_name": "ETF"},
    {"fund_type_code": "33", "fund_type_name": "ETF联接"},
    {"fund_type_code": "4", "fund_type_name": "LOF"},
]

FUND_TYPE_NAME_BY_CODE_EASTMONEY = {x["fund_type_code"]: x["fund_type_name"] for x in FUND_TYPE_OPTIONS_EASTMONEY}


@app.route('/api/funds/types', methods=['GET'])
def get_fund_types():
    """获取基金类型选项（用于前端下拉筛选）。"""
    try:
        # 仅保留 Default 数据源后：基金榜使用“基金排名”接口（FundType 枚举）
        return jsonify({"success": True, "items": FUND_TYPE_OPTIONS_EASTMONEY})
    except Exception as e:
        return jsonify({"success": False, "message": str(e), "items": []}), 500


@app.route('/api/funds/all-codes', methods=['GET'])
def get_funds_all_codes():
    """获取全量基金代码列表（用于遍历候选集）。"""
    try:
        items = fund_repository.get_fund_list()
        out = []
        for x in items or []:
            if not isinstance(x, dict):
                continue
            code = str(x.get("fund_code") or "").strip()
            name = str(x.get("fund_name") or "").strip()
            if not code:
                continue
            out.append({"fund_code": code, "fund_name": name})
        return jsonify({"success": True, "items": out})
    except Exception as e:
        return jsonify({"success": False, "message": str(e), "items": []}), 500


@app.route('/api/funds/overview-batch', methods=['POST'])
def get_fund_overview_batch():
    """
    批量获取基金详情（overview items）。

    入参：{"fund_codes":[...]}（单次最多 100）
    返回：{success, items_by_code, errors}
    """
    try:
        payload = request.get_json(silent=True) or {}
        codes = payload.get("fund_codes")
        if not isinstance(codes, list):
            return jsonify({"success": False, "message": "fund_codes 必须为数组", "items_by_code": {}, "errors": {}}), 400

        fund_codes: list[str] = []
        for c in codes:
            s = str(c or "").strip()
            if s:
                fund_codes.append(s)

        if len(fund_codes) > 100:
            return jsonify({"success": False, "message": "fund_codes 单次最多 100", "items_by_code": {}, "errors": {}}), 400

        items_by_code: dict[str, list] = {}
        errors: dict[str, str] = {}

        if len(fund_codes) == 0:
            return jsonify({"success": True, "items_by_code": items_by_code, "errors": errors})

        def _fetch_one(code: str):
            return fund_repository.get_fund_overview(code)

        with ThreadPoolExecutor(max_workers=12) as ex:
            future_map = {ex.submit(_fetch_one, code): code for code in fund_codes}
            for fut in as_completed(future_map):
                code = future_map[fut]
                try:
                    raw = fut.result()
                    # 统一成 list items（与 /api/funds/<code>/overview 输出一致）
                    items = raw if isinstance(raw, list) else []
                    items_by_code[code] = items
                except Exception as e:
                    errors[code] = str(e)

        return jsonify({"success": True, "items_by_code": items_by_code, "errors": errors})
    except Exception as e:
        return jsonify({"success": False, "message": str(e), "items_by_code": {}, "errors": {}}), 500


@app.route('/api/funds', methods=['GET'])
def get_funds():
    """获取基金列表"""
    try:
        # 完全分页：始终返回分页对象
        page_num_raw = (request.args.get('pageNum') or '').strip()
        page_size_raw = (request.args.get('pageSize') or '').strip()
        q = (request.args.get('q') or '').strip()
        fund_type_code = (request.args.get('fund_type_code') or '').strip() or "0"

        page_num = int(page_num_raw or 1)
        page_size = int(page_size_raw or 50)
        if page_num < 1:
            page_num = 1
        if page_size < 1:
            page_size = 1
        if page_size > 200:
            page_size = 200

        # 仅保留 Default 数据源后：基金榜列表改为“基金排名”接口（按日涨跌幅排序）
        # FundType：沿用东财枚举（0=全部）
        try:
            eastmoney_fund_type = int(fund_type_code or 0)
        except ValueError:
            eastmoney_fund_type = 0

        # DefaultDataSource.get_fund_rank_page
        items, total = fund_repository.default_datasource.get_fund_rank_page(
            page_num=page_num,
            page_size=page_size,
            fund_type=eastmoney_fund_type,
        )

        # 仅做 q 过滤（过滤后 total 退化为当前页数量）
        if q:
            items = [
                x for x in (items or [])
                if (q in str(x.get('fund_code', '') or '')) or (q in str(x.get('fund_name', '') or ''))
            ]
            total = len(items)

        # 统一输出 fund_type_code/name（按筛选项）
        type_name = FUND_TYPE_NAME_BY_CODE_EASTMONEY.get(str(eastmoney_fund_type), "")
        normalized_items = []
        for x in (items or []):
            row = dict(x)
            row["fund_type_code"] = str(eastmoney_fund_type)
            row["fund_type_name"] = type_name
            row.pop("fund_type", None)
            normalized_items.append(row)

        return jsonify({
            'success': True,
            'pageNum': page_num,
            'pageSize': page_size,
            'total': total,
            'items': normalized_items,
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/funds/search', methods=['GET'])
def search_funds():
    """根据关键字搜索基金（基于基金列表接口数据，不再直连 fundcode_search.js，也不维护独立搜索缓存）。"""
    try:
        q = str((request.args.get('q') or '')).strip()
        limit_raw = str((request.args.get('limit') or '')).strip()
        try:
            limit = int(limit_raw or 20)
        except ValueError:
            limit = 20
        if limit < 1:
            limit = 1
        if limit > 50:
            limit = 50

        if not q:
            return jsonify({"success": True, "q": q, "limit": limit, "items": [], "cached_until": ""})

        funds = fund_repository.get_fund_list()
        q_lower = q.lower()

        matched = []
        for it in funds:
            code = str(it.get("fund_code") or "")
            name = str(it.get("fund_name") or "")
            if (q_lower in code.lower()) or (q_lower in name.lower()):
                matched.append({
                    "fund_code": code,
                    "fund_name": name,
                    "fund_type": str(it.get("fund_type") or ""),
                })
                if len(matched) >= limit:
                    break

        return jsonify({
            "success": True,
            "q": q,
            "limit": limit,
            "items": matched,
            # 不再维护独立的 15:00 搜索缓存：由基金列表缓存策略接管
            "cached_until": "",
        })
    except Exception as e:
        return jsonify({"success": False, "message": str(e), "items": []}), 500


@app.route('/api/funds/<fund_code>/history', methods=['GET'])
def get_fund_history(fund_code):
    """获取单只基金历史净值序列。"""
    try:
        full_history = (request.args.get('full_history') or '').strip().lower() in {'1', 'true', 'yes'}
        start_date, end_date = resolve_date_range(
            (request.args.get('start_date') or '').strip() or None,
            (request.args.get('end_date') or '').strip() or None,
            full_history=full_history,
        )
        data = fund_repository.get_fund_history(fund_code, start_date, end_date)
        return jsonify({
            'success': True,
            'fund_code': fund_code,
            'items': data,
            'count': len(data),
            'start_date': start_date,
            'end_date': end_date,
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/funds/<fund_code>/gz', methods=['GET'])
def get_fund_gz(fund_code):
    """获取单只基金实时估值（主要返回涨跌幅 percentage）"""
    try:
        data = fund_repository.get_fund_gz(fund_code)
        return jsonify({
            'success': True,
            'fund_code': data.get('fund_code', fund_code),
            'percentage': data.get('percentage'),
            'gztime': data.get('gztime'),
            'gz_time': data.get('gz_time'),
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/funds/gz', methods=['GET'])
def get_funds_gz():
    """
    获取基金实时涨跌幅（percentage）

    用法：
    1) 批量：/api/funds/gz?codes=167703,005827
    2) 默认全部（分页+筛选）：/api/funds/gz?page=1&page_size=50&q=...&fund_type=...
    """
    try:
        codes = (request.args.get('codes') or '').strip()
        if codes:
            code_list = [c.strip() for c in codes.split(',') if c.strip()]
            items = fund_repository.get_fund_gz_batch(code_list)
            # 对外只返回 fund_code + percentage（失败条目带 error）
            output_items = []
            for item in items:
                row = {
                    'fund_code': item.get('fund_code', ''),
                    'percentage': item.get('percentage', None),
                    'gz_time': item.get('gz_time', None),
                }
                if item.get('error'):
                    row['error'] = item.get('error')
                output_items.append(row)
            return jsonify({'success': True, 'items': output_items})

        # 默认“全部”：从基金列表筛选分页后再批量取估值
        q = (request.args.get('q') or '').strip()
        fund_type = (request.args.get('fund_type') or '').strip()
        page = int(request.args.get('page') or 1)
        page_size = int(request.args.get('page_size') or 50)
        if page < 1:
            page = 1
        if page_size < 1:
            page_size = 1
        if page_size > 200:
            page_size = 200

        funds = fund_repository.get_fund_list()
        filtered = []
        for f in funds:
            code = str(f.get('fund_code', '') or '')
            name = str(f.get('fund_name', '') or '')
            ftype = str(f.get('fund_type', '') or '')

            if fund_type and ftype != fund_type:
                continue
            if q and (q not in code) and (q not in name):
                continue
            filtered.append(f)

        total = len(filtered)
        start = (page - 1) * page_size
        end = start + page_size
        page_funds = filtered[start:end]
        page_codes = [str(x.get('fund_code', '') or '').strip() for x in page_funds if str(x.get('fund_code', '') or '').strip()]

        items = fund_repository.get_fund_gz_batch(page_codes)
        output_items = []
        for item in items:
            row = {
                'fund_code': item.get('fund_code', ''),
                'percentage': item.get('percentage', None),
                'gz_time': item.get('gz_time', None),
            }
            if item.get('error'):
                row['error'] = item.get('error')
            output_items.append(row)

        return jsonify({
            'success': True,
            'page': page,
            'page_size': page_size,
            'total': total,
            'items': output_items,
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/funds/<fund_code>/holdings/dates', methods=['GET'])
def get_fund_holding_dates(fund_code):
    """获取基金持仓公布日期列表"""
    try:
        dates = fund_repository.get_fund_holding_dates(fund_code)
        return jsonify({
            'success': True,
            'data': {
                'fund_code': fund_code,
                'dates': dates,
            },
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/funds/<fund_code>/holdings', methods=['GET'])
def get_fund_holdings(fund_code):
    """获取基金某日期的持仓明细"""
    try:
        report_date = (request.args.get('report_date') or '').strip()
        if not report_date:
            return jsonify({'success': False, 'message': 'report_date 参数必填'}), 400

        holdings = fund_repository.get_fund_holdings(fund_code, report_date)
        return jsonify({
            'success': True,
            'data': {
                'fund_code': fund_code,
                'report_date': report_date,
                **holdings,
            },
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/funds/<fund_code>/overview', methods=['GET'])
def get_fund_overview(fund_code):
    """获取单只基金基本信息"""
    try:
        raw = fund_repository.get_fund_overview(fund_code)

        # 统一输出 items（KV 数组），兼容：
        # - 新数据源直接返回 items(list)
        # - 旧数据源返回扁平 dict
        items = []
        if isinstance(raw, list):
            items = raw
        elif isinstance(raw, dict):
            for k, v in raw.items():
                items.append({
                    "section": "JJXQ",
                    "section_name": "基金详情",
                    "key": str(k),
                    "label": str(k),
                    "value": "--" if v is None or str(v).strip() == "" else str(v),
                })
        else:
            items = []

        return jsonify({'success': True, 'fund_code': fund_code, 'items': items})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/funds/<fund_code>/ai-analysis', methods=['POST'])
def fund_ai_analysis(fund_code):
    """AI 一键基金分析"""
    try:
        from warehouse.analysis import run_fund_analysis, clear_analysis_cache

        force = (request.args.get('force') or '').strip().lower() in {'1', 'true', 'yes'}
        if force:
            clear_analysis_cache(fund_code)

        settings = read_settings()
        result = run_fund_analysis(fund_code, fund_repository, settings)
        return jsonify({'success': True, 'data': result})
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


# ===== AI 分析任务（带进度）=====
# 说明：当前实现为进程内内存任务队列，适用于单进程 Flask 启动方式（重启会丢失进行中的任务）。
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor


class _AiAnalysisJobStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._jobs = {}

    def create(self, fund_code: str) -> dict:
        job_id = uuid.uuid4().hex
        now = time.time()
        job = {
            "job_id": job_id,
            "fund_code": fund_code,
            "status": "pending",  # pending|running|done|error
            "percent": 0,
            "current_step": {"key": "validate", "label": "校验输入与配置", "message": "准备开始..."},
            "steps": [],
            "result": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
        }
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, patch: dict):
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.update(patch)
            job["updated_at"] = time.time()


_ai_analysis_jobs = _AiAnalysisJobStore()
_ai_analysis_executor = ThreadPoolExecutor(max_workers=4)


def _build_steps_snapshot():
    # 与前端 AiPick._stepDefs 保持一致（key 稳定）
    return [
        {"key": "validate", "label": "校验输入与配置"},
        {"key": "cache", "label": "检查缓存"},
        {"key": "fetch_base", "label": "拉取基础数据"},
        {"key": "fetch_holdings", "label": "拉取持仓明细"},
        {"key": "compute", "label": "计算量化指标"},
        {"key": "summary", "label": "组装分析摘要"},
        {"key": "llm", "label": "调用模型分析"},
        {"key": "parse", "label": "解析分析结果"},
        {"key": "done", "label": "完成"},
    ]


@app.route('/api/funds/<fund_code>/ai-analysis/jobs', methods=['POST'])
def create_fund_ai_analysis_job(fund_code):
    """创建 AI 分析任务（异步 + 进度）"""
    try:
        import re
        from warehouse.analysis import run_fund_analysis, clear_analysis_cache

        code = str(fund_code or "").strip()
        if not re.fullmatch(r"\d{5,8}", code):
            return jsonify({"success": False, "message": "基金代码格式错误（需 5-8 位数字）"}), 400

        payload = request.get_json(silent=True) or {}
        force = bool(payload.get("force")) if isinstance(payload, dict) else False
        if force:
            clear_analysis_cache(code)

        job = _ai_analysis_jobs.create(code)
        job_id = job["job_id"]
        _ai_analysis_jobs.update(job_id, {"steps": _build_steps_snapshot()})

        settings = read_settings()

        def progress_cb(**kwargs):
            key = str(kwargs.get("key") or "").strip()
            label = str(kwargs.get("label") or "").strip()
            message = str(kwargs.get("message") or "").strip()
            percent = kwargs.get("percent")
            try:
                percent = int(percent)
            except Exception:
                percent = 0
            percent = max(0, min(100, percent))
            _ai_analysis_jobs.update(job_id, {
                "status": "running",
                "percent": percent,
                "current_step": {"key": key, "label": label, "message": message},
            })

        def task():
            try:
                _ai_analysis_jobs.update(job_id, {"status": "running"})
                result = run_fund_analysis(code, fund_repository, settings, progress_cb=progress_cb)
                _ai_analysis_jobs.update(job_id, {
                    "status": "done",
                    "percent": 100,
                    "current_step": {"key": "done", "label": "完成", "message": "分析完成"},
                    "result": result,
                })
            except Exception as e:
                _ai_analysis_jobs.update(job_id, {
                    "status": "error",
                    "error": {"message": str(e)},
                })

        _ai_analysis_executor.submit(task)

        return jsonify({"success": True, "job_id": job_id, "fund_code": code})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/ai-analysis/jobs/<job_id>', methods=['GET'])
def get_fund_ai_analysis_job(job_id):
    """获取 AI 分析任务进度与结果"""
    job = _ai_analysis_jobs.get(str(job_id or "").strip())
    if not job:
        return jsonify({"success": False, "message": "任务不存在或已过期"}), 404

    # 返回必要字段，避免暴露内部时间戳等无用信息
    return jsonify({
        "success": True,
        "job_id": job.get("job_id"),
        "fund_code": job.get("fund_code"),
        "status": job.get("status"),
        "percent": job.get("percent", 0),
        "current_step": job.get("current_step") or {},
        "steps": job.get("steps") or [],
        "result": job.get("result"),
        "error": job.get("error"),
    })


@app.route('/api/llm/providers', methods=['GET'])
def get_llm_providers():
    """获取可用的 LLM 提供商列表"""
    try:
        from warehouse.llm import get_available_llm_types
        return jsonify({'success': True, 'items': get_available_llm_types()})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@app.route('/api/llm/models', methods=['POST'])
def list_llm_models():
    """动态从供应商拉取可用模型列表

    接收：{provider, api_key, base_url?}
    成功返回 {success: true, models: [id, ...], default_model}
    """
    try:
        from warehouse.llm import create_llm
    except Exception as e:
        return jsonify({'success': False, 'message': f'初始化失败: {e}'}), 500

    data = request.get_json(silent=True) or {}
    provider = str(data.get('provider') or '').strip()
    api_key = str(data.get('api_key') or '').strip()
    base_url = str(data.get('base_url') or '').strip()

    if not provider:
        return jsonify({'success': False, 'message': '请选择模型提供商'}), 400
    if not api_key:
        return jsonify({'success': False, 'message': '请填写 API Key'}), 400

    try:
        llm = create_llm(provider, {
            'api_key': api_key,
            'base_url': base_url,
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': f'创建客户端失败: {e}'}), 500

    try:
        models = llm.list_models()
        return jsonify({
            'success': True,
            'models': sorted(models),
            'default_model': getattr(llm, 'DEFAULT_MODEL', ''),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


@app.route('/api/llm/test', methods=['POST'])
def test_llm_config():
    """测试 LLM 配置是否有效

    接收：{provider, api_key, model?, base_url?}
    成功返回 {success: true, reply}；失败返回 {success: false, message}。
    """
    try:
        from warehouse.llm import create_llm
    except Exception as e:
        return jsonify({'success': False, 'message': f'初始化失败: {e}'}), 500

    data = request.get_json(silent=True) or {}
    provider = str(data.get('provider') or '').strip()
    api_key = str(data.get('api_key') or '').strip()
    model = str(data.get('model') or '').strip()
    base_url = str(data.get('base_url') or '').strip()

    if not provider:
        return jsonify({'success': False, 'message': '请选择模型提供商'}), 400
    if not api_key:
        return jsonify({'success': False, 'message': '请填写 API Key'}), 400

    try:
        llm = create_llm(provider, {
            'api_key': api_key,
            'model': model,
            'base_url': base_url,
        })
    except ValueError as e:
        return jsonify({'success': False, 'message': str(e)}), 400
    except Exception as e:
        return jsonify({'success': False, 'message': f'创建客户端失败: {e}'}), 500

    try:
        reply = llm.chat(
            system_prompt="你是一个健康检查助手。请直接回复 OK，不要多余内容。",
            user_message="ping",
        )
        return jsonify({
            'success': True,
            'reply': (reply or '').strip()[:200],
            'model': getattr(llm, 'model', '') or getattr(llm, 'DEFAULT_MODEL', ''),
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 400


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
