"""
glyph_buffer_engine.py — K'UHUL Glyph Buffer Engine

Routes K'UHUL glyph opcodes to the right dispatch backend:

  PHASE_GATE (0x00000001)  →  pi_field_shader.wgsl via wgpu-py (GPU)
  WO_*       (0x02xxxxxx)  →  native_glyph_engine_abi.dll  (CPU, ctypes)
  SH wave                  →  wgpu_optical_wave             (GPU, ping-pong)

L1 buffer cache: pre-allocated wgpu.GPUBuffer objects per (node_count, shader).
L2 KV cache:     result dict keyed by (opcode, input_hash, params_hash).

Public API
----------
GlyphBufferEngine(device=None)
    .execute_pi_field(nodes, node_meta, edges, field, sources, params, steps=1)
        -> field (N, 4) float32 updated by pi_field_shader.wgsl
    .execute_glyph(opcode, a, b=None, element_count=None)
        -> numpy array (CPU lane via DLL)
    .execute_matmul(lhs, rhs)
        -> numpy matrix result (CPU lane via DLL)

Standalone:
    python glyph_buffer_engine.py [--nodes N] [--steps S] [--bench]
"""

import struct
import ctypes
import pathlib
import numpy as np
import wgpu

# ── Paths ─────────────────────────────────────────────────────────────────────
_HERE     = pathlib.Path(__file__).parent
_PI_WGSL  = _HERE.parent / "tools" / "Kuhul-c++" / "pi_field_shader.wgsl"
_ABI_DLL  = _HERE.parent / "tools" / "Kuhul-c++" / "native_glyph_engine_abi.dll"

# ── Native ABI (ctypes) ───────────────────────────────────────────────────────

class _LaneDesc(ctypes.Structure):
    _fields_ = [
        ("opcode",    ctypes.c_uint32),
        ("name",      ctypes.c_char * 32),
        ("glyph",     ctypes.c_char * 16),
        ("lane_kind", ctypes.c_uint32),
        ("arity",     ctypes.c_uint32),
        ("dtype_mask",ctypes.c_uint32),
        ("flags",     ctypes.c_uint32),
    ]

_dll = None

def _get_dll():
    global _dll
    if _dll is None:
        if not _ABI_DLL.exists():
            raise FileNotFoundError(f"native_glyph_engine_abi.dll not found at {_ABI_DLL}")
        lib = ctypes.CDLL(str(_ABI_DLL))
        lib.kuhul_glyph_abi_version.restype  = ctypes.c_uint32
        lib.kuhul_glyph_lane_count.restype   = ctypes.c_uint32
        lib.kuhul_glyph_get_lane.argtypes    = [ctypes.c_uint32, ctypes.POINTER(_LaneDesc)]
        lib.kuhul_glyph_get_lane.restype     = ctypes.c_int32
        lib.kuhul_glyph_execute_f32.argtypes = [
            ctypes.c_uint32,
            ctypes.POINTER(ctypes.c_float),
            ctypes.POINTER(ctypes.c_float),
            ctypes.POINTER(ctypes.c_float),
            ctypes.c_uint64,
        ]
        lib.kuhul_glyph_execute_f32.restype  = ctypes.c_int32
        lib.kuhul_glyph_matmul_f32.argtypes  = [
            ctypes.POINTER(ctypes.c_float),
            ctypes.POINTER(ctypes.c_float),
            ctypes.POINTER(ctypes.c_float),
            ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32,
        ]
        lib.kuhul_glyph_matmul_f32.restype   = ctypes.c_int32
        _dll = lib
    return _dll

def _np_to_cfloat(arr: np.ndarray):
    flat = arr.astype(np.float32).ravel()
    return (ctypes.c_float * len(flat))(*flat)

# ── wgpu device cache ─────────────────────────────────────────────────────────
_cached_dev = None

def _get_device():
    global _cached_dev
    if _cached_dev is None:
        adapter    = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
        device     = adapter.request_device_sync()
        _cached_dev = (adapter, device)
        info = adapter.info
        print(f"[glyph-engine] adapter: {info.get('device', info)}  backend: {info.get('backend_type','?')}")
    return _cached_dev

# ── Pi-field shader pipeline cache ───────────────────────────────────────────
_pi_pipeline = None  # (device, pipeline, bgl)

