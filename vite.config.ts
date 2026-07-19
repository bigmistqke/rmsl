import { defineConfig } from 'vite'
import { writeFileSync, readFileSync } from 'fs'
import dts from 'vite-plugin-dts'

export default defineConfig({
  build: {
    lib: {
      // "../rmsl" is deliberately absent from `rollupOptions.external` below:
      // marking it external makes Rollup emit a bare relative specifier
      // ("./rmsl", no extension) that plain Node ESM refuses to resolve. Left
      // alone, Rollup recognizes that "../rmsl" is itself one of this build's
      // entry points and wires dist/webgl.js to import dist/rmsl.js directly —
      // one copy of the compiler on disk, and every emitted entry still loads
      // standalone.
      entry: {
        rmsl: 'src/rmsl.ts',
        webgl: 'src/webgl/index.ts',
        vite: 'src/vite.ts',
        effects: 'src/effects/index.ts',
        scene: 'src/scene/index.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ['esbuild', 'vite'],
    },
  },
  plugins: [
    dts({
      include: [
        'src/rmsl.ts',
        'src/webgl/**/*.ts',
        'src/vite.ts',
        'src/effects/index.ts',
        'src/effects/*.ts',
        'src/scene/index.ts',
        'src/scene/**/*.ts',
      ],
      exclude: ['src/**/*.test.ts', 'src/**/*.test-d.ts', 'src/**/*.fixture.ts'],
      outDir: 'dist',
      // bundleTypes (api-extractor) is deliberately off, not just left at its
      // default. Turning it on rolls dist/webgl.d.ts up into one file that no
      // longer imports "../rmsl" — but doing so re-declares BaseNode's private
      // `__brand` locally instead of sharing rmsl's, so a Node produced by
      // "rmsl" and a UniformNode consumed by "rmsl/webgl" stop being the same
      // type. apps/infinite-grid, which imports from both entry points, is
      // what catches that: it fails to type-check the moment bundleTypes is
      // true, even though the build itself looks clean.
      bundleTypes: false,
    }),
    {
      // tsc does not carry a `/// <reference types>` directive into emitted
      // declaration files, so consumers of the scene barrel would otherwise see
      // `GPUDevice` and friends as unknown. The WebGPURenderer's ambient GPU
      // types are re-required from the emitted declarations directly.
      name: 'rmsl-scene-webgpu-types',
      closeBundle() {
        const targets = [
          'dist/scene/index.d.ts',
          'dist/scene/renderers/WebGPURenderer.d.ts',
        ]
        for (const target of targets) {
          const file = readFileSync(target, 'utf8')
          if (file.startsWith('/// <reference')) continue
          writeFileSync(target, `/// <reference types="@webgpu/types" />\n${file}`)
        }
      },
    },
  ],
})
