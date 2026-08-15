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

import type { ShaderType, UniformArrayNode, UniformNode } from "../rmsl";

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

  ivec2: [number, number];
  ivec3: [number, number, number];
  ivec4: [number, number, number, number];

  uvec2: [number, number];
  uvec3: [number, number, number];
  uvec4: [number, number, number, number];

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

  // A sampler is written with the index of the texture unit to read from,
  // whatever the sampled texture's own component type is.
  sampler2D: [number];
  sampler3D: [number];
  samplerCube: [number];
  isampler2D: [number];
  isampler3D: [number];
  isamplerCube: [number];
  usampler2D: [number];
  usampler3D: [number];
  usamplerCube: [number];
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

  ivec2: (gl, l, [x, y]) => gl.uniform2i(l, x, y),
  ivec3: (gl, l, [x, y, z]) => gl.uniform3i(l, x, y, z),
  ivec4: (gl, l, [x, y, z, w]) => gl.uniform4i(l, x, y, z, w),

  uvec2: (gl, l, [x, y]) => gl.uniform2ui(l, x, y),
  uvec3: (gl, l, [x, y, z]) => gl.uniform3ui(l, x, y, z),
  uvec4: (gl, l, [x, y, z, w]) => gl.uniform4ui(l, x, y, z, w),

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
  sampler3D: (gl, l, [unit]) => gl.uniform1i(l, unit),
  samplerCube: (gl, l, [unit]) => gl.uniform1i(l, unit),
  isampler2D: (gl, l, [unit]) => gl.uniform1i(l, unit),
  isampler3D: (gl, l, [unit]) => gl.uniform1i(l, unit),
  isamplerCube: (gl, l, [unit]) => gl.uniform1i(l, unit),
  usampler2D: (gl, l, [unit]) => gl.uniform1i(l, unit),
  usampler3D: (gl, l, [unit]) => gl.uniform1i(l, unit),
  usamplerCube: (gl, l, [unit]) => gl.uniform1i(l, unit),
};

/**
 * Every element type `uniformArray` can hold. Samplers are excluded because
 * `uniformArray` itself throws for them — there is no texture-array uniform
 * to reach this code, so it needs no handling here either.
 */
export type SettableArrayType = Exclude<
  SettableType,
  | "sampler2D" | "sampler3D" | "samplerCube"
  | "isampler2D" | "isampler3D" | "isamplerCube"
  | "usampler2D" | "usampler3D" | "usamplerCube"
>;

/**
 * How many numbers one element occupies, so a bulk upload's length can be
 * checked against `node.length`. Written out for the same reason `WRITERS`
 * is: deriving a matrix's element count from its name is what turns mat3
 * into 3, not 9.
 */
const ELEMENT_COMPONENTS: Record<SettableArrayType, number> = {
  float: 1, int: 1, uint: 1, bool: 1,

  vec2: 2, bvec2: 2, ivec2: 2, uvec2: 2,
  vec3: 3, bvec3: 3, ivec3: 3, uvec3: 3,
  vec4: 4, bvec4: 4, ivec4: 4, uvec4: 4,

  mat2: 4,
  mat2x3: 6, mat3x2: 6,
  mat2x4: 8, mat4x2: 8,
  mat3: 9,
  mat3x4: 12, mat4x3: 12,
  mat4: 16,
};

type FloatBuffer = Float32Array | number[];
type IntBuffer = Int32Array | number[];
type UintBuffer = Uint32Array | number[];

/**
 * What a bulk upload accepts for each element type.
 *
 * This is not `UniformArgs` widened to arrays: a bulk upload takes one flat
 * buffer of every element's components concatenated, not a tuple per
 * element, so the shape is entirely different from the scalar case.
 *
 * Booleans are numbers here, unlike `UniformArgs["bool"]`. The scalar setter
 * accepts `boolean` because converting one value is free; converting a whole
 * array would mean allocating a copy every time a bulk upload runs, which is
 * exactly the cost a bulk upload exists to avoid.
 */
export interface ArrayData {
  float: FloatBuffer;
  vec2: FloatBuffer;
  vec3: FloatBuffer;
  vec4: FloatBuffer;

