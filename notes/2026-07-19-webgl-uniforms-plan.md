# `rmsl/webgl` Slice 1 — Node-Keyed Uniform Setters: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `rmsl/webgl` entry point where `set(node, ...value)` writes a uniform, with argument types inferred from the node's shader type and no names or schemas restated.

**Architecture:** A uniform node is the handle. Types come from the generic parameter via `BaseNode`'s `[__brand]`; the runtime reads `node._t` as a string to pick the GL call from an explicit table. Locations come from reflecting the linked program, so the ground truth is what survived GLSL's dead-code elimination.

**Tech Stack:** TypeScript, Vite (library build, two entries), Vitest (runtime + `--typecheck`), Playwright + SwiftShader for the real-context test.

## Global Constraints

- Design spec: `notes/2026-07-19-webgl-bindings-design.md`. Read it first.
- **Target is WebGL2 only.** Type every context as `WebGL2RenderingContext`, never a union with `WebGLRenderingContext`.
- **`src/webgl/uniforms.ts` must have no runtime imports.** Every import from `../rmsl` must be `import type`. Task 5 transpiles this file standalone and injects it into a browser page; a runtime import breaks that.
- Scalar uniforms only. `uniformArray` lives on the unmerged `apps/breakout`; the array overload is deliberate follow-up work.
- Never write `Co-Authored-By:` or `Claude-Session:` trailers in commit messages.
- Design docs and plans go in `notes/`, never `docs/` — `docs/` is user-facing.
- Test commands: `pnpm test:fast` (no GPU), `pnpm test` (with GPU), `pnpm test:types` (type-level), `pnpm type-check`.
- Existing code style: two-space indent, double-quoted strings, semicolons, `let` over `const` for locals in `src/rmsl.ts`. Comments explain *why*, not *what* — match `src/rmsl.test-d.ts`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/webgl/uniforms.ts` | Argument-type tables, the GL dispatch table, `createUniformSetter`. No runtime imports. |
| `src/webgl/program.ts` | `reflectUniforms`, `createWebGLProgram`. Imports `compileGLSL` at runtime. |
| `src/webgl/index.ts` | Public entry point; re-exports only. |
| `src/webgl/uniforms.test.ts` | Dispatch verified against a recording stub. |
| `src/webgl/uniforms.test-d.ts` | Type-level tests, positive and negative. |
| `src/webgl/program.test.ts` | Reflection and link behaviour against a stub. |
| `src/webgl/webgl.gpu.test.ts` | One end-to-end test in a real WebGL2 context. |
| `vite.config.ts` | Second library entry. |
| `package.json` | `exports` map for the subpath. |

---

### Task 1: Argument type tables

**Files:**
- Create: `src/webgl/uniforms.ts`
- Test: `src/webgl/uniforms.test-d.ts`

**Interfaces:**
- Consumes: `UniformNode`, `ShaderType` from `../rmsl` (type-only).
- Produces: `UniformArgs` (interface keyed by shader type), `SettableType`, `Tuple<N, T>`, `Mat<N>`.

- [ ] **Step 1: Write the failing type test**

Create `src/webgl/uniforms.test-d.ts`:

```ts
/**
 * Type-level tests for the uniform argument tables.
 *
 * The whole point of keying by node is that the argument list is derived from
 * the shader type rather than restated. That derivation is invisible to a
 * runtime assertion — a table that resolved every type to `number[]` would
 * pass every dispatch test in uniforms.test.ts — so it is pinned here.
 */

import { describe, it, expectTypeOf } from "vitest";
import type { UniformArgs, Mat, Tuple } from "./uniforms";

describe("argument tuples", () => {
  it("gives each scalar and vector its component count", () => {
    expectTypeOf<UniformArgs["float"]>().toEqualTypeOf<[number]>();
    expectTypeOf<UniformArgs["vec2"]>().toEqualTypeOf<[number, number]>();
    expectTypeOf<UniformArgs["vec3"]>().toEqualTypeOf<[number, number, number]>();
    expectTypeOf<UniformArgs["vec4"]>().toEqualTypeOf<[number, number, number, number]>();
  });

  // GLSL sets booleans through uniform1i, but making the caller pass 0 and 1
  // leaks that detail. Numbers stay allowed so an existing 0/1 still works.
  it("accepts booleans for bool and bvec", () => {
    expectTypeOf<UniformArgs["bool"]>().toEqualTypeOf<[boolean | number]>();
    expectTypeOf<UniformArgs["bvec2"]>().toEqualTypeOf<
      [boolean | number, boolean | number]
    >();
  });

  // A sampler is set to a texture unit index, not to a texture.
  it("takes a unit index for samplers", () => {
    expectTypeOf<UniformArgs["sampler2D"]>().toEqualTypeOf<[number]>();
    expectTypeOf<UniformArgs["samplerCube"]>().toEqualTypeOf<[number]>();
  });
});

