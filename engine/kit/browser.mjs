// Install the kit's native browser modules at their public paths. A checkout has the
// renderer's TypeScript sources. An npm tarball carries this same tree already prepared.
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const root = import.meta.dirname;
const browser = path.join(root, 'browser');

export function copyModules(out) {
  if (!fs.existsSync(path.join(root, 'src'))) {
    fs.cpSync(browser, out, { recursive: true });
    return;
  }
  const kit = path.join(out, 'kit');
  fs.cpSync(path.join(root, 'src'), path.join(kit, 'src'), { recursive: true });
  // The same four modules the engine serves, with browser .js addresses.
  for (const file of ['kit/src/engine.js', 'blocks/renderer.ts', 'blocks/stage.ts', 'blocks/pass.ts', 'probe/gpu.ts']) {
    const source = fs.readFileSync(path.resolve(root, '..', file), 'utf8');
    const js = file.endsWith('.ts') ? stripTypeScriptTypes(source) : source;
    const dest = path.join(out, file.replace(/\.ts$/, '.js'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, js.replace(/(from ['"]\.[^'"]*)\.ts(['"])/g, '$1.js$2'));
  }
  for (const file of ['desk-controls.js', 'lamp-dial.js', 'build-settings.js', 'switch-sound.js', 'contour-fader.js', 'scan-key.js', 'desk.css', 'materials']) {
    fs.cpSync(path.join(root, 'showcase', file), path.join(kit, 'showcase', file), { recursive: true });
  }
}

if (import.meta.main && fs.existsSync(path.join(root, 'src'))) {
  fs.rmSync(browser, { recursive: true, force: true });
  copyModules(browser);
}
