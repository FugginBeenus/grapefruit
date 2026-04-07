"""Grapefruit sidecar — JSON-RPC 2.0 server over stdin/stdout.

Reads JSON-RPC requests from stdin (one per line), dispatches to handlers,
writes responses and progress notifications to stdout.
"""

import json
import sys
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

from rpc_handler import RpcHandler

# Thread-safe stdout writer
_stdout_lock = threading.Lock()


def write_stdout(obj: dict) -> None:
    """Write a JSON object to stdout, thread-safe, one line."""
    line = json.dumps(obj, default=str) + "\n"
    with _stdout_lock:
        sys.stdout.write(line)
        sys.stdout.flush()


def notify(method: str, params: dict) -> None:
    """Send a JSON-RPC notification (no id) to stdout."""
    write_stdout({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })


def handle_request(handler: RpcHandler, request: dict) -> None:
    """Process a single JSON-RPC request and write the response."""
    req_id = request.get("id")
    method = request.get("method", "")
    params = request.get("params", {})

    try:
        result = handler.dispatch(method, params)
        write_stdout({
            "jsonrpc": "2.0",
            "result": result,
            "id": req_id,
        })
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        write_stdout({
            "jsonrpc": "2.0",
            "error": {
                "code": -32000,
                "message": str(e),
            },
            "id": req_id,
        })


def main():
    handler = RpcHandler(notify_fn=notify)
    executor = ThreadPoolExecutor(max_workers=3)

    # Signal ready
    notify("status", {"state": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            write_stdout({
                "jsonrpc": "2.0",
                "error": {
                    "code": -32700,
                    "message": f"Parse error: {e}",
                },
                "id": None,
            })
            continue

        # Dispatch to thread pool so stdin reading isn't blocked
        executor.submit(handle_request, handler, request)


if __name__ == "__main__":
    main()