  int: IntBuffer;
  bool: IntBuffer;
  bvec2: IntBuffer;
  bvec3: IntBuffer;
  bvec4: IntBuffer;
  ivec2: IntBuffer;
  ivec3: IntBuffer;
  ivec4: IntBuffer;

  uint: UintBuffer;
  uvec2: UintBuffer;
  uvec3: UintBuffer;
  uvec4: UintBuffer;

  mat2: FloatBuffer;
  mat2x3: FloatBuffer;
  mat2x4: FloatBuffer;
  mat3x2: FloatBuffer;
  mat3: FloatBuffer;
  mat3x4: FloatBuffer;
  mat4x2: FloatBuffer;
  mat4x3: FloatBuffer;
  mat4: FloatBuffer;
}

/** Writes an already-located array uniform from one flat buffer. */
type ArrayWriter = (
  gl: WebGL2RenderingContext,
  location: WebGLUniformLocation,
  data: FloatBuffer | IntBuffer | UintBuffer,
) => void;

const ARRAY_WRITERS: Record<SettableArrayType, ArrayWriter> = {
  float: (gl, l, d) => gl.uniform1fv(l, d as FloatBuffer),
  vec2: (gl, l, d) => gl.uniform2fv(l, d as FloatBuffer),
  vec3: (gl, l, d) => gl.uniform3fv(l, d as FloatBuffer),
  vec4: (gl, l, d) => gl.uniform4fv(l, d as FloatBuffer),

  int: (gl, l, d) => gl.uniform1iv(l, d as IntBuffer),
  uint: (gl, l, d) => gl.uniform1uiv(l, d as UintBuffer),

  ivec2: (gl, l, d) => gl.uniform2iv(l, d as IntBuffer),
  ivec3: (gl, l, d) => gl.uniform3iv(l, d as IntBuffer),
  ivec4: (gl, l, d) => gl.uniform4iv(l, d as IntBuffer),

  uvec2: (gl, l, d) => gl.uniform2uiv(l, d as UintBuffer),
  uvec3: (gl, l, d) => gl.uniform3uiv(l, d as UintBuffer),
  uvec4: (gl, l, d) => gl.uniform4uiv(l, d as UintBuffer),

  // Booleans go through the integer calls, as they do for scalars.
  bool: (gl, l, d) => gl.uniform1iv(l, d as IntBuffer),
  bvec2: (gl, l, d) => gl.uniform2iv(l, d as IntBuffer),
  bvec3: (gl, l, d) => gl.uniform3iv(l, d as IntBuffer),
  bvec4: (gl, l, d) => gl.uniform4iv(l, d as IntBuffer),

  // Matrices use the same calls as the scalar case: `uniformMatrix4fv`
  // already takes a buffer, so an array of them is just a longer buffer.
  mat2: (gl, l, d) => gl.uniformMatrix2fv(l, NO_TRANSPOSE, d as FloatBuffer),
  mat2x3: (gl, l, d) => gl.uniformMatrix2x3fv(l, NO_TRANSPOSE, d as FloatBuffer),
  mat2x4: (gl, l, d) => gl.uniformMatrix2x4fv(l, NO_TRANSPOSE, d as FloatBuffer),
  mat3x2: (gl, l, d) => gl.uniformMatrix3x2fv(l, NO_TRANSPOSE, d as FloatBuffer),
  mat3: (gl, l, d) => gl.uniformMatrix3fv(l, NO_TRANSPOSE, d as FloatBuffer),
  mat3x4: (gl, l, d) => gl.uniformMatrix3x4fv(l, NO_TRANSPOSE, d as FloatBuffer),
  mat4x2: (gl, l, d) => gl.uniformMatrix4x2fv(l, NO_TRANSPOSE, d as FloatBuffer),
  mat4x3: (gl, l, d) => gl.uniformMatrix4x3fv(l, NO_TRANSPOSE, d as FloatBuffer),
  mat4: (gl, l, d) => gl.uniformMatrix4fv(l, NO_TRANSPOSE, d as FloatBuffer),
};

/**
 * What a write needs to know about a uniform, as plain data.
 *
 * A build that precompiles its shaders replaces the module that built them
 * with JSON, so no node survives to run time — but the setter only ever reads
 * a uniform's name and its shader type, and both of those are strings. A
 * descriptor is those two strings, which means a precompiled build can write
 * its uniforms with the same call a run-time build uses.
 *
 * `type` here is the shader type, where a node spells that `_t` and uses
 * `type` for the kind of input it is. The names differ because the shapes are
 * for different readers: a node's fields are the compiler's, and these are
 * written into a build artefact a person reads.
 */
