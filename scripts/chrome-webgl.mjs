// Preloaded by `npm run check --webgl` (NODE_OPTIONS=--import). The check scripts launch Chrome
// with WebGPU on and the Metal backend, which only a Mac has. This takes those flags out and
// turns WebGPU off, so the home takes its WebGL2 path (software rendering on a hosted runner).
import { createRequire } from 'node:module'

const { chromium } = createRequire(`${process.cwd()}/`)('playwright')
const launch = chromium.launch.bind(chromium)
const drop = new Set(['--enable-unsafe-webgpu', '--use-angle=metal'])
chromium.launch = (options = {}) =>
  launch({
    ...options,
    args: [...(options.args ?? []).filter((a) => !drop.has(a)), '--disable-features=WebGPU', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
