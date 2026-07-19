# `rmsl/webgl` — WebGL resource bindings keyed by node

Status: draft for review
Date: 2026-07-19
Baseline surveyed: `@bigmistqke/view.gl` @ 43db332

## Goal

Give rmsl a host-side API for feeding data into a compiled program, so that
setting a uniform is type-checked against the shader type that declared it and
does not require restating names or types.

The target shape:

```ts
let uTime = uniform("float")
let uView = uniform("mat4")

let { program, set } = createWebGLProgram(gl, vertexRoot, fragmentRoot)

gl.useProgram(program)
set(uTime, 0.5)
set(uView, matrix)
```

## The keying model

**A node is the handle.** `uniform("mat4")` already returns a value that is
unique, carries its shader type in the type system, and survives the `Fn`
closure. Nothing further needs declaring.

Two channels carry the same fact, deliberately:

- **Type level** — `A` is recovered from `UniformNode<A>` through the
  `[__brand]: A` property on `BaseNode`. This is what makes the argument tuple
  resolve. Verified empirically: `set(uPos, 1)` on a `vec3` reports "Expected 4
  arguments, but got 2".
- **Runtime** — `node._t` holds the type as a string. It is typed `string`, not
  `A` (`src/rmsl.ts:29`), so it cannot be used for type dispatch and is read
  only to pick the GL call.

That split needs a comment at the definition or it will be "simplified" into
breakage.

**Names are internal.** `uniform()` mints `_rmsl_u0` from a module counter, so
names shift with evaluation order and are never a stable contract. They are used
solely as the join key against `getUniformLocation` / `getAttribLocation`.

### Why there is no schema

An earlier iteration had the caller pass a manifest mapping names to nodes.
Rejected: it duplicates knowledge the graph already holds, so it can drift from
what the shader actually uses, and nothing checks it.

The test applied throughout this design: **a declaration is legitimate when it
is the only home for the fact, and suspect when something else already knows
it.** Uniform and attribute bindings fail that test — the node knows. Interleave
layouts pass it — how bytes are packed into a buffer exists nowhere else.

## Scope relative to view.gl

### Dropped — not expressible in rmsl, or not needed

| Dropped | Reason |
| --- | --- |
| `toID` symbol aliasing, `SYMBOL_MAP`, Firefox `WeakMap`-symbol workaround | Nodes are already unique; the problem this solves does not exist |
| WebGL1 support, `features.ts`, ANGLE / OES extension wrappers | rmsl emits `#version 300 es` (`src/rmsl.ts:1697`) — WebGL2 only |
| Array uniforms (`size`, `UniformArrayMethods`, bulk vs element setters) | rmsl's `uniform()` takes no size; arrays are not expressible |
| `ivec2/3/4`, `uvec2/3/4` | Absent from rmsl's `ShaderType` |
| `sampler3D`, `sampler2DArray`, shadow samplers, `isampler*`, `usampler*` | rmsl has only `sampler2D` and `samplerCube` |
| `ViewSchema`, `GLSLToSchema`, `MergeGLSLSchema`, `DeepMerge`/`ShallowMerge` | No schema exists to merge |

Requiring WebGL2 also removes the `@ts-ignore FIX WEBGL/WEBGL2 TYPES` markers —
they exist only because `GL` is a union that defeats indexed access.

### Kept

Uniforms, attributes (incl. instancing), interleaved attributes (incl. VAO),
standalone buffers for element/index data, `createProgram`, `createTexture`,
`createFramebuffer`, and `AbortSignal`-based disposal.

## Type coverage

Keyed on rmsl's `ShaderType` (`src/rmsl.ts:4-12`), excluding `void`.

| Shader type | GL call | Argument tuple |
| --- | --- | --- |
| `float` | `uniform1f` | `[number]` |
| `vec2` / `vec3` / `vec4` | `uniform2f` / `3f` / `4f` | `[number, number]` … |
| `int` | `uniform1i` | `[number]` |
| `uint` | `uniform1ui` | `[number]` |
| `bool` | `uniform1i` | `[boolean \| number]` |
| `bvec2` / `bvec3` / `bvec4` | `uniform2i` / `3i` / `4i` | `[boolean \| number, …]` |
| `mat2` | `uniformMatrix2fv` | `[Mat<4>]` |
| `mat2x3` / `mat3x2` | `uniformMatrix2x3fv` / `3x2fv` | `[Mat<6>]` |
| `mat2x4` / `mat4x2` | `uniformMatrix2x4fv` / `4x2fv` | `[Mat<8>]` |
| `mat3` | `uniformMatrix3fv` | `[Mat<9>]` |
| `mat3x4` / `mat4x3` | `uniformMatrix3x4fv` / `4x3fv` | `[Mat<12>]` |
| `mat4` | `uniformMatrix4fv` | `[Mat<16>]` |
| `sampler2D`, `samplerCube` | `uniform1i` | `[number]` (texture unit) |

`Mat<N> = Float32Array | Tuple<N, number>`, a single argument.

The table is an explicit object literal, not derived by string-munging the type
name. view.gl derives it (`kindToUniformFnName`) and that is the direct cause of
three of the bugs listed below.

## Deliberate divergences

**Matrices take one argument with a checked length.** view.gl's
`MatrixArray<Size>` ignores `Size` — every matrix kind resolves to
`[Float32Array] | number[]`, so no arity is checked. Worse, the runtime does
`fn(location, false, args[0])`, meaning the `number[]` variadic arm is a lie:
`mat4.set(1, 0, 0, …)` passes only `1`. Here the type matches the runtime, and
`Tuple<N, number>` gives real arity checking.

**Booleans are booleans.** `bool`/`bvec*` accept `boolean` and coerce to `0`/`1`.
view.gl types them `[number]`.