export interface UniformDescriptor<A extends ShaderType> {
  readonly name: string;
  readonly type: A;
}

/** A uniform array as plain data. `length` is what marks it as an array. */
export interface UniformArrayDescriptor<A extends ShaderType> {
  readonly name: string;
  readonly type: A;
  readonly length: number;
}

/**
 * Turns a node into the plain data a write needs, to be stored in a build
 * artefact. Runs at build time, where the node still exists.
 */
export function describeUniform<A extends SettableType>(
  node: UniformNode<A>,
): UniformDescriptor<A>;
export function describeUniform<A extends SettableArrayType>(
  node: UniformArrayNode<A>,
): UniformArrayDescriptor<A>;
export function describeUniform(
  node: { name: string },
): UniformDescriptor<SettableType> | UniformArrayDescriptor<SettableArrayType> {
  const { name, _t, type, length } = node as {
    name: string;
    _t: SettableType;
    type: string;
    length: number;
  };
  return type === "uniformArray" ? { name, type: _t, length } : { name, type: _t };
}

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
 *
 * The array overload mirrors that split. `UniformArrayNode` does not expose
 * `_t` or `type` on its interface — only `name`, `length` and `element()` —
 * though both are present at runtime, same as a scalar node. Reading them
 * needs a cast, exactly as it does for `_t` above.
 */
export type Setter = {
  <A extends SettableType>(
    uniform: UniformNode<A> | UniformDescriptor<A>,
    ...args: UniformArgs[A]
  ): void;
  <A extends SettableArrayType>(
    uniform: UniformArrayNode<A> | UniformArrayDescriptor<A>,
    data: ArrayData[A],
  ): void;
};

export function createUniformSetter(
  gl: WebGL2RenderingContext,
  locations: Map<string, WebGLUniformLocation>,
): Setter {
  // A render loop calls set() every frame, so an unreachable uniform would
  // otherwise report itself thousands of times a second.
  const reported = new Set<string>();

  // Untyped here and cast to `Setter` on return: one function body cannot
  // itself satisfy an overloaded call signature, only be assignable to it.
  function set(uniform: any, ...args: any[]): void {
    // Read in place rather than normalised into an object: this runs for every
    // uniform of every frame, and the two shapes differ in field names only.
    //
    // A node holds its shader type in `_t` and the kind of input it is in
    // `type`; a descriptor has no `_t` and holds the shader type in `type`.
    // Which of the two decides how an array is recognised, and a node's answer
    // cannot be `length`: every node has one, because `length()` is the GLSL
    // operation, so on a scalar it is a method rather than an element count.
    const isNode = "_t" in uniform;
    const type: string = isNode ? uniform._t : uniform.type;
    const isArray = isNode
      ? uniform.type === "uniformArray"
      : typeof uniform.length === "number";

    const name: string = uniform.name;
    const location = locations.get(name);
    if (!location) {
      if (!reported.has(name)) {
        reported.add(name);
        console.warn(
          `[RMSL] The uniform ${name} (${type}) is not part of this `
          + `program, so setting it does nothing. Usually this means GLSL `
          + `removed it, which it does to any uniform whose value cannot `
          + `reach the shader's output.`,
        );
      }
      return;
    }

    if (isArray) {
      const elementType = type as SettableArrayType;
      const length: number = uniform.length;
      const data = args[0];
      const expected = length * ELEMENT_COMPONENTS[elementType];
      if (data.length !== expected) {
        throw new Error(
          `[RMSL] ${elementType}[${length}] needs ${expected} numbers, `
          + `got ${data.length}.`,
        );
      }
      const arrayWriter = ARRAY_WRITERS[elementType];
      if (!arrayWriter) {
        throw new Error(`[RMSL] ${elementType} is not a uniform type that can be set.`);
      }
      arrayWriter(gl, location, data);
      return;
    }

    const writer = WRITERS[type as SettableType];
    if (!writer) throw new Error(`[RMSL] ${type} is not a uniform type that can be set.`);
    writer(gl, location, args);
  }

  return set as Setter;
}
