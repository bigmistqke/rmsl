/**
 * Argument tables for writing a uniform.
 *
 * A uniform node already carries its shader type, so the host should not have
 * to restate it. `UniformArgs` turns that type into the argument list, and the
 * dispatch table turns it into the GL call.
 *
 * Split from program.ts because the two answer different questions: this file
 * knows what each shader type means to GL, and that one knows how a program is
 * built and what it kept.
 */

import type { ShaderType, UniformNode } from "../rmsl";

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

/** Writes one already-located uniform. Arguments are checked by `Setter`. */
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
 * Writes a shader input, taking the node itself rather than a name.
 *
 * One function rather than one per kind. `UniformNode` narrows `type` to
 * "uniform", so slice 2 adds an attribute overload here and each kind gets the
 * arguments that suit it — components for a uniform, a buffer for an attribute
 * — without the caller choosing a different function.
 *
 * The shader type comes from the node twice over, through two separate
 * channels, and the split is deliberate. `A` is recovered from
 * `UniformNode<A>` through the brand on `BaseNode`, which is what makes the
 * argument list resolve. `_t` holds the same type as a plain string — declared
 * `string`, not `A`, so it cannot drive the types — and is read only to pick
 * the call.
 */
export type Setter = <A extends SettableType>(
  node: UniformNode<A>,
  ...args: UniformArgs[A]
) => void;

export function createUniformSetter(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
): Setter {
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
    const writer = WRITERS[node._t as SettableType];
    if (!writer) throw new Error(`[RMSL] ${node._t} is not a uniform type that can be set.`);
    writer(gl, location, args);
  };
}