describe("matrix lengths", () => {
  // view.gl's equivalent takes a Size parameter and then ignores it, so mat2
  // and mat4 accept identical arguments and a wrong-length literal is written
  // to the GPU unchecked. Tuple<N> is what makes the length mean something.
  it("counts elements as columns times rows", () => {
    expectTypeOf<Tuple<4, number>>().toEqualTypeOf<[number, number, number, number]>();
    expectTypeOf<UniformArgs["mat2"]>().toEqualTypeOf<[Mat<4>]>();
    expectTypeOf<UniformArgs["mat3"]>().toEqualTypeOf<[Mat<9>]>();
    expectTypeOf<UniformArgs["mat4"]>().toEqualTypeOf<[Mat<16>]>();
    expectTypeOf<UniformArgs["mat2x3"]>().toEqualTypeOf<[Mat<6>]>();
    expectTypeOf<UniformArgs["mat3x2"]>().toEqualTypeOf<[Mat<6>]>();
    expectTypeOf<UniformArgs["mat2x4"]>().toEqualTypeOf<[Mat<8>]>();
    expectTypeOf<UniformArgs["mat4x2"]>().toEqualTypeOf<[Mat<8>]>();
    expectTypeOf<UniformArgs["mat3x4"]>().toEqualTypeOf<[Mat<12>]>();
    expectTypeOf<UniformArgs["mat4x3"]>().toEqualTypeOf<[Mat<12>]>();
  });

  it("takes a Float32Array or an exactly sized array", () => {
    expectTypeOf<Float32Array>().toMatchTypeOf<Mat<16>>();
    expectTypeOf<[1, 2, 3, 4]>().toMatchTypeOf<Mat<4>>();
  });
});

