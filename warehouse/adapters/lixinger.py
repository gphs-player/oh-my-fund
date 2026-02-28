# 理杏仁数据源适配器
from .base import BaseDataSource
from .factory import register_datasource


@register_datasource
class LixingerDataSource(BaseDataSource):
    """理杏仁数据源"""

    source_type = "lixinger"
    source_label = "理杏仁"
    config_schema = [
        {"field": "token", "label": "Token", "type": "password", "required": True}
    ]

    def __init__(self, config: dict):
        super().__init__(config)
        self.token = config.get("token", "")
        # TODO: 初始化理杏仁客户端

    def get_fund_list(self) -> list[dict]:
        """
        获取基金列表

        Returns:
            [{"fund_code": "xxx", "fund_name": "xxx"}, ...]
        """
        # TODO: 实现理杏仁 API 调用
        # 目前返回模拟数据，待接入真实 API
        raise NotImplementedError("理杏仁 API 待实现，请先配置 token 并参考理杏仁文档")
