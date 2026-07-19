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
