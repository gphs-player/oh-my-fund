from flask import Flask, render_template, jsonify, request
import os
import csv
import json

from warehouse import FundRepository
from warehouse.adapters import create_datasource, get_available_types

app = Flask(__name__)

# 市场列表文件路径
MARKETS_FILE = os.path.join(os.path.dirname(__file__), 'data', 'markets.csv')

# 默认市场列表
DEFAULT_MARKETS = ['美股', 'A股', '亚太', '港股', '全球']


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
DATASOURCES_FILE = os.path.join(os.path.dirname(__file__), 'data', 'datasources.csv')
SETTINGS_FILE = os.path.join(os.path.dirname(__file__), 'data', 'settings.csv')
INVESTMENTS_FILE = os.path.join(os.path.dirname(__file__), 'data', 'investments.csv')


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


def ensure_datasources_file():
    """确保数据源配置文件存在"""
    data_dir = os.path.dirname(DATASOURCES_FILE)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir)
    if not os.path.exists(DATASOURCES_FILE):
        with open(DATASOURCES_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['id', 'name', 'type', 'config', 'is_active'])


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
# 基金仓库实例
# =====================
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
            'is_active': ds['is_active']
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
    new_datasources = [ds for ds in datasources if ds['id'] != ds_id]
    
    if len(new_datasources) == len(datasources):
        return jsonify({'error': '数据源不存在'}), 404
    
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
    return jsonify({'success': True})


@app.route('/api/datasources/<int:ds_id>/test', methods=['POST'])
def test_datasource(ds_id):
    """测试数据源连接"""
    datasources = read_datasources()
    
    for ds in datasources:
        if ds['id'] == ds_id:
            try:
                source = create_datasource(ds['type'], ds['config'])
                result = source.test_connection()
                return jsonify(result)
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

@app.route('/api/funds', methods=['GET'])
def get_funds():
    """获取基金列表"""
    try:
        funds = fund_repository.get_fund_list()
        return jsonify(funds)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
