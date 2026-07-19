/**
 * Runs the bindings against a real WebGL2 context.
 *
 * uniforms.test.ts records which call each type produces, which a wrong
 * location or an argument GL rejects would both survive — a recorder accepts
 * anything. So the whole path runs here instead: an RMSL graph is compiled,
 * linked, reflected, set and rendered, and the pixel is read back.
 *
 * The context only exists inside the page and cannot be passed out, so the
 * fixture is bundled and evaluated there. Bundling rather than transpiling one
 * file is what lets the fixture use the real compiler and the real setter.
 */

import { describe, it, expect, afterAll } from "vitest";
import { build } from "vite";

declare const process: { env: Record<string, string | undefined> };

const SKIPPED = !!process.env.RMSL_SKIP_GPU || !!process.env.RMSL_SKIP_SHADER_EVALUATION;

let browser: any;
let bundled: string | undefined;

afterAll(async () => {
  await browser?.close();
});

/** The fixture and everything it imports, as one script for the page. */
async function fixtureBundle(): Promise<string> {
  if (bundled) return bundled;
  const result: any = await build({
    // The repo's own vite.config.ts defines a multi-entry library build (plus
    // a dts plugin) for shipping rmsl/webgl — picking that up here would fight
    // this one-off fixture build rather than build just the fixture.
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      lib: {
        // `.pathname` rather than `fileURLToPath`: the latter needs
        // `node:url`'s types, and this repo does not depend on @types/node.
        // A plain pathname is fine on macOS/Linux CI; it would need escaping
        // for a drive-letter Windows path, which this project does not target.
        entry: new URL("./webgl.fixture.ts", import.meta.url).pathname,
        formats: ["iife"],
        name: "RMSLFixture",
        fileName: () => "fixture.js",
      },
    },
  });
  bundled = result[0].output[0].code;
  return bundled!;
}

async function runInPage(call: string): Promise<any> {
  const { chromium } = await import("playwright");
  browser ??= await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  try {
    await page.goto("about:blank");
    return await page.evaluate(
      ({ code, expression }: { code: string; expression: string }) =>
        new Function(`${code}; return RMSLFixture.${expression};`)(),
      { code: await fixtureBundle(), expression: call },
    );
  } finally {
    await page.close();
  }
}

describe.skipIf(SKIPPED)("against a real context", () => {
  it("delivers a uniform to the shader", async () => {
    const [r, g, b] = await runInPage("probeUniform()");
    expect(r).toBeCloseTo(0.25, 5);
    expect(g).toBeCloseTo(0.5, 5);
    expect(b).toBeCloseTo(0.75, 5);
  }, 120_000);

  // The stub test asserts this too, but only here is the uniform genuinely
  // absent — removed by the real GLSL compiler rather than left out of a map.
  it("warns once for a uniform GLSL removed, however often it is set", async () => {
    expect(await runInPage("probeEliminated()")).toBe(1);
  }, 120_000);
});