describe("void", () => {
  // `void` is in ShaderType because a statement has a type, but it is not
  // something a host can write.
  it("is not settable", () => {
    expectTypeOf<"void">().not.toMatchTypeOf<keyof UniformArgs>();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:types`
Expected: FAIL — `Cannot find module './uniforms'`.

- [ ] **Step 3: Write the tables**

Create `src/webgl/uniforms.ts`:

```ts
/**
 * Argument tables for writing a uniform.
 *
 * A uniform node already carries its shader type, so the host should not have
 * to restate it. `UniformArgs` turns that type into the argument list, and the
 * dispatch table turns it into the GL call.
 *
 * This file must have no runtime imports. It is transpiled on its own and
 * injected into a browser page by the end-to-end test, where an import would
 * not resolve.
 */

import type { ShaderType } from "../rmsl";

/**
 * A fixed-length array, built one element at a time.
 *
 * A matrix has an exact element count, and the alternative — accepting
 * `number[]` — cannot tell a mat3 from a mat4. That is a live bug in the
 * library this design draws from: its length parameter is declared and then
 * never used, so a nine-element array is written to a mat4 without complaint.
 */
export type Tuple<N extends number, T, R extends T[] = []> =
  R["length"] extends N ? R : Tuple<N, T, [...R, T]>;

/** Matrix contents: a typed array, or exactly as many numbers as it holds. */
export type Mat<N extends number> = Float32Array | Tuple<N, number>;

/** A boolean uniform is set through an integer call, so either form works. */
type Bool = boolean | number;

/**
 * The arguments each shader type takes.
 *
 * Written out rather than derived from the type's name. Deriving it is what
 * makes `sampler2D` resolve to `uniform2i` in the library this replaces — the
 * derivation reads the 2 out of "2D".
 */
export interface UniformArgs {
  float: [number];
  vec2: [number, number];
  vec3: [number, number, number];
  vec4: [number, number, number, number];

  int: [number];
  uint: [number];

  bool: [Bool];
  bvec2: [Bool, Bool];
  bvec3: [Bool, Bool, Bool];
  bvec4: [Bool, Bool, Bool, Bool];

  // A GLSL matCxR is C columns of R rows, and the square names are the C === R
  // shorthand — so mat2x3 holds 6 and mat3x2 also holds 6.
  mat2: [Mat<4>];
  mat2x3: [Mat<6>];
  mat2x4: [Mat<8>];
  mat3x2: [Mat<6>];
  mat3: [Mat<9>];
  mat3x4: [Mat<12>];
  mat4x2: [Mat<8>];
  mat4x3: [Mat<12>];
  mat4: [Mat<16>];

  // A sampler is written with the index of the texture unit to read from.
  sampler2D: [number];
  samplerCube: [number];
}

/** Every shader type a host can write. `void` is the one that is excluded. */
export type SettableType = ShaderType & keyof UniformArgs;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test:types`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/webgl/uniforms.ts src/webgl/uniforms.test-d.ts
git commit -m "feat: describe what each uniform type expects to be written with"
```

---

### Task 2: The dispatch table and setter

**Files:**
- Modify: `src/webgl/uniforms.ts`
- Test: `src/webgl/uniforms.test.ts`, `src/webgl/uniforms.test-d.ts`

**Interfaces:**
- Consumes: `UniformArgs`, `SettableType` from Task 1.
- Produces:
  - `type SetUniform = <A extends SettableType>(node: UniformNode<A>, ...args: UniformArgs[A]) => void`
  - `createUniformSetter(gl: WebGL2RenderingContext, locations: Map<string, WebGLUniformLocation>): SetUniform`

- [ ] **Step 1: Write the failing dispatch test**

Create `src/webgl/uniforms.test.ts`:

```ts
/**
 * Checks which GL call each shader type produces, and with what arguments.
 *
 * A recording stub rather than a real context: this layer is a table lookup,
 * and the question it has to answer — did a vec3 become uniform3f with three
 * separate arguments, or uniform3fv with one — is answered exactly as well by
 * recording the call. The real context is exercised once, in webgl.gpu.test.ts,
 * which is where a wrong location or a stale program would show up instead.
 */

import { describe, it, expect, vi } from "vitest";
import { uniform } from "../rmsl";
import { createUniformSetter } from "./uniforms";

/** A stub recording every uniform call, standing in for a GL context. */
function recorder() {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const record = (fn: string) => (...args: unknown[]) => void calls.push({ fn, args });
  const gl = new Proxy({} as any, {
    get: (_, property: string) => record(property),
  });
  return { gl: gl as WebGL2RenderingContext, calls };
}

/** Builds a setter whose every lookup resolves, so dispatch is what is tested. */
function setterFor(node: { name: string }) {
  const { gl, calls } = recorder();
  const location = {} as WebGLUniformLocation;
  const set = createUniformSetter(gl, new Map([[node.name, location]]));
  return { set, calls, location };
}

describe("scalars and vectors", () => {
  it("writes a float through uniform1f", () => {
    const u = uniform("float");
    const { set, calls, location } = setterFor(u);
    set(u, 0.25);
    expect(calls).toEqual([{ fn: "uniform1f", args: [location, 0.25] }]);
  });

  // Components are passed separately rather than as an array: uniform3f and
  // uniform3fv are different calls and only one of them accepts three numbers.
  it("writes a vec3 through uniform3f with separate components", () => {
    const u = uniform("vec3");
    const { set, calls, location } = setterFor(u);
    set(u, 1, 2, 3);
    expect(calls).toEqual([{ fn: "uniform3f", args: [location, 1, 2, 3] }]);
  });

  it("writes an unsigned integer through uniform1ui", () => {
    const u = uniform("uint");
    const { set, calls, location } = setterFor(u);
    set(u, 7);
    expect(calls).toEqual([{ fn: "uniform1ui", args: [location, 7] }]);
  });
});

describe("booleans", () => {
  // GLSL has no boolean uniform call; it goes through the integer one.
  it("converts a boolean to the integer GLSL expects", () => {
    const u = uniform("bool");
    const { set, calls, location } = setterFor(u);
    set(u, true);
    expect(calls).toEqual([{ fn: "uniform1i", args: [location, 1] }]);
  });

  it("converts each component of a boolean vector", () => {
    const u = uniform("bvec3");
    const { set, calls, location } = setterFor(u);
    set(u, true, false, true);
    expect(calls).toEqual([{ fn: "uniform3i", args: [location, 1, 0, 1] }]);
  });
});

describe("matrices", () => {
  // The transpose flag is always false: GLSL stores columns first and so does
  // every matrix RMSL builds, so transposing would reverse a correct layout.
  it("writes a mat4 with transpose off", () => {
    const u = uniform("mat4");
    const { set, calls, location } = setterFor(u);
    const data = new Float32Array(16);
    set(u, data);
    expect(calls).toEqual([{ fn: "uniformMatrix4fv", args: [location, false, data] }]);
  });

  // Non-square matrices have their own calls, and the name is not derivable
  // from the type by trimming: mat3x2 uses uniformMatrix3x2fv, not Matrix2fv.
  it("gives each non-square matrix its own call", () => {
    for (const [type, fn] of [
      ["mat2x3", "uniformMatrix2x3fv"],
      ["mat2x4", "uniformMatrix2x4fv"],
      ["mat3x2", "uniformMatrix3x2fv"],
      ["mat3x4", "uniformMatrix3x4fv"],
      ["mat4x2", "uniformMatrix4x2fv"],
      ["mat4x3", "uniformMatrix4x3fv"],
    ] as const) {
      const u = uniform(type);
      const { set, calls } = setterFor(u);
      set(u as any, new Float32Array(16));
      expect(calls[0]!.fn).toBe(fn);
    }
  });
});

describe("samplers", () => {
  // Not uniform2i, which is what picking the digit out of "sampler2D" gives.
  it("writes a texture unit through uniform1i", () => {
    const u = uniform("sampler2D");
    const { set, calls, location } = setterFor(u);
    set(u, 3);
    expect(calls).toEqual([{ fn: "uniform1i", args: [location, 3] }]);
  });
});

describe("a uniform the program does not have", () => {
  // GLSL removes a uniform that only feeds a branch nothing reads, so this is
  // ordinary rather than a mistake. It must not throw, and it must not write.
  it("does nothing and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { gl, calls } = recorder();
    const u = uniform("float");
    const set = createUniformSetter(gl, new Map());

    set(u, 1);
    set(u, 2);
    set(u, 3);

    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain(u.name);
    warn.mockRestore();
  });

  // Two different missing uniforms are two different problems to report.
  it("warns separately for each node", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { gl } = recorder();
    const set = createUniformSetter(gl, new Map());

    set(uniform("float"), 1);
    set(uniform("float"), 2);

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/webgl/uniforms.test.ts`
Expected: FAIL — `createUniformSetter` is not exported.

- [ ] **Step 3: Write the dispatch table and setter**

First widen the existing import at the top of `src/webgl/uniforms.ts` — do not
add a second import statement lower down:

```ts
import type { ShaderType, UniformNode } from "../rmsl";
```

Then append the rest to the end of the file:

```ts
/** Writes one already-located uniform. Arguments are checked by `SetUniform`. */
type Writer = (
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation,
  args: any[],
) => void;

/** A boolean reaches GLSL as an integer, and so does a number already in use. */
function bit(value: boolean | number): number {
  return value ? 1 : 0;
}

/** Column-major is how GLSL stores a matrix and how RMSL builds one. */
const NO_TRANSPOSE = false;

const WRITERS: Record<SettableType, Writer> = {
  float: (gl, l, [x]) => gl.uniform1f(l, x),
  vec2: (gl, l, [x, y]) => gl.uniform2f(l, x, y),
  vec3: (gl, l, [x, y, z]) => gl.uniform3f(l, x, y, z),
  vec4: (gl, l, [x, y, z, w]) => gl.uniform4f(l, x, y, z, w),

  int: (gl, l, [x]) => gl.uniform1i(l, x),
  uint: (gl, l, [x]) => gl.uniform1ui(l, x),

  bool: (gl, l, [x]) => gl.uniform1i(l, bit(x)),
  bvec2: (gl, l, [x, y]) => gl.uniform2i(l, bit(x), bit(y)),
  bvec3: (gl, l, [x, y, z]) => gl.uniform3i(l, bit(x), bit(y), bit(z)),
  bvec4: (gl, l, [x, y, z, w]) => gl.uniform4i(l, bit(x), bit(y), bit(z), bit(w)),

  mat2: (gl, l, [m]) => gl.uniformMatrix2fv(l, NO_TRANSPOSE, m),
  mat2x3: (gl, l, [m]) => gl.uniformMatrix2x3fv(l, NO_TRANSPOSE, m),
  mat2x4: (gl, l, [m]) => gl.uniformMatrix2x4fv(l, NO_TRANSPOSE, m),
  mat3x2: (gl, l, [m]) => gl.uniformMatrix3x2fv(l, NO_TRANSPOSE, m),
  mat3: (gl, l, [m]) => gl.uniformMatrix3fv(l, NO_TRANSPOSE, m),
  mat3x4: (gl, l, [m]) => gl.uniformMatrix3x4fv(l, NO_TRANSPOSE, m),
  mat4x2: (gl, l, [m]) => gl.uniformMatrix4x2fv(l, NO_TRANSPOSE, m),
  mat4x3: (gl, l, [m]) => gl.uniformMatrix4x3fv(l, NO_TRANSPOSE, m),
  mat4: (gl, l, [m]) => gl.uniformMatrix4fv(l, NO_TRANSPOSE, m),

  sampler2D: (gl, l, [unit]) => gl.uniform1i(l, unit),
  samplerCube: (gl, l, [unit]) => gl.uniform1i(l, unit),
};

/**
 * Writes a uniform, taking the node itself rather than a name.
 *
 * The type comes from the node twice over, through two separate channels, and
 * the split is deliberate. `A` is recovered from `UniformNode<A>` through the
 * brand on `BaseNode`, which is what makes the argument list resolve. `_t`
 * holds the same type as a plain string — it is declared `string`, not `A`, so
 * it cannot drive the types — and is read only to pick the call.
 */
export type SetUniform = <A extends SettableType>(
  node: UniformNode<A>,
  ...args: UniformArgs[A]
) => void;

export function createUniformSetter(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
): SetUniform {
  // A render loop calls set() every frame, so an unreachable uniform would
  // otherwise report itself thousands of times a second.
  const reported = new Set<string>();

  return (node, ...args) => {
    const location = locations.get(node.name);
    if (!location) {
      if (!reported.has(node.name)) {
        reported.add(node.name);
        console.warn(
          `[RMSL] The uniform ${node.name} (${node._t}) is not part of this `
          + `program, so setting it does nothing. Usually this means GLSL `
          + `removed it, which it does to any uniform whose value cannot `
          + `reach the shader's output.`,
        );
      }
      return;
    }
    WRITERS[node._t as SettableType](gl, location, args);
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/webgl/uniforms.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the inference tests**

Append to `src/webgl/uniforms.test-d.ts`:

```ts
import { uniform } from "../rmsl";
import { createUniformSetter } from "./uniforms";

declare const set: ReturnType<typeof createUniformSetter>;

describe("inference from the node", () => {
  // Nothing here annotates a type. If the brand ever stops carrying the type
  // parameter these all collapse to `any` and the checking silently stops.
  it("takes the component count the shader type has", () => {
    set(uniform("float"), 1);
    set(uniform("vec2"), 1, 2);
    set(uniform("vec3"), 1, 2, 3);
    set(uniform("vec4"), 1, 2, 3, 4);
  });

  it("rejects the wrong number of components", () => {
    // @ts-expect-error a vec3 takes three components, not one
    set(uniform("vec3"), 1);
    // @ts-expect-error a float takes one component, not two
    set(uniform("float"), 1, 2);
  });

  it("rejects the wrong component type", () => {
    // @ts-expect-error a vec2 is written with numbers
    set(uniform("vec2"), "1", "2");
  });

  // The check that view.gl's phantom length parameter cannot make.
  it("rejects a matrix of the wrong length", () => {
    // @ts-expect-error a mat4 holds sixteen elements, not nine
    set(uniform("mat4"), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("rejects a node that is not a uniform", () => {
    // @ts-expect-error a varying is not something the host writes
    set(varying("float"), 1);
  });
});
```

Add `varying` to the existing `../rmsl` import at the top of the file.

- [ ] **Step 6: Run both suites**

Run: `pnpm test:types && pnpm vitest run src/webgl/uniforms.test.ts`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/webgl/uniforms.ts src/webgl/uniforms.test.ts src/webgl/uniforms.test-d.ts
git commit -m "feat: write a uniform by handing over the node that declared it"
```

---

### Task 3: Reflection and program creation

**Files:**
- Create: `src/webgl/program.ts`
- Test: `src/webgl/program.test.ts`

**Interfaces:**
- Consumes: `createUniformSetter`, `SetUniform` from Task 2; `compileGLSL`, `Node`, `ShaderType` from `../rmsl`.
- Produces:
  - `reflectUniforms(gl, program): Map<string, WebGLUniformLocation>`
  - `createWebGLProgram(gl, vertexRoot, fragmentRoot): { program: WebGLProgram; set: SetUniform }`

- [ ] **Step 1: Write the failing test**

Create `src/webgl/program.test.ts`:

```ts
/**
 * Checks how a program is built and how its uniforms are found.
 *
 * Locations come from asking the linked program rather than from the compiler,
 * because the two do not always agree: GLSL removes a uniform whose value
 * cannot reach the output, and only the linked program knows which survived.
 */

import { describe, it, expect } from "vitest";
import { reflectUniforms } from "./program";

/** A stub program exposing a fixed set of active uniforms. */
function programWith(actives: Array<{ name: string }>) {
  const locations = new Map<string, WebGLUniformLocation>();
  const gl = {
    ACTIVE_UNIFORMS: 0x8b86,
    getProgramParameter: () => actives.length,
    getActiveUniform: (_: unknown, index: number) => actives[index] ?? null,
    getUniformLocation: (_: unknown, name: string) => {
      if (!actives.some(a => a.name === name)) return null;
      let location = locations.get(name);
      if (!location) {
        location = { name } as unknown as WebGLUniformLocation;
        locations.set(name, location);
      }
      return location;
    },
  } as unknown as WebGL2RenderingContext;
  return { gl, program: {} as WebGLProgram };
}

describe("reflectUniforms", () => {
  it("finds each active uniform", () => {
    const { gl, program } = programWith([{ name: "_rmsl_u0" }, { name: "_rmsl_u1" }]);
    const found = reflectUniforms(gl, program);
    expect([...found.keys()]).toEqual(["_rmsl_u0", "_rmsl_u1"]);
  });

  // WebGL reports an array under the name of its first element, so a lookup
  // that keeps the suffix would miss every array uniform.
  it("keys an array uniform by its own name", () => {
    const { gl, program } = programWith([{ name: "_rmsl_u2[0]" }]);
    const found = reflectUniforms(gl, program);
    expect([...found.keys()]).toEqual(["_rmsl_u2"]);
  });

  // The location has to be asked for under the name WebGL reported, even
  // though it is stored under the trimmed one.
  it("looks an array uniform up under its reported name", () => {
    const { gl, program } = programWith([{ name: "_rmsl_u2[0]" }]);
    const found = reflectUniforms(gl, program);
    expect(found.get("_rmsl_u2")).toEqual({ name: "_rmsl_u2[0]" });
  });

  it("is empty for a program with no uniforms", () => {
    const { gl, program } = programWith([]);
    expect(reflectUniforms(gl, program).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/webgl/program.test.ts`
Expected: FAIL — `Cannot find module './program'`.

- [ ] **Step 3: Write the implementation**

Create `src/webgl/program.ts`:

```ts
/**
 * Builds a WebGL program from RMSL nodes and finds its uniforms.
 *
 * Uniform locations are read back from the linked program rather than taken
 * from the compiler. GLSL removes any uniform whose value cannot reach the
 * output, so the compiler's list is what was written and the program's list is
 * what survived — and only the second one can be set.
 */

import { compileGLSL, type Node, type ShaderType } from "../rmsl";
import { createUniformSetter, type SetUniform } from "./uniforms";

type Root = Node<ShaderType> | Node<ShaderType>[];

function compileShader(
  gl: WebGL2RenderingContext,
  stage: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(stage);
  if (!shader) throw new Error("[RMSL] Could not create a shader object.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const name = stage === gl.VERTEX_SHADER ? "vertex" : "fragment";
    throw new Error(`[RMSL] The ${name} shader did not compile: ${log}\n\n${source}`);
  }
  return shader;
}

/** Every uniform the linked program actually has, keyed by name. */
export function reflectUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
): Map<string, WebGLUniformLocation> {
  const locations = new Map<string, WebGLUniformLocation>();
  const count: number = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let index = 0; index < count; index++) {
    const active = gl.getActiveUniform(program, index);
    if (!active) continue;
    // An array is reported as its first element, but is set as a whole.
    const name = active.name.endsWith("[0]") ? active.name.slice(0, -3) : active.name;
    const location = gl.getUniformLocation(program, active.name);
    if (location) locations.set(name, location);
  }
  return locations;
}

/**
 * Compiles, links and reflects a program, returning it alongside its setter.
 *
 * The caller binds the program before setting anything. Binding on every call
 * would make a redundant state change per uniform per frame, and every other
 * WebGL API expects the caller to have bound it too.
 */
export function createWebGLProgram(
  gl: WebGL2RenderingContext,
  vertexRoot: Root,
  fragmentRoot: Root,
): { program: WebGLProgram; set: SetUniform } {
  const program = gl.createProgram();
  if (!program) throw new Error("[RMSL] Could not create a program object.");

  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  try {
    vertex = compileShader(gl, gl.VERTEX_SHADER, compileGLSL.vertex(vertexRoot));
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, compileGLSL.fragment(fragmentRoot));
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      throw new Error(`[RMSL] The program did not link: ${log}`);
    }
  } catch (error) {
    // Reached when either shader fails, so the program and whichever shader
    // did compile would otherwise be left behind on the context.
    gl.deleteProgram(program);
    throw error;
  } finally {
    // Attached shaders stay alive through the program, so they are always
    // deleted here whether or not the link succeeded.
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  }

  return { program, set: createUniformSetter(gl, reflectUniforms(gl, program)) };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/webgl/program.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/webgl/program.ts src/webgl/program.test.ts
git commit -m "feat: build a program and ask it which uniforms it kept"
```

---

### Task 4: The entry point

**Files:**
- Create: `src/webgl/index.ts`
- Modify: `vite.config.ts`, `package.json`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: the `rmsl/webgl` subpath export.

- [ ] **Step 1: Write the entry point**

Create `src/webgl/index.ts`:

```ts
/**
 * WebGL2 bindings for RMSL.
 *
 * A uniform node is the handle: `set(node, value)` needs no name and no
 * schema, because the node already carries both its identity and its type.
 *
 * WebGL2 only — RMSL compiles to GLSL ES 3.0, which WebGL1 cannot load.
 */

export { createWebGLProgram, reflectUniforms } from "./program";
export type { SetUniform, UniformArgs, SettableType, Mat, Tuple } from "./uniforms";
```

- [ ] **Step 2: Add the build entry**

In `vite.config.ts`, replace the `lib` and `dts` blocks so both entries build:

```ts
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: {
      entry: { rmsl: 'src/rmsl.ts', webgl: 'src/webgl/index.ts' },
      formats: ['es'],
    },
    rollupOptions: {
      // The webgl entry imports the compiler; keeping it external means one
      // copy at runtime rather than one bundled into each entry.
      external: [/^\.\.\/rmsl$/],
    },
  },
  plugins: [
    dts({
      include: ['src/rmsl.ts', 'src/webgl/**/*.ts'],
      outDir: 'dist',
      rollupTypes: false,
    }),
  ],
})
```

- [ ] **Step 3: Add the subpath export**

In `package.json`, replace the `exports` block:

```json
  "exports": {
    ".": {
      "types": "./dist/rmsl.d.ts",
      "import": "./dist/rmsl.js"
    },
    "./webgl": {
      "types": "./dist/webgl/index.d.ts",
      "import": "./dist/webgl.js"
    }
  },
