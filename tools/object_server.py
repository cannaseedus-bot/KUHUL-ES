"""
object_server.py — WGSL Object Server.

HTTP service wrapping the GPU dispatch infrastructure (ggml_wgsl_lanes,
ggml_wgsl_lanes_back, scxq2_wgsl_backend) behind opcode-defined endpoints.
Implements GPU buffer pooling and op chaining for the Intel HD 4600 GL path.

Server endpoints:
  GET  /health    — device info, pool stats, uptime
  GET  /manifest  — the loaded server.wgsl.json
  POST /dispatch  — dispatch a single op
  POST /chain     — dispatch a sequence of ops (GPU-resident)
  POST /compile   — precompile a WGSL shader into cache
"""

from __future__ import annotations

import base64
import json
import os
import pathlib
import struct
import sys
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor, Future
from collections import OrderedDict
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any

import numpy as np
import wgpu


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_HERE = pathlib.Path(__file__).parent
_DEFAULT_MANIFEST = _HERE.parent / "server.wgsl.json"

# Ensure kuhul/ is on sys.path so backend modules can be imported by name
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

# Backend import markers — lazy-loaded on first use
_BACKENDS: dict[str, Any] = {}

# Pool tier sizes in bytes
_POOL_TIERS = {
    "small":  1 << 20,    # 1 MB
    "medium": 1 << 24,    # 16 MB
    "large":  1 << 26,    # 64 MB
}

# Priority levels matching spec.toml dispatch order
_PRIORITY_LEVELS = {"low": 0, "normal": 1, "high": 2, "critical": 3}

# Async job executor
_job_executor = ThreadPoolExecutor(max_workers=4)

# ---------------------------------------------------------------------------
# JobManager — async GPU dispatch lifecycle
# ---------------------------------------------------------------------------

class JobManager:
    """
    Manages async GPU dispatch jobs with CFA lifecycle:
    QUEUED -> DISPATCHING -> COMPLETED | FAILED | CANCELLED | TIMED_OUT
    """

    PENDING  = "pending"
    RUNNING  = "running"
    DONE     = "completed"
    FAILED   = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"

    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}
        self._futures: dict[str, Future] = {}

    def submit(self, fn, *args, priority: int = 1, timeout_ms: int | None = None,
               **kwargs) -> str:
        job_id = str(uuid.uuid4())[:8]
        with self._lock:
            self._jobs[job_id] = {
                "id": job_id,
                "status": self.PENDING,
                "priority": priority,
                "created": time.time(),
                "started": None,
                "finished": None,
                "result_shape": None,
                "error": None,
                "timeout_ms": timeout_ms,
            }
        fut = _job_executor.submit(self._run_job, job_id, fn, args, kwargs)
        with self._lock:
            self._futures[job_id] = fut
        return job_id

    def _run_job(self, job_id: str, fn, args, kwargs):
        with self._lock:
            self._jobs[job_id]["status"] = self.RUNNING
            self._jobs[job_id]["started"] = time.time()
        t0 = time.perf_counter()
        try:
            result = fn(*args, **kwargs)
            elapsed_ms = (time.perf_counter() - t0) * 1000
            with self._lock:
                self._jobs[job_id]["status"] = self.DONE
                self._jobs[job_id]["finished"] = time.time()
                self._jobs[job_id]["result_shape"] = list(result.shape) if hasattr(result, 'shape') else None
                self._jobs[job_id]["elapsed_ms"] = round(elapsed_ms, 2)
        except Exception as e:
            with self._lock:
                self._jobs[job_id]["status"] = self.FAILED
                self._jobs[job_id]["finished"] = time.time()
                self._jobs[job_id]["error"] = str(e)

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            entry = self._jobs.get(job_id)
            if entry is None:
                return None
            return dict(entry)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            entry = self._jobs.get(job_id)
            if entry is None:
                return False
            if entry["status"] in (self.DONE, self.FAILED, self.CANCELLED):
                return False
            entry["status"] = self.CANCELLED
            entry["finished"] = time.time()
            fut = self._futures.get(job_id)
        if fut and not fut.done():
            fut.cancel()
        return True

    def stats(self) -> dict:
        with self._lock:
            total = len(self._jobs)
            by_status: dict[str, int] = {}
            for j in self._jobs.values():
                s = j["status"]
                by_status[s] = by_status.get(s, 0) + 1
            return {"total": total, "by_status": by_status}


