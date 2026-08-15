import {
  Fn,
  attribute,
  compileGLSL,
  uniformRaw,
  varying,
  vec2,
  vec4,
} from "../rmsl";
import { describeUniform } from "../webgl";

// This module is compiled once at build time by vite's precompileShaders plugin
// and replaced with JSON, so the rmsl graph is never built (and rmsl is never
// shipped) in the browser.

export const uColour = uniformRaw("uColour", "vec3");
export const vUv = varying("vec2");
export const positionAttr = attribute("vec2");

export const vertexFn = Fn(() => {
  vUv.assign(positionAttr);
  return vec4(positionAttr, 0, 1);
});

export const fragmentFn = Fn(() => {
  return vec4(uColour, 1);
});

export default {
  // A uniform is carried as a descriptor, not just a name: the browser has no
  // node left to read a shader type off, and `set` needs that type to pick the
  // GL call. An attribute and a varying are addressed by name alone, so those
  // stay strings.
  uColour: describeUniform(uColour),
  vUv: vUv.name,
  positionAttr: positionAttr.name,
  vertexGLSL: compileGLSL.vertex(vertexFn()),
  fragmentGLSL: compileGLSL.fragment(fragmentFn()),
};
