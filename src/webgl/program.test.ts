/**
 * Checks how a program is built and how its uniforms are found.
 *
 * Locations come from asking the linked program rather than from the compiler,
 * because the two do not always agree: GLSL removes a uniform whose value
 * cannot reach the output, and only the linked program knows which survived.
 */

import { describe, it, expect } from "vitest";
import { createWebGLProgram } from "./program";
import { reflectUniforms, linkWebGLProgram } from "./link";
import { Fn, attribute, vec4 } from "../rmsl";

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

describe("createWebGLProgram", () => {
  /** Every GL object a stub call creates or deletes, by reference. */
  type Log = {
    programs: WebGLProgram[];
    shaders: WebGLShader[];
    deletedPrograms: WebGLProgram[];
    deletedShaders: WebGLShader[];
    /** Every source string handed to the driver, in the order it was given. */
    sources: string[];
  };

  /**
   * A stub GL context whose compile/link outcome is fixed by the caller, and
   * that records every object it creates and every delete call it receives.
   */
  function glStub(options: {
    vertexCompiles: boolean;
    fragmentCompiles: boolean;
    linkSucceeds: boolean;
  }): { gl: WebGL2RenderingContext; log: Log } {
    const log: Log = {
      programs: [], shaders: [], deletedPrograms: [], deletedShaders: [], sources: [],
    };
    const stageOf = new Map<WebGLShader, number>();

    const gl = {
      VERTEX_SHADER: 0x8b31,
      FRAGMENT_SHADER: 0x8b30,
      COMPILE_STATUS: 0x8b81,
      LINK_STATUS: 0x8b82,
      ACTIVE_UNIFORMS: 0x8b86,
      createProgram: () => {
        const program = {} as WebGLProgram;
        log.programs.push(program);
        return program;
      },
      createShader: (stage: number) => {
        const shader = {} as WebGLShader;
        stageOf.set(shader, stage);
        log.shaders.push(shader);
        return shader;
      },
      shaderSource: (_: WebGLShader, source: string) => {
        log.sources.push(source);
      },
      compileShader: () => {},
      getShaderParameter: (shader: WebGLShader) =>
        stageOf.get(shader) === gl.VERTEX_SHADER ? options.vertexCompiles : options.fragmentCompiles,
      getShaderInfoLog: (shader: WebGLShader) =>
        stageOf.get(shader) === gl.VERTEX_SHADER ? "vertex compile failed" : "fragment compile failed",
      deleteShader: (shader: WebGLShader) => {
        log.deletedShaders.push(shader);
      },
      attachShader: () => {},
      linkProgram: () => {},
      // Reflection asks this the same way linking does, so the two are told
      // apart by which parameter was requested.
      getProgramParameter: (_: unknown, parameter: number) =>
        parameter === 0x8b86 ? 0 : options.linkSucceeds,
      getActiveUniform: () => null,
      getUniformLocation: () => null,
      getProgramInfoLog: () => "link failed",
      deleteProgram: (program: WebGLProgram) => {
        log.deletedPrograms.push(program);
      },
    } as unknown as WebGL2RenderingContext;

    return { gl, log };
  }

  /** A minimal valid vertex graph: an attribute forwarded to gl_Position. */
  function vertexGraph() {
    const pos = attribute("vec2");
    return Fn(() => vec4(pos.x, pos.y, 0.0, 1.0))();
  }

  /** A minimal valid fragment graph: a fixed vec4 colour. */
  function fragmentGraph() {
    return Fn(() => vec4(1.0, 0.0, 0.0, 1.0))();
  }

  /** Every object the stub created must show up among what it deleted. */
  function expectNothingLeaked(log: Log) {
    expect(log.deletedPrograms).toHaveLength(log.programs.length);
    for (const program of log.programs) expect(log.deletedPrograms).toContain(program);
    expect(log.deletedShaders).toHaveLength(log.shaders.length);
    for (const shader of log.shaders) expect(log.deletedShaders).toContain(shader);
  }

  it("deletes the program and shader when the vertex shader fails to compile", () => {
    const { gl, log } = glStub({ vertexCompiles: false, fragmentCompiles: true, linkSucceeds: true });
    expect(() => createWebGLProgram(gl, { vertex: vertexGraph(), fragment: fragmentGraph() })).toThrow(/vertex shader did not compile/);
    expect(log.shaders).toHaveLength(1);
    expectNothingLeaked(log);
  });

  // This is the path the library RMSL replaces leaks on: the program and the
  // already-compiled vertex shader both have to be cleaned up here too.
  it("deletes the program and both shaders when the fragment shader fails to compile", () => {
    const { gl, log } = glStub({ vertexCompiles: true, fragmentCompiles: false, linkSucceeds: true });
    expect(() => createWebGLProgram(gl, { vertex: vertexGraph(), fragment: fragmentGraph() })).toThrow(/fragment shader did not compile/);
    expect(log.shaders).toHaveLength(2);
    expectNothingLeaked(log);
  });

  it("deletes the program and both shaders when the program fails to link", () => {
    const { gl, log } = glStub({ vertexCompiles: true, fragmentCompiles: true, linkSucceeds: false });
    expect(() => createWebGLProgram(gl, { vertex: vertexGraph(), fragment: fragmentGraph() })).toThrow(/did not link/);
    expect(log.shaders).toHaveLength(2);
    expectNothingLeaked(log);
  });

  // A build that precompiles its shaders has the sources already and no
  // compiler to run, but still wants the linking, the cleanup and the
  // reflection that surround it. That half is linkWebGLProgram, which
  // createWebGLProgram itself calls once it has compiled.
  describe("linkWebGLProgram, given ready-made sources", () => {
    const sources = {
      vertex: "#version 300 es\nvoid main() { gl_Position = vec4(0.0); }",
      fragment: "#version 300 es\nout vec4 c; void main() { c = vec4(1.0); }",
    };

    it("hands the driver exactly the sources it was given", () => {
      const { gl, log } = glStub({ vertexCompiles: true, fragmentCompiles: true, linkSucceeds: true });
      linkWebGLProgram(gl, sources);
      expect(log.sources).toEqual([sources.vertex, sources.fragment]);
    });

    it("returns the linked program", () => {
      const { gl, log } = glStub({ vertexCompiles: true, fragmentCompiles: true, linkSucceeds: true });
      const { program } = linkWebGLProgram(gl, sources);
      expect(program).toBe(log.programs[0]);
      expect(log.deletedPrograms).toEqual([]);
    });

    it("cleans up after a link failure just as the node form does", () => {
      const { gl, log } = glStub({ vertexCompiles: true, fragmentCompiles: true, linkSucceeds: false });
      expect(() => linkWebGLProgram(gl, sources)).toThrow(/did not link/);
      expect(log.shaders).toHaveLength(2);
      expectNothingLeaked(log);
    });
  });
});