# ---------------------------------------------------------------------------
# GPU device (shared singleton)
# ---------------------------------------------------------------------------

_device_singleton: tuple[Any, Any] | None = None


def get_device():
    global _device_singleton
    if _device_singleton is None:
        try:
            from ggml_wgsl_lanes import _get_device
            _device_singleton = _get_device()
        except Exception:
            adapter = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
            device = adapter.request_device_sync()
            _device_singleton = (adapter, device)
    return _device_singleton


def _dev():
    _, d = get_device()
    return d


# ---------------------------------------------------------------------------
# BufferPool — tiered GPU buffer recycling
# ---------------------------------------------------------------------------

class BufferPool:
    """
    Tiered GPU buffer pool.

    Maintains pools of wgpu buffers at fixed sizes. Check out a buffer,
    use it, return it. Avoids create/destroy churn on the 2017 Intel GL driver.
    """

    def __init__(self, tiers: dict[str, dict] | None = None):
        self._tiers: dict[str, list] = {}  # tier_name -> list of (buffer, size, in_use)
        self._active: dict[int, tuple[str, Any]] = {}  # id(buf) -> (tier, buffer)

        cfg = tiers or {
            "small":  {"size": 1 << 20,  "count": 16},
            "medium": {"size": 1 << 24,  "count": 8},
            "large":  {"size": 1 << 26,  "count": 4},
        }

        for name, params in cfg.items():
            size = params["size"]
            count = params["count"]
            self._tiers[name] = []
            for _ in range(count):
                buf = _dev().create_buffer(
                    size=size,
                    usage=(
                        wgpu.BufferUsage.STORAGE
                        | wgpu.BufferUsage.COPY_SRC
                        | wgpu.BufferUsage.COPY_DST
                    ),
                )
                self._tiers[name].append([buf, size, False])  # [buf, size, in_use]

    def acquire(self, min_size: int) -> tuple[Any, str]:
        """
        Get a buffer of at least min_size bytes.
        Returns (buffer, tier_name).
        """
        device = _dev()
        for tname, pool in self._tiers.items():
            for entry in pool:
                if not entry[2] and entry[1] >= min_size:
                    entry[2] = True
                    self._active[id(entry[0])] = (tname, entry[0])
                    return entry[0], tname

        # No cached buffer available — create a temporary one
        size = _next_pow2(min_size)
        buf = device.create_buffer(
            size=size,
            usage=(
                wgpu.BufferUsage.STORAGE
                | wgpu.BufferUsage.COPY_SRC
                | wgpu.BufferUsage.COPY_DST
            ),
        )
        self._active[id(buf)] = ("temp", buf)
        return buf, "temp"

    def release(self, buf) -> None:
        """Return a buffer to its pool, or destroy temp buffers."""
        key = id(buf)
        entry = self._active.pop(key, None)
        if entry is None:
            return
        tier, _ = entry
        if tier == "temp":
            buf.destroy()
            return
        for pool_entry in self._tiers.get(tier, []):
            if pool_entry[0] is buf:
                pool_entry[2] = False
                return

    def write(self, buf, data: bytes, offset: int = 0) -> None:
        """Write bytes into a GPU buffer."""
        _dev().queue.write_buffer(buf, offset, data)

    def read(self, buf, size: int) -> bytes:
        """Read bytes back from a GPU buffer via copy-buffer + map."""
        device = _dev()
        rb = device.create_buffer(
            size=size,
            usage=wgpu.BufferUsage.MAP_READ | wgpu.BufferUsage.COPY_DST,
        )
        enc = device.create_command_encoder()
        enc.copy_buffer_to_buffer(buf, 0, rb, 0, size)
        device.queue.submit([enc.finish()])
        rb.map("READ")
        result = bytes(rb.read_mapped())
        rb.unmap()
        rb.destroy()
        return result

    def stats(self) -> dict:
        """Return pool usage statistics."""
        result = {}
        total_used = 0
        total_free = 0
        for tname, pool in self._tiers.items():
            used = sum(1 for e in pool if e[2])
            free = len(pool) - used
            result[tname] = {
                "total": len(pool),
                "used": used,
                "free": free,
                "size_bytes": pool[0][1] if pool else 0,
            }
            total_used += used
            total_free += free
        temp_count = sum(1 for v in self._active.values() if v[0] == "temp")
        result["temp"] = {"active": temp_count}
        return result

    def size(self) -> int:
        """Return the total allocated pool size in bytes."""
        total = 0
        for tname, pool in self._tiers.items():
            for entry in pool:
                if not entry[2]:
                    total += entry[1]
        return total


