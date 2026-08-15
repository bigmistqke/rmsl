/**
 * Type-level tests for the uniform argument tables.
 *
 * The whole point of keying by node is that the argument list is derived from
 * the shader type rather than restated. That derivation is invisible to a
 * runtime assertion — a table that resolved every type to `number[]` would
 * pass every dispatch test in uniforms.test.ts — so it is pinned here.
 */

import { describe, it, expectTypeOf } from "vitest";
import type {
  UniformArgs, Mat, Tuple, UniformDescriptor, UniformArrayDescriptor,
} from "./uniforms";
import { uniform, uniformArray, attribute, varying } from "../rmsl";
import { createUniformSetter, describeUniform } from "./uniforms";

declare const set: ReturnType<typeof createUniformSetter>;

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

  // A sampler is set to a texture unit index, not to a texture — true of
  // every variant, whatever the sampled texture's own component type is.
  it("takes a unit index for samplers", () => {
    expectTypeOf<UniformArgs["sampler2D"]>().toEqualTypeOf<[number]>();
    expectTypeOf<UniformArgs["sampler3D"]>().toEqualTypeOf<[number]>();
    expectTypeOf<UniformArgs["samplerCube"]>().toEqualTypeOf<[number]>();
    expectTypeOf<UniformArgs["isampler2D"]>().toEqualTypeOf<[number]>();
    expectTypeOf<UniformArgs["usampler2D"]>().toEqualTypeOf<[number]>();
  });

  // Integer and unsigned vectors take plain numbers, not the boolean-or-number
  // union bvec accepts — they have no boolean form to leak.
  it("gives ivec and uvec their component count", () => {
    expectTypeOf<UniformArgs["ivec3"]>().toEqualTypeOf<[number, number, number]>();
    expectTypeOf<UniformArgs["uvec2"]>().toEqualTypeOf<[number, number]>();
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

describe("inference from the node", () => {
  // Nothing here annotates a type. If the brand ever stops carrying the type
  // parameter these all collapse to `any` and the checking silently stops.
  it("takes the component count the shader type has", () => {
    set(uniform("float"), 1);
    set(uniform("vec2"), 1, 2);
    set(uniform("vec3"), 1, 2, 3);
    set(uniform("vec4"), 1, 2, 3, 4);
  });

  it("rejects the wrong number of components", () => {
    // @ts-expect-error a vec3 takes three components, not one
    set(uniform("vec3"), 1);
    // @ts-expect-error a float takes one component, not two
    set(uniform("float"), 1, 2);
  });

  it("rejects the wrong component type", () => {
    // @ts-expect-error a vec2 is written with numbers
    set(uniform("vec2"), "1", "2");
  });

  // The check that view.gl's phantom length parameter cannot make.
  it("rejects a matrix of the wrong length", () => {
    // @ts-expect-error a mat4 holds sixteen elements, not nine
    set(uniform("mat4"), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  // The three variable node types used to be aliases of one another, so this
  // was accepted. They now narrow `type` to the string each constructor
  // writes, which is what lets one `set` take a uniform and later an
  // attribute and give each its own arguments.
  it("rejects a node that is not a uniform", () => {
    // @ts-expect-error an attribute is written with a buffer, not components
    set(attribute("vec3"), 1, 2, 3);
    // @ts-expect-error a varying is written by the shader, not by the host
    set(varying("float"), 1);
  });
});

describe("uniform arrays", () => {
  it("takes one flat buffer of the element type's data", () => {
    set(uniformArray("vec4", 4), new Float32Array(16));
    // The buffer's length is only checked at runtime — a fixed-length array
    // type could not describe every valid length a caller might build.
    set(uniformArray("vec4", 4), [1, 2, 3]);
  });

  it("rejects a bare buffer where a scalar uniform expects components", () => {
    // @ts-expect-error a vec4 uniform takes four numbers, not a Float32Array
    set(uniform("vec4"), new Float32Array(16));
  });

  it("rejects loose components where an array node expects one buffer", () => {
    // @ts-expect-error an array node takes one buffer argument, not components
    set(uniformArray("vec4", 4), 1, 2, 3, 4);
  });
});

/**
 * A descriptor exists so a precompiled build can write uniforms without a
 * node. It is only worth having if it keeps the checking the node gives: the
 * point of keying by node was never the object, it was that the shader type
 * came along with it and the argument list followed from it.
 */
describe("descriptors", () => {
  it("keeps the shader type, so the argument list still follows from it", () => {
    expectTypeOf(describeUniform(uniform("vec3"))).toEqualTypeOf<
      UniformDescriptor<"vec3">
    >();
    expectTypeOf(describeUniform(uniformArray("vec4", 4))).toEqualTypeOf<
      UniformArrayDescriptor<"vec4">
    >();
  });

  it("takes the same arguments the node it describes takes", () => {
    set(describeUniform(uniform("vec3")), 1, 2, 3);
    set(describeUniform(uniform("mat4")), new Float32Array(16));
    set(describeUniform(uniformArray("vec4", 4)), new Float32Array(16));
  });

  it("rejects the wrong component count, as the node does", () => {
    // @ts-expect-error a vec3 takes three components, not two
    set(describeUniform(uniform("vec3")), 1, 2);
  });

  // A descriptor read back from JSON is a plain object, so nothing but its
  // declared type distinguishes it. That type has to be enough on its own.
  it("checks a descriptor written by hand the same way", () => {
    const uColour: UniformDescriptor<"vec3"> = { name: "uColour", type: "vec3" };
    set(uColour, 1, 2, 3);
    // @ts-expect-error a vec3 takes three components, not four
    set(uColour, 1, 2, 3, 4);
  });
});
