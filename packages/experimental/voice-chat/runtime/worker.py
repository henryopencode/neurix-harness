"""Private authenticated loopback worker; MLX and weight files remain local."""
import hmac
import hashlib
import contextlib
import json
import os
import sys
import tempfile
import wave
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import mlx.core as mx
from mlx_audio.tts import load


class VoiceReferences:
    """Cache bounded model-designed references; no microphone recording is stored."""

    def __init__(self, model, config):
        self.model = model
        self.config = config
        self.loaded = {}

    def get(self, voice):
        if voice in self.loaded:
            return self.loaded[voice]
        config = self.config
        instruction = config["instruction"] if voice == "natural" else config["voiceInstructions"][voice]
        identity = json.dumps({
            "model": config["model"], "instruction": instruction, "seed": config["seed"],
            "text": config["referenceText"], "cfg": config["voiceDesignCfgScale"],
            "maxTokens": config["maxTokens"], "maxSeconds": config["referenceMaxSeconds"],
        }, sort_keys=True).encode()
        key = hashlib.sha256(identity).hexdigest()
        root = Path(config["dataRoot"]) / "voices"
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = root / f"{key}.wav"
        audio = None
        if path.exists():
            try:
                with wave.open(str(path), "rb") as source:
                    if source.getnchannels() != 1 or source.getsampwidth() != 2 or source.getframerate() != 24000:
                        raise ValueError("Invalid cached voice reference")
                    count = source.getnframes()
                    if not 0 < count <= config["referenceMaxSeconds"] * 24000:
                        raise ValueError("Invalid cached voice reference duration")
                    pcm = source.readframes(count)
                    if len(pcm) != count * 2:
                        raise ValueError("Incomplete cached voice reference")
                audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
            except (wave.Error, EOFError, ValueError):
                print("Rebuilding an invalid local voice reference", file=sys.stderr, flush=True)
                path.unlink()
        if audio is None:
            mx.random.seed(config["seed"])
            chunks = []
            for result in self.model.generate(
                text=config["referenceText"], instruct=instruction or None,
                cfg_scale=config["voiceDesignCfgScale"], max_tokens=config["maxTokens"],
                stream=False, split_pattern=None,
            ):
                if not 0 < result.token_count < config["maxTokens"]:
                    raise ValueError("Voice reference exceeded its token limit")
                chunks.append(np.asarray(result.audio, dtype=np.float32).reshape(-1))
            audio = np.concatenate(chunks) if chunks else np.empty(0, dtype=np.float32)
            if not 0 < len(audio) <= config["referenceMaxSeconds"] * 24000 or not np.isfinite(audio).all():
                raise ValueError("Voice reference exceeded its audio limit")
            pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
            with tempfile.NamedTemporaryFile(dir=root, suffix=".part", delete=False) as temporary:
                temporary_path = Path(temporary.name)
            try:
                with wave.open(str(temporary_path), "wb") as output:
                    output.setnchannels(1)
                    output.setsampwidth(2)
                    output.setframerate(24000)
                    output.writeframes(pcm)
                os.replace(temporary_path, path)
            finally:
                temporary_path.unlink(missing_ok=True)
            audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        reference = (mx.array(audio), config["referenceText"])
        self.loaded[voice] = reference
        return reference


def main():
    config = json.loads(sys.argv[1])
    token = os.environ.pop("DSH_VOICE_TOKEN")
    with contextlib.redirect_stdout(sys.stderr):
        model = load(config["model"])
    references = VoiceReferences(model, config)

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
                voice = request.get("voice", config["voice"])
                if not isinstance(text, str) or not text.strip() or len(text) > config["maxSentenceCharacters"] or voice not in ("natural", "warm", "calm"):
                    self.send_error(400)
                    return
                reference, reference_text = references.get(voice)
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Transfer-Encoding", "chunked")
                self.send_header("Connection", "close")
                self.end_headers()
                mx.random.seed(config["seed"])
                tokens = 0
                for chunk in model.generate(
                    text=text,
                    instruct=config["instruction"] or None,
                    ref_audio=reference,
                    ref_text=reference_text,
                    cfg_scale=config["cfgScale"],
                    max_tokens=config["maxTokens"],
                    stream=True,
                    streaming_interval=config["streamingIntervalSeconds"],
                    split_pattern=None,
                ):
                    tokens += chunk.token_count
                    samples = np.asarray(chunk.audio, dtype=np.float32).reshape(-1)
                    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
                    if pcm:
                        self.wfile.write(f"{len(pcm):x}\r\n".encode() + pcm + b"\r\n")
                        self.wfile.flush()
                if not 0 < tokens < config["maxTokens"]:
                    raise ValueError("Speech exceeded its token limit")
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as error:
                print(f"Voice synthesis failed: {type(error).__name__}", file=sys.stderr, flush=True)
                self.close_connection = True
            finally:
                mx.clear_cache()

    server = HTTPServer(("127.0.0.1", 0), Handler)
    print(json.dumps({"port": server.server_port}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