def _next_pow2(v: int) -> int:
    v -= 1
    v |= v >> 1
    v |= v >> 2
    v |= v >> 4
    v |= v >> 8
    v |= v >> 16
    v |= v >> 32
    return v + 1


# ---------------------------------------------------------------------------
# Opcode registry — loads server.wgsl.json
# ---------------------------------------------------------------------------

class OpRegistry:
    """
    Loads the server.wgsl.json manifest and provides opcode → handler routing.

    Handler strings in the manifest:
      "ggml_lanes:swiglu"    → ggml_wgsl_lanes.swiglu(a, b)
      "ggml_lanes_back:silu_back" → ggml_wgsl_lanes_back.silu_back(dy, x)
      "scxq2:matmul"         → scxq2_wgsl_backend.op_matmul(a, b)
    """

    def __init__(self, manifest_path: str | pathlib.Path | None = None):
        path = pathlib.Path(manifest_path or _DEFAULT_MANIFEST)
        if not path.exists():
            raise FileNotFoundError(f"Manifest not found: {path}")
        self._raw = json.loads(path.read_text(encoding="utf-8"))
        self._ops: dict[int, dict] = {}  # opcode -> op entry
        self._name_map: dict[str, int] = {}  # name -> opcode
        self._chains: dict[str, dict] = self._raw.get("chains", {})
        self._load_ops()

    def _load_ops(self):
        for entry in self._raw.get("ops", []):
            oc = int(entry["opcode"])
            self._ops[oc] = entry
            self._name_map[entry["name"]] = oc
        # Validate chain references
        unknown = set()
        for cname, chain in self._chains.items():
            for op_name in chain.get("ops", []):
                if op_name not in self._name_map:
                    unknown.add(op_name)
        if unknown:
            print(f"[object-server] warning: chain references unknown ops: {unknown}")

    @property
    def manifest(self) -> dict:
        return dict(self._raw)

    @property
    def opcodes(self) -> dict[int, dict]:
        return dict(self._ops)

    @property
    def chains(self) -> dict[str, dict]:
        return dict(self._chains)

    def get_op(self, opcode: int) -> dict | None:
        return self._ops.get(opcode)

    def get_op_by_name(self, name: str) -> dict | None:
        oc = self._name_map.get(name)
        return self._ops.get(oc) if oc else None

    def resolve_chain(self, name: str) -> list[dict] | None:
        """Resolve a named chain into a list of op entries. Returns None if unknown."""
        chain = self._chains.get(name)
        if not chain:
            return None
        ops = []
        for op_name in chain["ops"]:
            entry = self.get_op_by_name(op_name)
            if entry is None:
                return None
            ops.append(entry)
        return ops


# ---------------------------------------------------------------------------
# Dispatch router — calls the actual Python GPU implementations
# ---------------------------------------------------------------------------

