# Tushare 数据源适配器
from .base import BaseDataSource
from .factory import register_datasource


@register_datasource
class TushareDataSource(BaseDataSource):
    """Tushare 数据源"""

    source_type = "tushare"
    source_label = "Tushare"
    config_schema = [
        {"field": "username", "label": "用户名", "type": "text", "required": True},
        {"field": "password", "label": "密码", "type": "password", "required": True},
    ]

    def __init__(self, config: dict):
        super().__init__(config)
        self.username = config.get("username", "")
        self.password = config.get("password", "")
        # TODO: 初始化 Tushare 客户端

    def get_fund_list(self) -> list[dict]:
        """
        获取基金列表

        Returns:
            [{"fund_code": "xxx", "fund_name": "xxx"}, ...]
        """
        # TODO: 实现 Tushare API 调用
        # 目前返回模拟数据，待接入真实 API
        raise NotImplementedError("Tushare API 待实现，请先配置账户并参考 Tushare 文档")
