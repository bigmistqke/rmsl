/**
 * Builds a WebGL program from RMSL nodes.
 *
 * Only the compilation step lives here. Everything after it — linking,
 * cleaning up a failure, reading back the uniforms the driver kept — is in
 * link.ts, which mentions no rmsl value at all, so a build that compiled its
 * shaders ahead of time can reach that half without bundling this one.
 */

import { compileGLSL, type Node, type ShaderType, type VertexRoot } from "../rmsl";
import { linkWebGLProgram } from "./link";
import { type Setter } from "./uniforms";

// The two stages do not accept the same thing. A vertex result has to be able
// to become a position, so the compiler narrows it to vec4; a fragment result
// is whatever the outputs were declared as.
type FragmentRoot = Node<ShaderType> | Node<ShaderType>[];

/**
 * The node graph for both stages.
 *
 * Named rather than positional because the two are not reliably distinguished
 * by type: a fragment stage usually ends in a `vec4` colour, which also
 * satisfies a vertex root, so passing them the wrong way round would type-check
 * and then compile into two shaders that draw the wrong thing. A field name
 * cannot be swapped by accident.
 *
 * `vertex` is optional for the same reason `VertexRoot` includes `void` — a
 * stage that assigns `builtinPosition()` itself has no value to return.
 */
export interface ShaderRoots {
  vertex?: VertexRoot;
  fragment: FragmentRoot;
}

/**
 * Compiles both stages, links them, and reads back which uniforms survived.
 *
 * Importing this pulls in the GLSL compiler, which is the point of it — a host
 * that has no graph to compile wants `linkWebGLProgram` instead, and will not
 * ship the compiler for using it.
 *
 * The caller binds the program before setting anything. Binding on every call
 * would make a redundant state change per uniform per frame, and every other
 * WebGL API expects the caller to have bound it too.
 */
export function createWebGLProgram(
  gl: WebGL2RenderingContext,
  roots: ShaderRoots,
): { program: WebGLProgram; set: Setter } {
  return linkWebGLProgram(gl, {
    vertex: compileGLSL.vertex(roots.vertex),
    fragment: compileGLSL.fragment(roots.fragment),
  });
}