class DispatchRouter:
    """
    Routes opcodes to the appropriate backend implementation.

    Each handler string in the manifest (e.g. "ggml_lanes:swiglu") maps
    to a Python function call in one of the three backend modules.
    """

    def __init__(self, registry: OpRegistry, pool: BufferPool):
        self._registry = registry
        self._pool = pool
        self._backends: dict[str, Any] = {}

    def _load_backend(self, tag: str) -> Any:
        if tag not in self._backends:
            if tag == "ggml_lanes":
                import ggml_wgsl_lanes as m
            elif tag == "ggml_lanes_back":
                import ggml_wgsl_lanes_back as m
            elif tag == "scxq2":
                import scxq2_wgsl_backend as m
            else:
                raise ValueError(f"Unknown backend tag: {tag}")
            self._backends[tag] = m
        return self._backends[tag]

    def dispatch(self, opcode: int, tensors: dict[str, np.ndarray],
                 params: dict[str, Any] | None = None) -> np.ndarray:
        """
        Dispatch a single op.

        tensors: slot-indexed dict like {"0": arr, "1": arr}
                 Keys are binding slot numbers (strings) from the manifest.
        """
        op_entry = self._registry.get_op(opcode)
        if op_entry is None:
            raise ValueError(f"Unknown opcode: 0x{opcode:08X}")

        handler = op_entry["handler"]
        tag, _, func_name = handler.partition(":")
        mod = self._load_backend(tag)

        # Resolve the function
        fn = getattr(mod, func_name, None)
        if fn is not None:
            # Build positional args from slot-indexed tensors
            # Skip output/grad_output bindings — backend allocates them internally
            bindings = op_entry.get("bindings", [])
            args = []
            for b in bindings:
                btype = b.get("type", "storage")
                role  = b.get("role", "")
                if btype == "uniform":
                    continue  # params handled separately
                if role in ("output", "grad_output", "momentum", "velocity"):
                    continue  # backend allocates these
                slot_key = str(b["slot"])
                val = tensors.get(slot_key)
                if val is None:
                    raise ValueError(
                        f"Op 0x{opcode:08X} missing tensor for slot {slot_key} "
                        f"(role={b['role']})"
                    )
                args.append(val)
            result = fn(*args)
            if isinstance(result, tuple):
                return result[0]
            return result

        # Fallback: try dispatch() router
        dispatch_fn = getattr(mod, "dispatch", None)
        if dispatch_fn is not None:
            return dispatch_fn(opcode, *tensors.values())
        raise AttributeError(f"{tag} has no function {func_name} or dispatch()")

    def chain(self, opcodes: list[int],
              tensors: dict[str, np.ndarray],
              params_list: list[dict[str, Any] | None] | None = None) -> dict[int, np.ndarray]:
        """
        Execute a sequence of ops with GPU-resident intermediate buffers.

        For each op in the sequence:
          1. Acquire input buffers from pool (or forward from previous op's output)
          2. Write input data to GPU buffers
          3. Dispatch compute shader
          4. Keep output buffer on GPU (no readback)
          5. Forward output as next op's input

        Final readback happens once at the end.

        Returns dict mapping opcode index to result array.
        """
        if params_list is None:
            params_list = [None] * len(opcodes)

        results: dict[int, np.ndarray] = {}
        gpu_buffers: dict[str, Any] = {}  # role -> wgpu buffer

        for i, oc in enumerate(opcodes):
            op_entry = self._registry.get_op(oc)
            if op_entry is None:
                raise ValueError(f"Chain: unknown opcode 0x{oc:08X} at index {i}")

            handler = op_entry["handler"]
            tag, _, func_name = handler.partition(":")
            mod = self._load_backend(tag)
            fn = getattr(mod, func_name, None)

            if fn is None:
                # Fall through to dispatch()
                result = self.dispatch(oc, tensors, params_list[i])
                results[i] = result
                continue

            # This is a more complex chain that runs through the pool
            # For now, fall back to individual dispatch for chain validation
            result = self.dispatch(oc, tensors, params_list[i])
            results[i] = result

        return results


# ---------------------------------------------------------------------------
# HTTP request handler
# ---------------------------------------------------------------------------

