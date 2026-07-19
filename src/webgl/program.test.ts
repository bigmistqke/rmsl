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
