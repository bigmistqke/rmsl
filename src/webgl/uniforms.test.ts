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
import { uniform, uniformArray } from "../rmsl";
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

describe("uniform arrays", () => {
  it("writes a vec4 array through uniform4fv with the buffer", () => {
    const u = uniformArray("vec4", 4);
    const { set, calls, location } = setterFor(u);
    const data = new Float32Array(16);
    set(u, data);
    expect(calls).toEqual([{ fn: "uniform4fv", args: [location, data] }]);
  });

  it("writes a float array through uniform1fv", () => {
    const u = uniformArray("float", 8);
    const { set, calls, location } = setterFor(u);
    const data = new Float32Array(8);
    set(u, data);
    expect(calls).toEqual([{ fn: "uniform1fv", args: [location, data] }]);
  });

  it("writes a mat4 array through uniformMatrix4fv with transpose off", () => {
    const u = uniformArray("mat4", 2);
    const { set, calls, location } = setterFor(u);
    const data = new Float32Array(32);
    set(u, data);
    expect(calls).toEqual([{ fn: "uniformMatrix4fv", args: [location, false, data] }]);
  });

  it("writes an int array through uniform1iv", () => {
    const u = uniformArray("int", 5);
    const { set, calls, location } = setterFor(u);
    const data = new Int32Array(5);
    set(u, data);
    expect(calls).toEqual([{ fn: "uniform1iv", args: [location, data] }]);
  });

  // A bulk upload has no per-element brand to lean on, so a wrong-length
  // buffer is only ever caught here, at the boundary, rather than by the type
  // checker.
  it("throws when the data length does not match the array's size", () => {
    const u = uniformArray("vec4", 4);
    const { set } = setterFor(u);
    const data = new Float32Array(10);
    expect(() => set(u, data)).toThrow(
      "[RMSL] vec4[4] needs 16 numbers, got 10.",
    );
  });

  // Bulk uploads accept a typed array or a plain array, so a caller that built
  // its data with ordinary numbers is not forced to convert it.
  it("accepts a plain number[], not only a typed array", () => {
    const u = uniformArray("vec4", 1);
    const { set, calls, location } = setterFor(u);
    const data = [1, 2, 3, 4];
    set(u, data);
    expect(calls).toEqual([{ fn: "uniform4fv", args: [location, data] }]);
  });

  it("warns once and does not upload when the array has no location", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { gl, calls } = recorder();
    const u = uniformArray("vec4", 4);
    const set = createUniformSetter(gl, new Map());

    set(u, new Float32Array(16));
    set(u, new Float32Array(16));

    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("a node whose _t has no writer", () => {
  // _t is typed string, not the shader type, precisely so it cannot drive the
  // argument types — which also means the dispatch table cannot trust it. A
  // JS caller, or a cast past the type check, can hand over a node whose _t
  // is not a key of WRITERS, and location lookup succeeding is what would
  // otherwise let that reach `WRITERS[node._t]` and throw the opaque
  // "undefined is not a function" instead of naming the problem.
  it("throws naming the type rather than calling undefined", () => {
    const { gl } = recorder();
    const location = {} as WebGLUniformLocation;
    // Cast past the generic: passing a node whose _t is not a real shader
    // type gives the compiler nothing to infer A from, which is exactly the
    // situation this guard exists for, so the call itself has to be untyped.
    const set = createUniformSetter(gl, new Map([["bogus", location]])) as (
      node: unknown,
    ) => void;
    const node = { name: "bogus", _t: "notAShaderType" };

    expect(() => set(node)).toThrow(
      "[RMSL] notAShaderType is not a uniform type that can be set.",
    );
  });
});