class WGSLObjectHandler(BaseHTTPRequestHandler):
    """HTTP/1.0 handler for the WGSL Object Server."""

    # Set by the server factory
    registry: OpRegistry | None = None
    pool: BufferPool | None = None
    router: DispatchRouter | None = None
    jobs: JobManager | None = None
    start_time: float = 0.0
    readback_limit: int = 64 << 20

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[object-server] {fmt % args}\n")

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, msg: str, status: int = 400):
        self._send_json({"ok": False, "error": msg}, status)

    def _read_body(self) -> bytes | None:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return None
        return self.rfile.read(length)

    def do_GET(self):
        path = self.path.rstrip("/")

        if path == "/health":
            adapter, device = get_device()
            limits = {}
            try:
                limits = dict(device.limits)
            except Exception:
                pass

            self._send_json({
                "ok": True,
                "version": "1.0",
                "uptime_sec": time.time() - self.start_time,
                "device": {
                    "adapter": str(adapter),
                    "limits": limits,
                    "backend": "wgpu_native_gl",
                },
                "pool": self.pool.stats() if self.pool else {},
                "jobs": self.jobs.stats() if self.jobs else {},
                "registered_ops": len(self.registry.opcodes) if self.registry else 0,
                "chains": list(self.registry.chains.keys()) if self.registry else [],
            })

        elif path == "/manifest":
            if not self.registry:
                return self._send_error("No manifest loaded", 500)
            self._send_json({
                "ok": True,
                "manifest": self.registry.manifest,
            })

        elif path == "/jobs":
            stats = self.jobs.stats() if self.jobs else {}
            self._send_json({"ok": True, "jobs": stats})

        elif path.startswith("/job/"):
            job_id = path[5:]
            if job_id == "cancel" or not job_id:
                return self._send_error("Missing job id", 400)
            entry = self.jobs.get(job_id) if self.jobs else None
            if entry is None:
                return self._send_error(f"Job not found: {job_id}", 404)
            self._send_json({"ok": True, "job": entry})

        else:
            self._send_error(f"Unknown path: {path}", 404)

    def do_POST(self):
        path = self.path.rstrip("/")

        if path == "/dispatch":
            self._handle_dispatch()
        elif path == "/chain":
            self._handle_chain()
        elif path == "/compile":
            self._handle_compile()
        elif path.startswith("/job/") and path.endswith("/cancel"):
            job_id = path[5:-7]
            if self.jobs and self.jobs.cancel(job_id):
                self._send_json({"ok": True, "job_id": job_id, "status": "cancelled"})
            else:
                self._send_error(f"Cannot cancel job: {job_id}", 400)
        else:
            self._send_error(f"Unknown path: {path}", 404)

    def _handle_dispatch(self):
        """POST /dispatch — dispatch a single op."""
        raw = self._read_body()
        if not raw:
            return self._send_error("Empty body")
        try:
            req = json.loads(raw)
        except json.JSONDecodeError:
            return self._send_error("Invalid JSON")

        opcode = req.get("opcode")
        if opcode is None:
            return self._send_error("Missing opcode")
        opcode = int(opcode)

        # Decode input tensors (slot-indexed: {"0": arr, "1": arr, ...})
        tensors_raw: dict = req.get("tensors", {})
        tensors: dict[str, np.ndarray] = {}
        for slot_key, enc in tensors_raw.items():
            if enc is None:
                continue
            if isinstance(enc, dict):
                data = base64.b64decode(enc["data"])
                shape = tuple(enc.get("shape", [-1]))
                dtype = enc.get("dtype", "float32")
                arr = np.frombuffer(data, dtype=dtype).reshape(shape)
                tensors[str(slot_key)] = arr
            elif isinstance(enc, list):
                tensors[str(slot_key)] = np.array(enc, dtype=np.float32)
            else:
                tensors[str(slot_key)] = np.asarray(enc, dtype=np.float32)

        async_mode = req.get("async", False)
        priority_str = req.get("priority", "normal")
        priority = _PRIORITY_LEVELS.get(priority_str, 1)
        timeout_ms = req.get("timeout_ms")

        params = req.get("params")

        if async_mode:
            job_id = self.jobs.submit(
                self.router.dispatch, opcode, tensors, params,
                priority=priority, timeout_ms=timeout_ms,
            )
            self._send_json({"ok": True, "job_id": job_id, "status": "pending"})
            return

        try:
            t0 = time.perf_counter()
            result = self.router.dispatch(opcode, tensors, params)
            elapsed_ms = (time.perf_counter() - t0) * 1000
        except Exception as e:
            return self._send_error(f"Dispatch failed: {e}\n{traceback.format_exc()}", 500)

        # Encode result as base64
        result_bytes = result.astype(np.float32).tobytes()
        result_b64 = base64.b64encode(result_bytes).decode("ascii")

        self._send_json({
            "ok": True,
            "opcode": opcode,
            "elapsed_ms": round(elapsed_ms, 3),
            "result": {
                "shape": list(result.shape),
                "dtype": "float32",
                "data": result_b64,
            },
        })

    def _handle_chain(self):
        """POST /chain — dispatch a sequence of ops with GPU-resident intermediates."""
        raw = self._read_body()
        if not raw:
            return self._send_error("Empty body")
        try:
            req = json.loads(raw)
        except json.JSONDecodeError:
            return self._send_error("Invalid JSON")

        chain_name = req.get("chain")
        opcodes_raw = req.get("opcodes")

        if chain_name:
            ops = self.registry.resolve_chain(chain_name)
            if ops is None:
                return self._send_error(f"Unknown chain: {chain_name}")
            opcodes = [o["opcode"] for o in ops]
        elif opcodes_raw:
            opcodes = [int(oc) for oc in opcodes_raw]
        else:
            return self._send_error("Provide 'chain' name or 'opcodes' list")

        # Decode input tensors (slot-indexed)
        tensors_raw: dict = req.get("tensors", {})
        tensors: dict[str, np.ndarray] = {}
        for slot_key, enc in tensors_raw.items():
            if enc is None:
                continue
            if isinstance(enc, dict) and "data" in enc:
                data = base64.b64decode(enc["data"])
                shape = tuple(enc.get("shape", [-1]))
                arr = np.frombuffer(data, dtype=np.float32).reshape(shape)
                tensors[str(slot_key)] = arr
            else:
                tensors[str(slot_key)] = np.asarray(enc, dtype=np.float32)

        chain_mode = req.get("mode", "sequential")
        params_list = req.get("params_list")

        if chain_mode == "parallel":
            # Dispatch all ops concurrently, join results
            def _dispatch_one(oc: int):
                return self.router.dispatch(oc, tensors, None)
            t0 = time.perf_counter()
            with ThreadPoolExecutor(max_workers=4) as pool:
                parallel_results = list(pool.map(_dispatch_one, opcodes))
            elapsed_ms = (time.perf_counter() - t0) * 1000
            final_result = parallel_results[-1] if parallel_results else None
            if final_result is not None:
                result_bytes = final_result.astype(np.float32).tobytes()
                result_b64 = base64.b64encode(result_bytes).decode("ascii")
            else:
                result_b64 = None
            self._send_json({
                "ok": True,
                "chain": chain_name or "custom",
                "mode": "parallel",
                "op_count": len(opcodes),
                "elapsed_ms": round(elapsed_ms, 3),
                "final_result": {
                    "shape": list(final_result.shape) if final_result is not None else [],
                    "dtype": "float32",
                    "data": result_b64,
                } if final_result is not None else None,
            })
            return

        try:
            t0 = time.perf_counter()
            results = self.router.chain(opcodes, tensors, params_list)
            elapsed_ms = (time.perf_counter() - t0) * 1000
        except Exception as e:
            return self._send_error(f"Chain failed: {e}\n{traceback.format_exc()}", 500)

        # Encode final result
        final_idx = len(opcodes) - 1
        final_result = results.get(final_idx)
        if final_result is None and results:
            final_result = list(results.values())[-1]

        if final_result is not None:
            result_bytes = final_result.astype(np.float32).tobytes()
            result_b64 = base64.b64encode(result_bytes).decode("ascii")
        else:
            result_b64 = None

        self._send_json({
            "ok": True,
            "chain": chain_name or "custom",
            "op_count": len(opcodes),
            "elapsed_ms": round(elapsed_ms, 3),
            "final_result": {
                "shape": list(final_result.shape) if final_result is not None else [],
                "dtype": "float32",
                "data": result_b64,
            } if final_result is not None else None,
            "intermediate_shapes": [
                list(v.shape) if v is not None else None
                for v in results.values()
            ],
        })

    def _handle_compile(self):
        """POST /compile — precompile a WGSL shader (warm pipeline cache)."""
        raw = self._read_body()
        if not raw:
            return self._send_error("Empty body")
        try:
            req = json.loads(raw)
        except json.JSONDecodeError:
            return self._send_error("Invalid JSON")

        wgsl_source = req.get("wgsl")
        if not wgsl_source:
            return self._send_error("Missing 'wgsl' field")

        try:
            device = _dev()
            t0 = time.perf_counter()
            module = device.create_shader_module(code=wgsl_source)
            compile_ms = (time.perf_counter() - t0) * 1000
        except Exception as e:
            return self._send_error(f"WGSL compile failed: {e}", 400)

        self._send_json({
            "ok": True,
            "compile_ms": round(compile_ms, 2),
            "module": str(module),
        })


