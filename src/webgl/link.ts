/**
 * Links GLSL into a program and finds the uniforms it kept.
 *
 * Split from program.ts so that this half can be used without the compiler.
 * Nothing here imports a value from rmsl — only `./uniforms`, which is itself
 * types-only against rmsl — so a build that compiled its shaders ahead of time
 * bundles the linking and the setter without the DSL behind them. Merging the
 * two files again would undo that: one module that mentions `compileGLSL`
 * anywhere keeps the whole compiler alive for everyone who imports it.
 *
 * Uniform locations are read back from the linked program rather than taken
 * from the compiler. GLSL removes any uniform whose value cannot reach the
 * output, so the compiler's list is what was written and the program's list is
 * what survived — and only the second one can be set.
 */

import { createUniformSetter, type Setter } from "./uniforms";

/**
 * GLSL for both stages, already compiled.
 *
 * What a build that precompiles its shaders has instead of a node graph: the
 * compiler ran at build time, so the browser is handed the finished sources.
 */
export interface ShaderSources {
  vertex: string;
  fragment: string;
}

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
 * Links GLSL that is already compiled, and returns it alongside its setter.
 *
 * The form for a build that precompiles its shaders: it has the sources and no
 * graph, but still wants the linking, the cleanup after a failure, and the
 * read-back of which uniforms survived. `createWebGLProgram` compiles a node
 * graph and then calls this.
 *
 * The caller binds the program before setting anything. Binding on every call
 * would make a redundant state change per uniform per frame, and every other
 * WebGL API expects the caller to have bound it too.
 */
export function linkWebGLProgram(
  gl: WebGL2RenderingContext,
  sources: ShaderSources,
): { program: WebGLProgram; set: Setter } {
  const program = gl.createProgram();
  if (!program) throw new Error("[RMSL] Could not create a program object.");

  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  try {
    vertex = compileShader(gl, gl.VERTEX_SHADER, sources.vertex);
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, sources.fragment);
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
