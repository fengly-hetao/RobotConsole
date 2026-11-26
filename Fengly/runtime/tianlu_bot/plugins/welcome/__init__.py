# -*- coding: utf-8 -*-
from nonebot.plugin import PluginMetadata

__plugin_meta__ = PluginMetadata(
    name="welcome",
    description="新人入群自动介绍机器人用法",
    usage="自动触发，无需指令。开关：FEATURE_WELCOME",
    type="application",
    supported_adapters={"~onebot.v11"},
)

from . import handler  # noqa: E402,F401