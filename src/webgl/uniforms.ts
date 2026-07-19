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
