#!/usr/bin/env python3
"""Identify which backend port received the request.

The routing check overlays .devcontainer/compose.yaml so Traefik still
routes to the `app` container's labeled ports. This process listens on
those ports and echoes the path it actually saw — that is how the suite
asserts strip-prefix and host matching.
"""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Port -> backend name. Must match loadbalancer.server.port on the
# Traefik labels in .devcontainer/compose.yaml.
BACKENDS: dict[int, str] = {
    3000: "web-host",
    4000: "web-admin",
    4100: "web-platform",
    8000: "api",
    8200: "image-server",
    8201: "admin-image-server",
}


def make_handler(backend: str, port: int) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "publira-routing-echo"
        sys_version = ""

        def do_GET(self) -> None:
            self._respond()

        def do_POST(self) -> None:
            self._respond()

        def do_HEAD(self) -> None:
            self._respond(write_body=False)

        def log_message(self, fmt: str, *args: object) -> None:
            # Compose captures stdout; keep one line per request for triage.
            print(f"{backend}:{port} {args[0] if args else fmt}", flush=True)

        def _respond(self, *, write_body: bool = True) -> None:
            payload = {
                "backend": backend,
                "port": port,
                "path": self.path,
                "host": self.headers.get("Host", ""),
                "method": self.command,
            }
            raw = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("X-Backend", backend)
            self.send_header("X-Backend-Port", str(port))
            self.end_headers()
            if write_body:
                self.wfile.write(raw)

    return Handler


def serve(port: int, name: str) -> None:
    httpd = ThreadingHTTPServer(("0.0.0.0", port), make_handler(name, port))
    httpd.serve_forever()


def main() -> None:
    threads: list[threading.Thread] = []
    for port, name in BACKENDS.items():
        thread = threading.Thread(target=serve, args=(port, name), daemon=True)
        thread.start()
        threads.append(thread)
        print(f"listening {name} on :{port}", flush=True)
    # The process is a daemon-thread pool; block on the first listener.
    threads[0].join()


if __name__ == "__main__":
    main()