def _get_pi_pipeline(device):
    global _pi_pipeline
    if _pi_pipeline is not None and _pi_pipeline[0] is device:
        return _pi_pipeline[1], _pi_pipeline[2]

    shader = device.create_shader_module(code=_PI_WGSL.read_text(encoding="utf-8"))

    STO_R  = wgpu.BufferBindingType.read_only_storage
    STO_RW = wgpu.BufferBindingType.storage
    UNI    = wgpu.BufferBindingType.uniform
    COMP   = wgpu.ShaderStage.COMPUTE

    bgl = device.create_bind_group_layout(entries=[
        {"binding": 0, "visibility": COMP, "buffer": {"type": STO_R}},   # nodes
        {"binding": 1, "visibility": COMP, "buffer": {"type": STO_R}},   # nodeMeta
        {"binding": 2, "visibility": COMP, "buffer": {"type": STO_R}},   # edges
        {"binding": 3, "visibility": COMP, "buffer": {"type": STO_R}},   # fieldPrev
        {"binding": 4, "visibility": COMP, "buffer": {"type": STO_RW}},  # fieldNext
        {"binding": 5, "visibility": COMP, "buffer": {"type": STO_R}},   # sources
        {"binding": 6, "visibility": COMP, "buffer": {"type": UNI}},     # params
    ])
    pipeline = device.create_compute_pipeline(
        layout=device.create_pipeline_layout(bind_group_layouts=[bgl]),
        compute={"module": shader, "entry_point": "main"},
    )
    _pi_pipeline = (device, pipeline, bgl)
    return pipeline, bgl

# ── Pi-field L1 buffer context ────────────────────────────────────────────────

_PINGPONG = wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC | wgpu.BufferUsage.COPY_DST
_STATIC_R = wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_DST
_UNI_U    = wgpu.BufferUsage.UNIFORM | wgpu.BufferUsage.COPY_DST

class PiFieldContext:
    """Pre-allocated buffers for a fixed (node_count, edge_count) graph."""

    def __init__(self, device, node_count: int, edge_count: int):
        self.device     = device
        self.node_count = node_count
        self.edge_count = edge_count
        n4  = node_count * 4 * 4   # N × vec4<f32>
        e4  = max(edge_count, 1) * 4 * 4

        self.buf_nodes    = device.create_buffer(size=n4, usage=_STATIC_R)
        self.buf_nodemeta = device.create_buffer(size=n4, usage=_STATIC_R)
        self.buf_edges    = device.create_buffer(size=e4, usage=_STATIC_R)
        self.buf_sources  = device.create_buffer(size=n4, usage=_STATIC_R)
        self.buf_field_a  = device.create_buffer(size=n4, usage=_PINGPONG)
        self.buf_field_b  = device.create_buffer(size=n4, usage=_PINGPONG)
        self.buf_params   = device.create_buffer(size=32, usage=_UNI_U)   # 8 × f32

        pipeline, bgl = _get_pi_pipeline(device)
        self.pipeline = pipeline
        self.bg_a2b   = self._make_bg(bgl, self.buf_field_a, self.buf_field_b)
        self.bg_b2a   = self._make_bg(bgl, self.buf_field_b, self.buf_field_a)
        self._graph_dirty = True   # force re-upload on first run

    def _make_bg(self, bgl, field_prev, field_next):
        def entry(binding, buf):
            return {"binding": binding, "resource": {"buffer": buf, "offset": 0, "size": buf.size}}
        return self.device.create_bind_group(layout=bgl, entries=[
            entry(0, self.buf_nodes),
            entry(1, self.buf_nodemeta),
            entry(2, self.buf_edges),
            entry(3, field_prev),
            entry(4, field_next),
            entry(5, self.buf_sources),
            entry(6, self.buf_params),
        ])

    def upload_graph(self, nodes: np.ndarray, node_meta: np.ndarray,
                     edges: np.ndarray, sources: np.ndarray):
        """Upload static graph topology (call when graph changes)."""
        dv = self.device.queue
        dv.write_buffer(self.buf_nodes,    0, nodes.astype(np.float32).tobytes())
        dv.write_buffer(self.buf_nodemeta, 0, node_meta.astype(np.float32).tobytes())
        dv.write_buffer(self.buf_edges,    0, edges.astype(np.float32).tobytes())
        dv.write_buffer(self.buf_sources,  0, sources.astype(np.float32).tobytes())
        self._graph_dirty = False

    def run(self, field: np.ndarray, params: dict, steps: int = 1) -> np.ndarray:
        """
        Run `steps` pi-field diffusion steps.
        params keys: dt, diffusion, decay, phase_gain, coherence_min, coherence_max, source_strength
        """
        # Params struct: 8 × f32
        p = struct.pack("8f",
            float(params.get("dt", 0.016)),
            float(params.get("diffusion", 0.1)),
            float(params.get("decay", 0.01)),
            float(self.node_count),
            float(params.get("phase_gain", 0.5)),
            float(params.get("coherence_min", 0.5)),
            float(params.get("coherence_max", 2.0)),
            float(params.get("source_strength", 1.0)),
        )
        dv = self.device.queue
        dv.write_buffer(self.buf_params,  0, p)
        dv.write_buffer(self.buf_field_a, 0, field.astype(np.float32).tobytes())

        wg = (self.node_count + 63) // 64
        cur_a_is_prev = True

        encoder = self.device.create_command_encoder()
        for _ in range(steps):
            cp = encoder.begin_compute_pass()
            cp.set_pipeline(self.pipeline)
            cp.set_bind_group(0, self.bg_a2b if cur_a_is_prev else self.bg_b2a)
            cp.dispatch_workgroups(wg, 1, 1)
            cp.end()
            cur_a_is_prev = not cur_a_is_prev
        dv.submit([encoder.finish()])

        result_buf = self.buf_field_a if cur_a_is_prev else self.buf_field_b
        raw = dv.read_buffer(result_buf)
        return np.frombuffer(raw, dtype=np.float32).reshape(self.node_count, 4).copy()

