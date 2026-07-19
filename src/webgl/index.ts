/**
 * WebGL2 bindings for RMSL.
 *
 * A uniform node is the handle: `set(node, value)` needs no name and no
 * schema, because the node already carries both its identity and its type.
 *
 * WebGL2 only — RMSL compiles to GLSL ES 3.0, which WebGL1 cannot load.
 */

export { createWebGLProgram, reflectUniforms } from "./program";
export type { Setter, UniformArgs, SettableType, Mat, Tuple } from "./uniforms";
