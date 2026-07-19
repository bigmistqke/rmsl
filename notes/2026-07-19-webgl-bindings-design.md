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

### One `set`, and the upstream change that allows it

`UniformNode`, `AttributeNode` and `VaryingNode` were aliases of
`VariableNode<A>` — one type wearing three names. Nothing could tell them
apart, so a setter meant for uniforms accepted an attribute or a varying
silently, and the mistake surfaced only as a lookup that found nothing.

The discriminant was there at runtime the whole time: each constructor writes
`type: "uniform"` / `"attribute"` / `"varying"`. Only the declaration was
vague, saying `string`. Narrowing each alias to the literal its constructor
already writes makes the type honest, and costs three lines:

```ts
export type UniformNode<A extends ShaderType> = VariableNode<A> & { readonly type: "uniform" };
export type AttributeNode<A extends ShaderType> = VariableNode<A> & { readonly type: "attribute" };
export type VaryingNode<A extends ShaderType> = VariableNode<A> & { readonly type: "varying" };
```

That buys a single `set` whose arguments follow the kind of node handed to it,
rather than one function per kind:

```ts
set(uColour, 1, 0, 0)                  // uniform: components
set(quadPos, buffer, "DYNAMIC_DRAW")   // attribute: a buffer  (slice 2)

set(uColour, buffer)                   // rejected
set(quadPos, 1, 0)                     // rejected
set(vNormal, 1, 2, 3)                  // rejected: written by the shader
```

Verified against the existing suite: `type-check` clean, 172 passed / 18
skipped unchanged, 13 type tests pass, and `apps/infinite-grid` type-checks
against the built `dist`. Landed ahead of the slice as its own commit.

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
| WebGL1 support, `features.ts`, ANGLE / OES extension wrappers | rmsl emits `#version 300 es` (`src/rmsl.ts:1697`) — WebGL2 only. **Assumption, see below** |
| `ivec2/3/4`, `uvec2/3/4` | Absent from rmsl's `ShaderType` |
| `sampler3D`, `sampler2DArray`, shadow samplers, `isampler*`, `usampler*` | rmsl has only `sampler2D` and `samplerCube` |
| `ViewSchema`, `GLSLToSchema`, `MergeGLSLSchema`, `DeepMerge`/`ShallowMerge` | No schema exists to merge |

Requiring WebGL2 also removes the `@ts-ignore FIX WEBGL/WEBGL2 TYPES` markers —
they exist only because `GL` is a union that defeats indexed access.

### Assumption: WebGL2 only

`compileGLSLWithStage` emits `#version 300 es` unconditionally *today*, but that
is a current property of the compiler, not a commitment. If rmsl ever gains a
GLSL ES 1.0 backend, this entry point has to grow WebGL1 support back.

Blast radius if that happens, so the cost is known up front:

- `features.ts` returns — extension detection for instancing and VAOs.
- `uint` and the six non-square matrix kinds lose their setters
  (`uniform1ui`, `uniformMatrix2x3fv` and friends are WebGL2-only), so
  `UniformArgs` needs to become version-aware or those kinds must throw.
- `GL` becomes a union again, and indexed access into it stops type-checking —
  the thing view.gl papers over with `@ts-ignore`.

The design does not try to anticipate this. It takes a hard dependency on
`WebGL2RenderingContext` and states it, so a future GLSL ES 1.0 backend arrives
as a deliberate piece of work rather than a surprise.

### Array uniforms

Landed on `apps/breakout` (`89ea271`), not yet on the base this worktree sits
on:

```ts
export interface UniformArrayNode<A extends ShaderType> {
  readonly name: string;
  readonly length: number;
  element(index: IntLike | FloatLike): Node<A>;
}

const bricks = uniformArray("vec4", 24);
```

`UniformArrayNode<A>` is deliberately **not** a `Node<A>` — the array itself has
no operations, only its elements do. So it is a separate type, not a variant of
`UniformNode<A>`, and `set` takes two overloads rather than one widened
signature:

```ts
set<A>(node: UniformNode<A>, ...args: UniformArgs[A]): void
set<A>(node: UniformArrayNode<A>, data: Float32Array | number[]): void
```

`UniformArgs` stays keyed on the element type and is reused by both — array-ness
is an axis, not a kind. Uploading is `uniform{N}fv` / `uniformMatrix{N}fv` with
the element type's suffix.

Three things this forces:

- **`getActiveUniform` reports array uniforms as `_rmsl_u3[0]`**, not
  `_rmsl_u3`. The reflect loop must strip a trailing `[0]` or every array lookup
  misses.
- **Length is checkable.** `getActiveUniform` reports `size` as the array
  length, and `UniformArrayNode` carries `length`. A mismatch means the shader
  and the host disagree, and is worth warning about. view.gl cannot do this —
  its `size` comes from the same declaration it would be validating.
- **No element-wise setter for free.** `element()` returns an expression node,
  not a handle. Bulk upload is the primary operation; `setElement(node, i, …)`
  can follow later if wanted.

The interface exposes `name` and `length` but not `_t`, though it is present at
runtime. Runtime dispatch needs a cast, or the interface needs `_t` added
upstream.

Two things from view.gl to avoid: the phantom `TSize` that leaves
`UniformArrayMethods` index-unchecked, and the sampler branch that returns a
scalar setter for something typed as an array (issue #2, items 1 and 3).

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

`Mat<N> = Float32Array | Tuple<N, number>`, a single argument, where `Tuple` is
built recursively so the length is checked at compile time:

```ts
type Tuple<N extends number, T, R extends T[] = []> =
  R["length"] extends N ? R : Tuple<N, T, [...R, T]>
```

The cost is a long error message when a `mat4` literal is the wrong length —
accepted, because the alternative is view.gl's phantom `Size`, which checks
nothing.

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

## Open for the project, not for this slice

**Module resolution — a known limitation, accepted for now.**

`rmsl/webgl` does not resolve under TypeScript's `node16` / `nodenext` module
resolution. The published declarations name their relative imports without a
file extension (`from "./program"`), which those modes reject. With
`skipLibCheck: true`, which most consumers set, there is no error at all —
every type in the entry point silently becomes `any`, so `set` stops being
checked while appearing to work.

Consumers on `moduleResolution: "bundler"` — which a bundled browser app
normally uses, and which this project uses itself — are unaffected.

**Decision:** start by not supporting `node16`. A WebGL binding is consumed by
browser applications, which are bundled, so the affected audience is someone
type-checking a browser project under `nodenext`. Rather than half-solve it
here, the project settles module resolution once, for every entry point.

Two approaches were tried and backed out, recorded so they are not
rediscovered:

- **Writing `.js` in the source specifiers.** Works — the declaration emitter
  copies whatever the source wrote, and `bundler` resolution accepts the
  extension too, so no config change is needed. But it leaves four imports
  carrying an extension this project does not otherwise use, with nothing
  enforcing the next one.
- **A second tsconfig checking the published sources under `node16`**, wired
  into `type-check`. Reports the error at the offending import with the
  correction. Backed out for solving in one directory what belongs to the
  whole codebase.

The principled fix is for the project to adopt `nodenext` itself, which
enforces the rule everywhere — at the cost of an extension on every relative
import in `src/`.

Also rejected: `bundleTypes` (api-extractor), which would remove relative
imports from the declarations entirely. It re-declares `BaseNode`'s private
`__brand` symbol per entry, so a `Node` from `rmsl` and a `UniformNode` from
`rmsl/webgl` stop being the same type. `apps/infinite-grid` imports from both
and fails to type-check the moment it is enabled.

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
5. ~~What shape do array uniforms take on the node?~~ Resolved: `uniformArray`
   on `apps/breakout` returns a distinct `UniformArrayNode<A>`, so `set` gets a
   second overload. See above.
6. ~~Which base does slice 1 build on?~~ Resolved: stay on
   `fix/compiler-codegen-bugs`, ship scalar-only, add the array overload when
   `apps/breakout` lands. See below.

## Sequencing against the array work

`apps/breakout` has diverged from this worktree's base rather than branching off
it, and cherry-picking was tried and rejected: `d861d41` conflicts on
`src/rmsl.ts` on contact, and it is the WIP commit where `uniformArray` starts —
tangled with the breakout renderer — so the two clean commits after it cannot be
taken on their own.

Forcing it would also fork a feature that is being actively written elsewhere,
leaving two copies of `uniformArray` to drift apart in the file both branches
touch most.

Slice 1 therefore ships scalar-only. What arrays add later is bounded and known:

- a second `set` overload (above),
- stripping a trailing `[0]` in the reflect loop,
- an optional length cross-check against `getActiveUniform`'s reported `size`.

Nothing about scalar `set`, `UniformArgs` or `createWebGLProgram` changes shape.
The only thing deferred is an end-to-end array test.