# ── Context cache ─────────────────────────────────────────────────────────────
_pi_ctx_cache: dict = {}

def _get_pi_context(node_count: int, edge_count: int, device=None) -> PiFieldContext:
    if device is None:
        _, device = _get_device()
    key = (node_count, edge_count, id(device))
    if key not in _pi_ctx_cache:
        _pi_ctx_cache[key] = PiFieldContext(device, node_count, edge_count)
    return _pi_ctx_cache[key]

# ── L2 KV cache ───────────────────────────────────────────────────────────────
_l2: dict = {}

def _l2_key(opcode, *arrays_and_params):
    h = hash((opcode,) + tuple(
        a.tobytes() if isinstance(a, np.ndarray) else a
        for a in arrays_and_params
    ))
    return h

# ── Public Engine ─────────────────────────────────────────────────────────────

class GlyphBufferEngine:
    """
    Unified K'UHUL glyph buffer engine.
    Routes opcodes to GPU (pi-field / SH wave) or CPU (native ABI DLL).
    """

    def __init__(self, device=None):
        if device is None:
            _, device = _get_device()
        self.device = device

    # ── GPU path: π-field diffusion ──────────────────────────────────────────
    def execute_pi_field(
        self,
        nodes:      np.ndarray,   # (N, 4) float32: [x, y, z, edgeStart]
        node_meta:  np.ndarray,   # (N, 4) float32: [edgeCount, 0, 0, 0]
        edges:      np.ndarray,   # (E, 4) float32: [targetIndex, weight, 0, 0]
        field:      np.ndarray,   # (N, 4) float32: [fx, fy, fz, phase]
        sources:    np.ndarray,   # (N, 4) float32
        params:     dict,
        steps:      int = 1,
        l2_cache:   bool = False,
    ) -> np.ndarray:
        """Run pi-field diffusion on GPU. Returns updated field (N, 4)."""
        N = nodes.shape[0]
        E = edges.shape[0]

        if l2_cache:
            key = _l2_key(0x00000001, nodes, edges, field, params.get("dt", 0.016), steps)
            if key in _l2:
                return _l2[key]

        ctx = _get_pi_context(N, E, self.device)
        ctx.upload_graph(nodes, node_meta, edges, sources)
        result = ctx.run(field, params, steps)

        if l2_cache:
            _l2[key] = result
        return result

    # ── CPU path: scalar / tensor lanes (native ABI DLL) ─────────────────────
    def execute_glyph(
        self,
        opcode:        int,
        a:             np.ndarray,
        b:             np.ndarray = None,
        element_count: int = None,
    ) -> np.ndarray:
        """Execute a scalar/tensor glyph lane via native_glyph_engine_abi.dll."""
        dll = _get_dll()
        a   = np.asarray(a, dtype=np.float32).ravel()
        n   = element_count or len(a)
        ca  = _np_to_cfloat(a)
        cb_ = _np_to_cfloat(b) if b is not None else None
        out = (ctypes.c_float * n)()
        rc  = dll.kuhul_glyph_execute_f32(opcode, ca, cb_, out, n)
        if rc != 0:
            raise RuntimeError(f"kuhul_glyph_execute_f32 opcode=0x{opcode:08x} rc={rc}")
        return np.array([out[i] for i in range(n)], dtype=np.float32)

    def execute_matmul(
        self,
        lhs: np.ndarray,   # (M, K) float32
        rhs: np.ndarray,   # (K, N) float32
    ) -> np.ndarray:
        """Row-major float32 matmul via native WO_MATMUL lane."""
        dll  = _get_dll()
        lhs  = np.asarray(lhs, dtype=np.float32)
        rhs  = np.asarray(rhs, dtype=np.float32)
        M, K = lhs.shape
        K2, N = rhs.shape
        if K != K2:
            raise ValueError(f"Shape mismatch: ({M},{K}) @ ({K2},{N})")
        cl   = _np_to_cfloat(lhs)
        cr   = _np_to_cfloat(rhs)
        cout = (ctypes.c_float * (M * N))()
        rc   = dll.kuhul_glyph_matmul_f32(cl, cr, cout, M, K, N)
        if rc != 0:
            raise RuntimeError(f"kuhul_glyph_matmul_f32 rc={rc}")
        return np.array([cout[i] for i in range(M * N)], dtype=np.float32).reshape(M, N)

    def lane_info(self) -> list[dict]:
        """List all registered CPU lanes from the native ABI."""
        dll = _get_dll()
        lanes = []
        for i in range(dll.kuhul_glyph_lane_count()):
            d = _LaneDesc()
            dll.kuhul_glyph_get_lane(i, ctypes.byref(d))
            lanes.append({
                "opcode": f"0x{d.opcode:08x}",
                "name":   d.name.decode().rstrip("\x00"),
                "glyph":  d.glyph.decode().rstrip("\x00"),
                "arity":  d.arity,
            })
        return lanes


