// kuhul-es/runtime/src/glsl_kernels.js
//
// GLSL compute kernels (OpenGL 4.3, GL_ARB_compute_shader + SSBO) for the
// trainer. Mirrors the trainer HLSL shaders (gpt2_matmul_fwd.hlsl,
// gpt2_gelu_fwd.hlsl, gpt2_layernorm_fwd.hlsl) — HLSL -> GLSL mapping:
//   StructuredBuffer<T> : register(tN) -> layout(std430, binding=N) buffer
//   [numthreads(X,Y,Z)]                 -> layout(local_size_x=X,...) in;
//   SV_DispatchThreadID                 -> gl_GlobalInvocationID
//   GroupMemoryBarrierWithGroupSync()   -> barrier()

const VERSION = '#version 430 core\n';

// dense GEMM: C[M,N] = A[M,K] * B[K,N]   (16x16 tiled, groupshared)
const MATMUL = VERSION + `
layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;
layout(std430, binding = 0) readonly buffer A { float a[]; };
layout(std430, binding = 1) readonly buffer B { float b[]; };
layout(std430, binding = 2) writeonly buffer C { float c[]; };
layout(std140, binding = 3) uniform P { uint M; uint N; uint K; } p;
shared float sA[16][16];
shared float sB[16][16];
void main() {
  uint tx = gl_LocalInvocationID.x;
  uint ty = gl_LocalInvocationID.y;
  uint row = gl_GlobalInvocationID.y;
  uint col = gl_GlobalInvocationID.x;
  float acc = 0.0;
  for (uint t = 0; t < (p.K + 15u) / 16u; ++t) {
    uint aIdx = row * p.K + t * 16u + tx;
    uint bIdx = (t * 16u + ty) * p.N + col;
    sA[ty][tx] = (row < p.M && t * 16u + tx < p.K) ? a[aIdx] : 0.0;
    sB[ty][tx] = (t * 16u + ty < p.K && col < p.N) ? b[bIdx] : 0.0;
    barrier();
    for (uint k = 0; k < 16u; ++k) acc += sA[ty][k] * sB[k][tx];
    barrier();
  }
  if (row < p.M && col < p.N) c[row * p.N + col] = acc;
}
`;

// GELU (tanh approximation) — elementwise
const GELU = VERSION + `
layout(local_size_x = 256, local_size_y = 1, local_size_z = 1) in;
layout(std430, binding = 0) readonly buffer X { float x[]; };
layout(std430, binding = 1) writeonly buffer Y { float y[]; };
layout(std140, binding = 2) uniform P { uint N; } p;
void main() {
  uint i = gl_GlobalInvocationID.x;
  if (i >= p.N) return;
  float v = x[i];
  y[i] = 0.5 * v * (1.0 + tanh(0.7978845608 * (v + 0.044715 * v * v * v)));
}
`;

// LayerNorm — mean/var reduction over the last dim
const LAYERNORM = VERSION + `
layout(local_size_x = 256, local_size_y = 1, local_size_z = 1) in;
layout(std430, binding = 0) readonly buffer X { float x[]; };
layout(std430, binding = 1) readonly buffer G { float g[]; };
layout(std430, binding = 2) readonly buffer B { float b[]; };
layout(std430, binding = 3) writeonly buffer Y { float y[]; };
layout(std140, binding = 4) uniform P { uint rows; uint cols; float eps; } p;
shared float ssum[256];
shared float svar[256];
void main() {
  uint r = gl_GlobalInvocationID.x;
  if (r >= p.rows) return;
  uint t = gl_LocalInvocationID.x;
  float sum = 0.0, sq = 0.0;
  for (uint c = t; c < p.cols; c += 256u) {
    float v = x[r * p.cols + c];
    sum += v; sq += v * v;
  }
  ssum[t] = sum; svar[t] = sq;
  barrier();
  for (uint s = 128u; s > 0u; s >>= 1u) {
    if (t < s) { ssum[t] += ssum[t + s]; svar[t] += svar[t + s]; }
    barrier();
  }
  if (t == 0u) { ssum[0] /= float(p.cols); svar[0] = svar[0] / float(p.cols) - ssum[0] * ssum[0]; }
  barrier();
  float mean = ssum[0];
  float var = svar[0];
  for (uint c = t; c < p.cols; c += 256u) {
    uint i = r * p.cols + c;
    y[i] = (x[i] - mean) / sqrt(var + p.eps) * g[c] + b[c];
  }
}
`;

module.exports = { MATMUL, GELU, LAYERNORM, VERSION };