```

- [ ] **Step 4: Build and verify both entries emit**

Run: `pnpm build && ls dist/`
Expected: both `rmsl.js` and `webgl.js` present, plus `.d.ts` files.

If `dts` emits the declaration at a different path than `dist/webgl/index.d.ts`, correct the `types` field in `package.json` to match what was actually emitted rather than moving the file.

- [ ] **Step 5: Verify the built entry imports and its types resolve**

Run:

```bash
node --input-type=module -e "
import { createWebGLProgram } from './dist/webgl.js';
console.log('import OK:', typeof createWebGLProgram);
"
pnpm type-check
```

Expected: `import OK: function`, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/webgl/index.ts vite.config.ts package.json
git commit -m "build: publish the WebGL bindings as their own entry point"
```

---

### Task 5: End-to-end against a real context

**Files:**
- Create: `src/webgl/webgl.gpu.test.ts`

**Interfaces:**
- Consumes: `createUniformSetter` from Task 2.
- Produces: nothing; this is the test that the seam holds.

**Why this task exists:** Tasks 2 and 3 test against stubs, which cannot catch a wrong location, a uniform GLSL removed, or a call whose arguments GL rejects. This renders with a real uniform and reads the pixel back.

**Constraint:** the GL context lives in a browser page and does not cross `page.evaluate`. `src/webgl/uniforms.ts` has no runtime imports, so it is transpiled on its own and injected as source. This is why the no-runtime-imports rule in Global Constraints exists.

