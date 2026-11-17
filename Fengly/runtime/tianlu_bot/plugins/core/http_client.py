# -*- coding: utf-8 -*-
"""
全局 HTTP 客户端（连接池 + HTTP/2 + keep-alive）
整个进程复用同一个 client，避免每次请求重新 TLS 握手
"""
import httpx

_http_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """获取全局单例 client"""
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=3.0),
            limits=httpx.Limits(
                max_keepalive_connections=50,
                max_connections=100,
                keepalive_expiry=60.0,
            ),
            http2=False,
            follow_redirects=True,
            headers={"Connection": "keep-alive"},
        )
    return _http_client


async def close_http_client():
    """关闭 client（在 bot 关闭时调用）"""
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None