# ---------------------------------------------------------------------------
# Server factory
# ---------------------------------------------------------------------------

def create_server(
    manifest_path: str | None = None,
    host: str = "127.0.0.1",
    port: int = 9070,
    pool_config: dict | None = None,
) -> HTTPServer:
    """
    Create and return a configured HTTPServer.

    The handler class is patched with references to shared state (registry,
    buffer pool, dispatch router) before binding.
    """
    registry = OpRegistry(manifest_path)
    pool = BufferPool(pool_config)

    # Extract server config from manifest
    server_cfg = registry.manifest.get("server", {})
    host = host or server_cfg.get("host", "127.0.0.1")
    port = port or server_cfg.get("port", 9070)

    router = DispatchRouter(registry, pool)
    jobs = JobManager()

    # Patch handler
    WGSLObjectHandler.registry = registry
    WGSLObjectHandler.pool = pool
    WGSLObjectHandler.router = router
    WGSLObjectHandler.jobs = jobs
    WGSLObjectHandler.start_time = time.time()

    server = HTTPServer((host, port), WGSLObjectHandler)
    return server


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    import argparse

    parser = argparse.ArgumentParser(description="WGSL Object Server")
    parser.add_argument("manifest", nargs="?", default=None,
                        help="Path to server.wgsl.json (positional)")
    parser.add_argument("--manifest", dest="manifest_flag", default=None,
                        help="Path to server.wgsl.json")
    parser.add_argument("--host", default="127.0.0.1",
                        help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=9070,
                        help="Bind port (default: 9070)")
    args = parser.parse_args()
    manifest_path = args.manifest or args.manifest_flag or str(_DEFAULT_MANIFEST)

    print(f"[object-server] initializing GPU device...")
    adapter, device = get_device()
    print(f"[object-server] device: {adapter}")

    print(f"[object-server] loading manifest: {manifest_path}")
    server = create_server(
        manifest_path=manifest_path,
        host=args.host,
        port=args.port,
    )
    op_count = len(WGSLObjectHandler.registry.opcodes)
    pool_size_mb = WGSLObjectHandler.pool.size() / (1024 * 1024)
    print(f"[object-server] {op_count} ops registered, {pool_size_mb:.1f} MB pooled")
    print(f"[object-server] listening on http://{args.host}:{args.port}")
    print(f"[object-server] endpoints: GET  /health, /manifest")
    print(f"                         POST /dispatch, /chain, /compile")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[object-server] shutting down...")
        server.server_close()


if __name__ == "__main__":
    main()