- [ ] **Step 1: Write the failing test**

Create `src/webgl/webgl.gpu.test.ts`:

```ts
/**
 * Runs the setter against a real WebGL2 context.
 *
 * uniforms.test.ts records which call a type produces, which a wrong location
 * or a rejected argument would both survive — the recorder accepts anything.
 * So one program is built here, a uniform is set, and the pixel it produces is
 * read back. If the value arrives, the location was right and GL accepted it.
 *
 * The context only exists inside the page, and a WebGL2RenderingContext cannot
 * be passed out of page.evaluate. The setter is transpiled on its own and
 * injected as source instead, which works because it has no runtime imports.
 */

import { describe, it, expect, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { transformWithEsbuild } from "vite";

declare const process: { env: Record<string, string | undefined> };

const SKIPPED = !!process.env.RMSL_SKIP_GPU || !!process.env.RMSL_SKIP_SHADER_EVALUATION;

let browser: any;

afterAll(async () => {
  await browser?.close();
});

/** The setter module as plain JS, ready to inject into a page. */
async function setterSource(): Promise<string> {
  const path = new URL("./uniforms.ts", import.meta.url).pathname;
  const source = await readFile(path, "utf8");
  // CommonJS rather than ESM: the page has no module loader, and this form
  // hands its exports to a plain function call. The type-only import of
  // ShaderType is erased by the transform, which is what lets this file be
  // taken on its own at all.
  const { code } = await transformWithEsbuild(source, path, { format: "cjs" });
  return code;
}

describe.skipIf(SKIPPED)("a uniform set against a real context", () => {
  it("arrives at the shader", async () => {
    const { chromium } = await import("playwright");
    browser ??= await chromium.launch({
      args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage();
    try {
      await page.goto("about:blank");
      const read = await page.evaluate(
        ({ setter, name }: { setter: string; name: string }) => {
          const gl = document.createElement("canvas").getContext("webgl2")!;
          if (!gl.getExtension("EXT_color_buffer_float")) {
            throw new Error("EXT_color_buffer_float unavailable; cannot read a float back");
          }

          // Written inline rather than imported: the bundler renames functions
          // and adds a shim that does not exist in the page.
          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
          const framebuffer = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          gl.framebufferTexture2D(
            gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0,
          );

          const program = gl.createProgram()!;
          for (const [src, stage] of [
            [`#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`,
              gl.VERTEX_SHADER],
            [`#version 300 es\nprecision highp float;\nuniform vec3 ${name};\n`
              + `layout(location=0) out vec4 result;\n`
              + `void main(){ result = vec4(${name}, 1.0); }`,
              gl.FRAGMENT_SHADER],
          ] as [string, number][]) {
            const shader = gl.createShader(stage)!;
            gl.shaderSource(shader, src);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
              throw new Error(gl.getShaderInfoLog(shader) ?? "shader failed to compile");
            }
            gl.attachShader(program, shader);
          }
          gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) ?? "program failed to link");
          }
          gl.useProgram(program);

          const buffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.bufferData(
            gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW,
          );
          const attribute = gl.getAttribLocation(program, "p");
          gl.enableVertexAttribArray(attribute);
          gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);

          // The module under test, evaluated in the page. esbuild's CommonJS
          // output assigns to module.exports rather than mutating the exports
          // object, so the result is read back off module.
          const mod: any = { exports: {} };
          new Function("exports", "module", setter)(mod.exports, mod);

          const locations = new Map<string, WebGLUniformLocation>();
          const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
          for (let index = 0; index < count; index++) {
            const active = gl.getActiveUniform(program, index)!;
            locations.set(active.name, gl.getUniformLocation(program, active.name)!);
          }

          const set = mod.exports.createUniformSetter(gl, locations);
          set({ name, _t: "vec3" }, 0.25, 0.5, 0.75);

          gl.viewport(0, 0, 1, 1);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          const out = new Float32Array(4);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
          return [out[0], out[1], out[2]];
        },
        { setter: await setterSource(), name: "u_probe" },
      );

      expect(read[0]).toBeCloseTo(0.25, 5);
      expect(read[1]).toBeCloseTo(0.5, 5);
      expect(read[2]).toBeCloseTo(0.75, 5);
    } finally {
      await page.close();
    }
  }, 60_000);
});
```

- [ ] **Step 2: Run it to verify it fails for the right reason**

Run: `pnpm vitest run src/webgl/webgl.gpu.test.ts`

If it fails on injection or transpilation, fix that before continuing — a green result here must mean the value reached the shader. Confirm the test is genuinely checking by changing `set(...)` to `0.9, 0.9, 0.9` and seeing it fail, then change it back.

- [ ] **Step 3: Verify it passes, and that it skips when asked**

Run: `pnpm vitest run src/webgl/webgl.gpu.test.ts`
Expected: PASS, 1 test.

Run: `RMSL_SKIP_GPU=1 pnpm vitest run src/webgl/webgl.gpu.test.ts`
Expected: 1 skipped, 0 failed.

- [ ] **Step 4: Commit**

```bash
git add src/webgl/webgl.gpu.test.ts
git commit -m "test: prove a uniform reaches the shader, not just the right call"
```

---

### Task 6: Convert the demo

**Files:**
- Modify: `apps/infinite-grid/src/main.ts:68-94`, `:172-176`

**Interfaces:**
- Consumes: `createWebGLProgram` from Task 4.
- Produces: nothing; this is the check that the API is usable.

**Note on resolution:** the demo depends on `@random-mesh/rmsl` as
`workspace:*` and has no Vite alias, so it resolves through the package's
`exports` map into `dist/`. The build from Task 4 must be run before the demo
picks any of this up.

**Note on scope:** slice 1 covers uniforms only. The demo's VAO, its
`quadPos` attribute, and its `vertexAttribPointer` call stay exactly as they
are — they are slice 2's problem.

- [ ] **Step 1: Read what the demo does now**

Run: `sed -n '1,15p;60,95p;165,180p' apps/infinite-grid/src/main.ts`

Note three things: `vsGLSL` and `fsGLSL` are built at lines 11–12 from
`vertexMain()` and `calcColourAndDepth()`; a local `compileShader` helper does
the linking; and the `uniforms` object reaches into `.name` five times, paired
with five `gl.uniform*` calls in the render loop.

- [ ] **Step 2: Replace program creation**

Delete the local `compileShader` function, the `vs`/`fs`/`program` block, and
the whole `uniforms` object. Replace with:

```ts
let { program, set } = createWebGLProgram(gl, vertexMain(), calcColourAndDepth());
gl.useProgram(program);
```

`vsGLSL` and `fsGLSL` at lines 11–12 become unused — delete them and drop
`compileGLSL` from the import on line 1 if nothing else uses it.

Add to the imports at the top:

```ts
import { createWebGLProgram } from "@random-mesh/rmsl/webgl";
```

Keep the VAO and attribute block that follows: it still uses `program`, which
`createWebGLProgram` returns.

- [ ] **Step 3: Replace the render loop writes**

Replace the five `gl.uniform*` calls with:

```ts
set(cameraProjectionMatrix, proj);
set(cameraViewMatrix, view);
set(cameraProjectionMatrixInverse, projInv);
set(cameraWorldMatrix, world);
set(cameraPosition, camPos[0], camPos[1], camPos[2]);
```

No name is mentioned and no type is restated. That is the whole point of the
slice — compare against what was there before.

- [ ] **Step 4: Build, then verify the demo still renders**

Run:

```bash
pnpm build
pnpm --filter infinite-grid dev
```

Open the printed URL and confirm the grid draws and still responds to camera
movement.

A blank canvas means a uniform is not arriving — check the console for the
`is not part of this program` warning, which names the uniform that missed.

- [ ] **Step 5: Run everything**

Run: `pnpm test && pnpm test:types && pnpm type-check`
Expected: all pass. Baseline to beat is 172 passed / 18 skipped before this
slice, plus the tests added in Tasks 1–5.

- [ ] **Step 6: Commit**

```bash
git add apps/infinite-grid/src/main.ts
git commit -m "demo: set the grid's uniforms through the nodes that declared them"
```

---

## Follow-up, deliberately not in this slice

- **Array uniforms.** Needs `uniformArray` from `apps/breakout`. Adds a second `set` overload; `reflectUniforms` already strips the `[0]` suffix and is tested for it.
- **Attributes and buffers** (slice 2), **interleaving** (slice 3), **textures and framebuffers** (slice 4).
- **Disposal.** The spec proposes an `AbortSignal`. Nothing in slice 1 allocates anything needing a matching free beyond the program itself.
