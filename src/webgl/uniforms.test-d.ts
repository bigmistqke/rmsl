/**
 * Type-level tests for the uniform argument tables.
 *
 * The whole point of keying by node is that the argument list is derived from
 * the shader type rather than restated. That derivation is invisible to a
 * runtime assertion — a table that resolved every type to `number[]` would
 * pass every dispatch test in uniforms.test.ts — so it is pinned here.
 */

import { describe, it, expectTypeOf } from "vitest";
import type { UniformArgs, Mat, Tuple } from "./uniforms";

describe("argument tuples", () => {
  it("gives each scalar and vector its component count", () => {
    expectTypeOf<UniformArgs["float"]>().toEqualTypeOf<[number]>();
    expectTypeOf<UniformArgs["vec2"]>().toEqualTypeOf<[number, number]>();
    expectTypeOf<UniformArgs["vec3"]>().toEqualTypeOf<[number, number, number]>();
    expectTypeOf<UniformArgs["vec4"]>().toEqualTypeOf<[number, number, number, number]>();
  });

  // GLSL sets booleans through uniform1i, but making the caller pass 0 and 1
  // leaks that detail. Numbers stay allowed so an existing 0/1 still works.
  it("accepts booleans for bool and bvec", () => {
    expectTypeOf<UniformArgs["bool"]>().toEqualTypeOf<[boolean | number]>();
    expectTypeOf<UniformArgs["bvec2"]>().toEqualTypeOf<
      [boolean | number, boolean | number]
    >();
  });

  // A sampler is set to a texture unit index, not to a texture.
  it("takes a unit index for samplers", () => {
    expectTypeOf<UniformArgs["sampler2D"]>().toEqualTypeOf<[number]>();
    expectTypeOf<UniformArgs["samplerCube"]>().toEqualTypeOf<[number]>();
  });
});

describe("matrix lengths", () => {
  // view.gl's equivalent takes a Size parameter and then ignores it, so mat2
  // and mat4 accept identical arguments and a wrong-length literal is written
  // to the GPU unchecked. Tuple<N> is what makes the length mean something.
  it("counts elements as columns times rows", () => {
    expectTypeOf<Tuple<4, number>>().toEqualTypeOf<[number, number, number, number]>();
    expectTypeOf<UniformArgs["mat2"]>().toEqualTypeOf<[Mat<4>]>();
    expectTypeOf<UniformArgs["mat3"]>().toEqualTypeOf<[Mat<9>]>();
    expectTypeOf<UniformArgs["mat4"]>().toEqualTypeOf<[Mat<16>]>();
    expectTypeOf<UniformArgs["mat2x3"]>().toEqualTypeOf<[Mat<6>]>();
    expectTypeOf<UniformArgs["mat3x2"]>().toEqualTypeOf<[Mat<6>]>();
    expectTypeOf<UniformArgs["mat2x4"]>().toEqualTypeOf<[Mat<8>]>();
    expectTypeOf<UniformArgs["mat4x2"]>().toEqualTypeOf<[Mat<8>]>();
    expectTypeOf<UniformArgs["mat3x4"]>().toEqualTypeOf<[Mat<12>]>();
    expectTypeOf<UniformArgs["mat4x3"]>().toEqualTypeOf<[Mat<12>]>();
  });

  it("takes a Float32Array or an exactly sized array", () => {
    expectTypeOf<Float32Array>().toMatchTypeOf<Mat<16>>();
    expectTypeOf<[1, 2, 3, 4]>().toMatchTypeOf<Mat<4>>();
  });
});

describe("void", () => {
  // `void` is in ShaderType because a statement has a type, but it is not
  // something a host can write.
  it("is not settable", () => {
    expectTypeOf<"void">().not.toMatchTypeOf<keyof UniformArgs>();
  });
});
