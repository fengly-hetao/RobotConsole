# -*- coding: utf-8 -*-
from nonebot.plugin import PluginMetadata

__plugin_meta__ = PluginMetadata(
    name="tools",
    description="实用工具：今日运势 / 天气 / 群友印象 / 今日一句 / 随机数",
    usage=(
        "@机器人 今日运势\n"
        "@机器人 天气 北京\n"
        "@机器人 群友印象 @某人\n"
        "@机器人 今日一句\n"
        "@机器人 骰3\n"
        "@机器人 随机数 1 100"
    ),
    type="application",
    supported_adapters={"~onebot.v11"},
)

from . import handler  # noqa: E402,F401