**Integer attributes use `vertexAttribIPointer`.** view.gl's type comments
promise this but `handleAttribute` always calls `vertexAttribPointer`.

**Attribute GL type comes from the table, not `startsWith('i')`.** view.gl's
prefix test classifies `uint`/`uvec*` (leading `u`) and `bool`/`bvec*` (leading
`b`) as `FLOAT`.

**Component size comes from the table, not `* 4`.** view.gl's interleave
hard-codes 4 bytes per component.

**Matrix attributes are rejected explicitly.** A `mat4` attribute needs four
consecutive locations. view.gl permits the kind and emits a single location with
size 16, which silently exceeds the 4-component limit. Until this is
implemented, `set` on a matrix attribute throws with a message saying so.

## Bugs found in view.gl — fix, do not port

Latent but currently masked:

- `kindToUniformFnName` takes the first digit in the kind name, so `sampler2D`
  yields `"2i"` (`gl.uniform2i`) and `usampler2D` yields `"pui"`. Unreachable
  only because `uniformView` special-cases samplers before consulting the table.
- Sampler arrays type as `UniformArrayMethods` but the runtime returns a bare
  `{ set }` with no elements.

Live:

- `createTexture` logs `console.log(minFilter)` on every call.
- `FramebufferError` and `createFramebuffer` interpolate a `${name}` that is
  neither parameter nor local — it resolves to the global `window.name`.
- Cube maps are typed but unimplemented (one `texImage2D` against the target
  enum; six face enums required).
- `createTexture` does not null-check `gl.createTexture()`.

Leaks:

- `createProgram` has no `try`/`finally`: if the vertex shader compiles and the
  fragment shader throws, the program and vertex shader both leak.
- `createFramebuffer` leaks the framebuffer and any internally created texture
  when the completeness check throws.
- `createUpsertMap.getOrInsert` tests truthiness rather than `has()`, so a
  cached `0` / `''` / `false` re-runs the factory every call.

Contract:

- `View` declares all four sections required (falling back to `{}`) but `view()`
  assigns `undefined`, laundered through `as`.
- `attributeView` throws on an unknown attribute while `uniformView` silently
  accepts a null location — an asymmetry worth resolving deliberately.

## Slices

Each is independently shippable.

### Slice 1 — uniforms

- `UniformArgs`, the explicit table above.
- `set<A>(node: UniformNode<A>, ...args: UniformArgs[A])`.
- `reflect(gl, program)` — one `ACTIVE_UNIFORMS` loop into
  `Map<name, WebGLUniformLocation>`. Ground truth *after* GLSL dead-code
  elimination, which is why this beats reading `ctx.uniforms` out of the
  compiler.
- `createWebGLProgram(gl, vertexRoot, fragmentRoot)` — compile via existing
  `compileGLSL`, link, reflect, return `{ program, set }`. `try`/`finally`
  around shader creation.
- Warn-once on a node with no active location.

`set` does **not** bind the program. The caller does, matching view.gl and raw
WebGL, and avoiding a redundant state change per call in a render loop.

The warning must be worded as informational, not as an error: the most common
cause is not a typo but GLSL legitimately eliminating a uniform that only fed an
unused branch. It must fire at most once per node or a render loop floods the
console.

### Slice 2 — attributes and buffers

`set(node, data, usage?)` uploads; `bind(node)` binds. `instanced` needs a home
— it is a property of the binding, not of the node, so it belongs on `bind` or a
per-node option at program creation. Open.

Standalone buffers stay name-free and un-keyed: index/element buffers are not
shader inputs, so no node exists to key them by.

### Slice 3 — interleaved attributes

```ts
let vertexData = interleave([position, uv, normal])
set(vertexData, buffer)
```

The ordered array *is* the layout; stride and offsets derive from each node's
`_t`. This is constitutive information — GL cannot reflect it and the graph does
not know it — so an explicit declaration here does not reintroduce the manifest
problem.

VAO handling carries over from view.gl unchanged in spirit, minus the OES
fallback.

### Slice 4 — textures and framebuffers

Largely a cleaned-up port of `view.gl/utils`, with `sampler2D` nodes bound to
texture units. Least novel, most mechanical.

## Disposal

`AbortSignal`, as view.gl does — `createWebGLProgram(gl, v, f, { signal })`
deletes the program, buffers and VAOs on abort. It composes with the rest of the
platform and rmsl has no competing lifecycle convention to honour.

## Verification

The `src/testing/` harness gives a real WebGL2 context under Playwright, so
behaviour is checked by observation, not by mocking:

- **Uniforms** — render a shader whose output depends on a uniform, `set` it,
  read the pixel back. Proves the value reached the right location, not merely
  that the call did not throw. One case per type in the coverage table.
- **Types** — `test:types` (`vitest --typecheck.only`) makes the `UniformArgs`
  inference and matrix arity permanent tests rather than a one-off probe.
  Includes negative cases: wrong arity, wrong element type, matrix of wrong
  length.
- **Warnings** — a uniform declared but eliminated by GLSL warns once, and not
  twice.
- **Demo** — `apps/infinite-grid/src/main.ts:89-94` and `:172-176` convert to
  `set` calls, and the grid still renders.

## Open questions

1. Matrix arity — enforce exact `Tuple<N, number>`, or accept `number[]` and
   check length at runtime? Exact tuples give real checking but produce long
   error messages at N=16.
2. Where does `instanced` live (slice 2)?
3. Should `set` on an unknown *attribute* throw, matching view.gl, while an
   unknown uniform only warns? Or should both warn?
4. Are textures wanted at all in the first pass, or is slice 4 deferred
   indefinitely until something needs it?
