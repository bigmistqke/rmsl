/**
 * Drives the real API against a real context, from inside a browser page.
 *
 * Bundled and evaluated by webgl.gpu.test.ts. It lives in its own file rather
 * than as a string in the test because it is ordinary code that should be
 * type-checked and readable, and because a bundle can follow its imports —
 * which is what lets it call the actual compiler and the actual setter rather
 * than a hand-written stand-in.
 *
 * Only serialisable values are returned: a WebGL context cannot be passed out
 * of the page.
 */

import { Fn, attribute, compileGLSL, uniform, uniformArray, vec4 } from "../rmsl";
import { createWebGLProgram } from "./index";

/**
 * Renders one pixel whose colour is a uniform, and reads it back.
 *
 * Returns the RGB that arrived. If the uniform reached the shader, it matches
 * what was set — which is the one thing a recording stub cannot establish.
 */
export function probeUniform(): number[] {
  const position = attribute("vec2");
  const colour = uniform("vec3");

  const vertexMain = Fn(() => vec4(position.x, position.y, 0.0, 1.0));
  const fragmentMain = Fn(() => vec4(colour.x, colour.y, colour.z, 1.0));

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 unavailable in the test browser");
  if (!gl.getExtension("EXT_color_buffer_float")) {
    throw new Error("EXT_color_buffer_float unavailable; cannot read a float back");
  }

  // Rendering to a float texture rather than the canvas, so the value read
  // back is the one that was set rather than an 8-bit rounding of it.
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0,
  );

  const { program, set } = createWebGLProgram(gl, vertexMain(), fragmentMain());
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW,
  );
  const location = gl.getAttribLocation(program, position.name);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

  set(colour, 0.25, 0.5, 0.75);

  gl.viewport(0, 0, 1, 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const out = new Float32Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
  return [out[0]!, out[1]!, out[2]!];
}

/**
 * Sets a uniform the shader declares but the driver eliminates.
 *
 * `unused` is referenced from the fragment graph — via `.toVar()`, which
 * emits a `let` statement into the shader body — so RMSL declares it and
 * writes a real reference to it into the GLSL text. But the resulting
 * variable is never read afterward, so it cannot reach the shader's output;
 * a real GLSL compiler's dead-code elimination drops the statement (and with
 * it the only use of the uniform), same as it would for a uniform that
 * reaches an `if` branch the caller can prove is never taken. RMSL's own
 * folding only touches literal-against-literal operations (`tryFold` in
 * ../rmsl), so this is not RMSL quietly optimising the uniform away itself —
 * the elimination has to come from the driver.
 *
 * Returns whether the emitted GLSL actually declared the uniform (proving
 * the driver had something to eliminate, not just an absence from a map)
 * alongside the warning count, which must be one however many times it is
 * set once the driver has eliminated it.
 */
export function probeEliminated(): { declared: boolean; warnings: number } {
  const position = attribute("vec2");
  const unused = uniform("float");

  const vertexMain = Fn(() => vec4(position.x, position.y, 0.0, 1.0));
  const fragmentMain = Fn(() => {
    unused.mul(2.0).toVar();
    return vec4(1.0, 0.0, 0.0, 1.0);
  });

  const fragmentRoot = fragmentMain();
  const declared = compileGLSL.fragment(fragmentRoot).includes(unused.name);

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 unavailable in the test browser");

  const { program, set } = createWebGLProgram(gl, vertexMain(), fragmentRoot);
  gl.useProgram(program);

  let warnings = 0;
  const original = console.warn;
  console.warn = () => { warnings += 1; };
  try {
    set(unused, 1);
    set(unused, 2);
    set(unused, 3);
  } finally {
    console.warn = original;
  }
  return { declared, warnings };
}

/**
 * Renders one pixel whose colour is one element of a uniform array, and
 * reads it back.
 *
 * A recording stub cannot show this working: `reflectUniforms` has to strip
 * the "[0]" suffix WebGL reports an array uniform's name under before
 * `set`'s lookup by `node.name` can even find a location, and only a real
 * linked program reports a name that way. Reading back the middle element
 * (rather than the first) also rules out `element()` silently resolving to
 * index 0 regardless of what was asked for.
 */
export function probeUniformArray(): number[] {
  const position = attribute("vec2");
  const colours = uniformArray("vec4", 3);

  const vertexMain = Fn(() => vec4(position.x, position.y, 0.0, 1.0));
  const fragmentMain = Fn(() => colours.element(1));

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL2 unavailable in the test browser");
  if (!gl.getExtension("EXT_color_buffer_float")) {
    throw new Error("EXT_color_buffer_float unavailable; cannot read a float back");
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0,
  );

  const { program, set } = createWebGLProgram(gl, vertexMain(), fragmentMain());
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW,
  );
  const location = gl.getAttribLocation(program, position.name);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);

  // Each element gets a distinct value, so reading back element 1 rather than
  // element 0 or 2 is what proves the right slot of the buffer was read.
  set(colours, [
    0.9, 0.9, 0.9, 0.9,
    0.1, 0.2, 0.3, 0.4,
    0.6, 0.7, 0.8, 0.5,
  ]);

  gl.viewport(0, 0, 1, 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const out = new Float32Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}