# ── CLI bench / demo ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys, time, argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--nodes", type=int, default=256)
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--bench", action="store_true")
    args = ap.parse_args()

    eng = GlyphBufferEngine()

    print(f"\n[lanes] ABI v{_get_dll().kuhul_glyph_abi_version()}")
    for lane in eng.lane_info():
        print(f"  {lane['opcode']}  {lane['name']:12}  glyph={lane['glyph']}  arity={lane['arity']}")

    # CPU smoke: WO_ADD
    WO_ADD = 0x02010001
    a = np.array([1.0, 2.0, 3.0, 4.0], dtype=np.float32)
    b = np.array([10.0, 20.0, 30.0, 40.0], dtype=np.float32)
    print(f"\n[WO_ADD]  {a} + {b} = {eng.execute_glyph(WO_ADD, a, b)}")

    # CPU smoke: WO_MATMUL
    lhs = np.array([[1,2,3],[4,5,6]], dtype=np.float32)
    rhs = np.array([[7,8],[9,10],[11,12]], dtype=np.float32)
    print(f"[WO_MATMUL]\n{eng.execute_matmul(lhs, rhs)}")

    # GPU: pi-field diffusion on a simple ring graph
    N = args.nodes
    rng = np.random.default_rng(0)

    # Ring graph: node i → node (i+1)%N
    nodes    = np.zeros((N, 4), np.float32)
    for i in range(N):
        angle = 2 * np.pi * i / N
        nodes[i] = [np.cos(angle), np.sin(angle), 0.0, float(i)]  # edgeStart = i (1 edge each)
    node_meta = np.zeros((N, 4), np.float32)
    node_meta[:, 0] = 1.0     # 1 edge per node
    edges    = np.zeros((N, 4), np.float32)
    for i in range(N):
        edges[i] = [float((i + 1) % N), 1.0, 0.0, 0.0]
    sources  = np.zeros((N, 4), np.float32)
    field    = rng.standard_normal((N, 4)).astype(np.float32)

    params = {"dt": 0.05, "diffusion": 0.3, "decay": 0.5,
              "phase_gain": 0.0, "coherence_min": 1.0, "coherence_max": 1.0,
              "source_strength": 0.0}

    # Warm-up
    eng.execute_pi_field(nodes, node_meta, edges, field, sources, params, steps=1)

    t0 = time.perf_counter()
    result = eng.execute_pi_field(nodes, node_meta, edges, field, sources, params, steps=args.steps)
    elapsed = time.perf_counter() - t0

    print(f"\n[pi-field]  nodes={N}  steps={args.steps}")
    print(f"  {args.steps} steps: {elapsed*1000:.2f} ms  ({elapsed*1000/args.steps:.3f} ms/step)")
    print(f"  field[0]: {result[0].tolist()}")
