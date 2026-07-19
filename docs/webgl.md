# WebGL Bindings

`rmsl/webgl` runs a compiled program and feeds it data. Where the rest of RMSL
describes a shader, this describes talking to one.

The idea: `uniform("vec3")` gives you a node that already knows its shader type
and has its own unique name. So writing it needs neither.

```typescript
import { uniform, Fn, vec4 } from "rmsl";
import { createWebGLProgram } from "rmsl/webgl";

let colour = uniform("vec3");

let { program, set } = createWebGLProgram(gl, vertexMain(), fragmentMain());

gl.useProgram(program);
set(colour, 1, 0, 0);
```

No name string, no schema, no `getUniformLocation`. `set(colour, 1, 0)` is a
compile error, because `colour` is a `vec3` and the node says so.

## Requirements

**WebGL2 only.** RMSL emits `#version 300 es`, which WebGL1 cannot load. Get
your context with `canvas.getContext("webgl2")`.

## createWebGLProgram

```typescript
createWebGLProgram(
  gl: WebGL2RenderingContext,
  vertexRoot: VertexRoot,
  fragmentRoot: Node<ShaderType> | Node<ShaderType>[],
): { program: WebGLProgram; set: Setter }
```

Compiles both stages, links them, and reads back which uniforms survived.

A vertex stage produces a position, so `vertexRoot` is
`Node<"vec4"> | Node<"vec4">[] | void` — the compiler will not accept anything
that cannot become one. Return an array when the stage has several results, in
which case the last one becomes the position; return nothing when you assign
`builtinPosition()` yourself.

Throws if either shader fails to compile or if the program fails to link. A
compile error names the stage and includes the generated source, since the line
numbers a driver reports refer to that rather than to your node graph; a link
error carries the driver's log. Nothing is left allocated on the context when
it throws.

## set

One function for every kind of uniform. What it accepts depends on the node you
hand it.

```typescript
set(scale, 2.0);                 // float
set(colour, 1, 0, 0);            // vec3  — components
set(visible, true);              // bool  — booleans work
set(mvp, matrix);                // mat4  — one buffer
set(bricks, positions);          // vec4[] — one flat buffer
```

### Why some take components and others a buffer

It follows WebGL's own API. WebGL has positioned setters for scalars and
vectors (`uniform3f`), and only buffer setters for anything larger — there is
no `uniformMatrix4f`, only `uniformMatrix4fv`.

| Uniform | Form | Underlying call |
| --- | --- | --- |
| scalars, vectors | components | `uniform3f`, `uniform2i`, … |
| matrices | one buffer | `uniformMatrix4fv`, … |
| arrays of anything | one buffer | `uniform4fv`, `uniformMatrix4fv`, … |

The practical line is four numbers: beyond that WebGL only offers a buffer, and
so does this.

### Single values

| Shader type | Arguments |
| --- | --- |
| `float`, `int`, `uint` | one number |
| `vec2`, `vec3`, `vec4` | 2, 3 or 4 numbers |
| `bool` | one `boolean` or number |
| `bvec2`, `bvec3`, `bvec4` | 2, 3 or 4 `boolean`s or numbers |
| `mat2`, `mat3`, `mat4` | one `Float32Array`, or exactly as many numbers as the matrix holds |
| `mat2x3`, `mat2x4`, `mat3x2`, `mat3x4`, `mat4x2`, `mat4x3` | the same — non-square matrices behave identically |
| `sampler2D`, `samplerCube` | one number — the texture unit, not the texture |

Matrix lengths are checked at compile time, counting columns × rows. `mat4`
wants 16, `mat3` wants 9, and `mat2x3` and `mat3x2` both want 6:

```typescript
set(mvp, new Float32Array(16));       // fine
set(mvp, [/* 16 numbers */]);         // fine
set(mvp, [/* 9 numbers */]);          // compile error
```

Note that a `number[]` *variable* is not accepted where an inline list is —
only a `Float32Array` or a literal of the right length. Convert with
`new Float32Array(values)` if you are holding a plain array.

### Arrays

`uniformArray("vec4", 24)` declares a uniform holding a list. Writing it takes
one flat buffer of every element's components, end to end:

```typescript
let bricks = uniformArray("vec4", 24);

set(bricks, new Float32Array(96));    // 24 × 4 components
```

The length is checked at run time, because only then is it known:

```
[RMSL] vec4[24] needs 96 numbers, got 40.
```

Which buffer type each element takes:

| Element type | Buffer |
| --- | --- |
| `float`, all vectors, all matrices | `Float32Array` or `number[]` |
| `int`, `bool`, all `bvec` | `Int32Array` or `number[]` |
| `uint` | `Uint32Array` or `number[]` |

Booleans are numbers here, unlike the single-value case. Converting one value
is free; converting a whole array would copy it on every upload, which is the
cost a bulk write exists to avoid.

Texture arrays are not available — `uniformArray("sampler2D", n)` throws,
because WGSL has no equivalent, so there is no spelling both backends share.

## Binding the program

`set` does not call `gl.useProgram`. You do, once, before setting anything:

```typescript
gl.useProgram(program);
set(colour, 1, 0, 0);
set(scale, 2.0);
```

This matches raw WebGL and every other library, and avoids a redundant state
change per uniform per frame. The cost is that forgetting it writes to whatever
program *is* bound, which WebGL reports as an `INVALID_OPERATION` on the
context rather than by throwing.

## When a uniform is missing

Setting a uniform the program does not have does nothing, and warns once:

```
[RMSL] The uniform _rmsl_u3 (float) is not part of this program, so setting it
does nothing. Usually this means GLSL removed it, which it does to any uniform
whose value cannot reach the shader's output.
```

This is usually not a mistake. GLSL discards any uniform whose value cannot
affect the output — one that only feeds a branch nothing reads, or is
multiplied by zero. That is why locations are read back from the linked program
rather than taken from the compiler: the compiler knows what was written, and
only the program knows what survived.

It warns once per uniform rather than once per call, because a render loop
would otherwise fill the console.

## Names

The name on a node (`_rmsl_u0`) is generated from a counter, so it shifts with
the order your modules evaluate. It is used only to match a node against the
linked program. Do not depend on it.

If you need a fixed name — to share a program with hand-written GLSL, say —
`uniformRaw("myName", "vec3")` gives you one.

## Not covered yet

Uniforms only, for now. Attributes, buffers, interleaved vertex data, textures
and framebuffers are still set up by hand:

```typescript
let location = gl.getAttribLocation(program, quadPos.name);
gl.enableVertexAttribArray(location);
gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
```

There is also no disposal helper; delete the program yourself with
`gl.deleteProgram` when you are done with it.

## Types

Exported for when you need to name them:

- `Setter` — the type of `set`
- `UniformArgs` — arguments each shader type takes as a single value
- `ArrayData` — buffer each element type takes in bulk
- `SettableType`, `SettableArrayType` — shader types that can be written
- `Mat<N>`, `Tuple<N, T>` — the fixed-length matrix contents

`reflectUniforms(gl, program)` is also exported, returning every uniform the
linked program actually has, keyed by name. `createWebGLProgram` calls it for
you; it is public for anyone building on top.

## Known limitation: type resolution

The published types do not resolve under TypeScript's `node16` / `nodenext`
module resolution — with `skipLibCheck: true` they silently become `any`, so
`set` stops being checked while appearing to work.

Use `"moduleResolution": "bundler"`, which is the normal setting for a bundled
browser application and what RMSL itself uses.
