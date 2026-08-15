/**
 * Checks what an application actually has to bundle to use the bindings.
 *
 * The reason to precompile shaders is to keep the compiler out of the browser,
 * so "the bindings work without a node graph" is only half the claim — the
 * other half is that reaching for them does not drag rmsl back in. That is a
 * property of the import graph rather than of any function's behaviour, so it
 * is checked by bundling and looking at what survived.
 *
 * A bundler drops an unused module only if it may assume importing it does
 * nothing observable, which is what `sideEffects: false` in package.json
 * tells it. Without that, rmsl's top-level `Object.assign` calls are enough to
 * keep the whole compiler alive even when nothing calls it.
 */

import { describe, it, expect } from "vitest";
import { build } from "esbuild";

/** Resolves the snippets' imports as if they sat next to the bindings. */
const HERE = new URL(".", import.meta.url).pathname;

/**
 * Names that exist only inside rmsl's compiler.
 *
 * The output is not minified, so an identifier that survives is one the
 * bundler decided to keep. Two are checked rather than one so that renaming
 * either does not quietly turn this into a test that passes for no reason.
 */
const COMPILER_INTERNALS = ["compileGLSLWithStage", "NodeImpl"];

/** Bundles a snippet the way an application bundler would. */
async function bundle(source: string): Promise<string> {
  const result = await build({
    stdin: { contents: source, resolveDir: HERE, loader: "ts", sourcefile: "app.ts" },
    bundle: true,
    write: false,
    format: "esm",
    treeShaking: true,
    logLevel: "silent",
  });
  return result.outputFiles![0]!.text;
}

describe("what a precompiled build bundles", () => {
  it("leaves the compiler out when a program is linked from sources", async () => {
    const code = await bundle(`
      import { linkWebGLProgram } from "./index";
      declare const gl: WebGL2RenderingContext;
      console.log(linkWebGLProgram(gl, { vertex: "v", fragment: "f" }));
    `);
    for (const name of COMPILER_INTERNALS) expect(code).not.toContain(name);
  });

  it("leaves the compiler out when a uniform is written through a descriptor", async () => {
    const code = await bundle(`
      import { createUniformSetter } from "./index";
      declare const gl: WebGL2RenderingContext;
      const set = createUniformSetter(gl, new Map());
      set({ name: "uColour", type: "vec3" }, 1, 0, 0);
    `);
    for (const name of COMPILER_INTERNALS) expect(code).not.toContain(name);
  });

  // Without this, the two above would still pass if the bindings stopped
  // exporting anything at all, or if the marker names went stale.
  it("does bundle the compiler when a program is built from nodes", async () => {
    const code = await bundle(`
      import { createWebGLProgram } from "./index";
      import { Fn, vec4 } from "../rmsl";
      declare const gl: WebGL2RenderingContext;
      const root = Fn(() => vec4(1, 0, 0, 1))();
      console.log(createWebGLProgram(gl, { vertex: root, fragment: root }));
    `);
    for (const name of COMPILER_INTERNALS) expect(code).toContain(name);
  });
});
