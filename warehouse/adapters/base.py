# 数据源基类
from typing import ClassVar


class BaseDataSource:
    """数据源基类，配置 + 初始化 + API 调用统一封装"""

    # 类型标识
    source_type: ClassVar[str] = ""
    # 显示名称
    source_label: ClassVar[str] = ""
    # 配置字段定义（供前端渲染表单）
    config_schema: ClassVar[list[dict]] = []

    def __init__(self, config: dict):
        """
        接收配置，完成初始化

        Args:
            config: 认证配置字典
        """
        self.config = config

    def test_connection(self) -> dict:
        """
        测试连接是否正常

        Returns:
            {"success": True/False, "message": "...", "count": 基金数量}
        """
        try:
            result = self.get_fund_list()
            return {"success": True, "message": "连接成功", "count": len(result)}
        except Exception as e:
            return {"success": False, "message": str(e), "count": 0}

    def get_fund_list(self) -> list[dict]:
        """
        获取基金列表

        Returns:
            [{"fund_code": "xxx", "fund_name": "xxx"}, ...]
        """
        raise NotImplementedError("子类必须实现 get_fund_list 方法")
