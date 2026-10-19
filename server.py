#!/usr/bin/env python3
"""开发服务器：带 no-cache 头的静态文件服务。

项目使用 ES Module，必须通过 HTTP 访问（双击 index.html 会被浏览器
CORS 拦截）。本服务器禁用缓存，改完代码刷新即见最新版本。

用法:
    python3 server.py           # http://localhost:8643
    python3 server.py 9000      # 自定义端口
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8643
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    print(f'Serving {root}')
    print(f'  -> http://localhost:{port}')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()


if __name__ == '__main__':
    main()
