"""Private authenticated loopback worker; MLX and weight files remain local."""
import hmac
import contextlib
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import mlx.core as mx
from mlx_audio.tts import load


def main():
    config = json.loads(sys.argv[1])
    token = os.environ.pop("DSH_VOICE_TOKEN")
    with contextlib.redirect_stdout(sys.stderr):
        model = load(config["model"])

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            if self.path != "/speech" or not hmac.compare_digest(
                self.headers.get("Authorization", ""), f"Bearer {token}"
            ):
                self.send_error(401)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 65536:
                    self.send_error(413)
                    return
                request = json.loads(self.rfile.read(length))
                text = request["text"]
                if not isinstance(text, str) or not text.strip():
                    self.send_error(400)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Transfer-Encoding", "chunked")
                self.send_header("Connection", "close")
                self.end_headers()
                mx.random.seed(config["seed"])
                for chunk in model.generate(
                    text=text,
                    instruct=config["instruction"] or None,
                    cfg_scale=config["cfgScale"],
                    max_tokens=config["maxTokens"],
                    stream=True,
                    streaming_interval=config["streamingIntervalSeconds"],
                ):
                    samples = np.asarray(chunk.audio, dtype=np.float32).reshape(-1)
                    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
                    if pcm:
                        self.wfile.write(f"{len(pcm):x}\r\n".encode() + pcm + b"\r\n")
                        self.wfile.flush()
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as error:
                print(f"Voice synthesis failed: {type(error).__name__}", file=sys.stderr, flush=True)
                self.close_connection = True

    server = HTTPServer(("127.0.0.1", 0), Handler)
    print(json.dumps({"port": server.server_port}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
