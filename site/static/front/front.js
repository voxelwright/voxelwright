// Enhances the personal front page's voxel lettering and kit parts after plain HTML paints.
// Works without this script and without WebGPU: the inlined kit CSS is the plain version.
import { mountFront } from "./kit-front.js";

const root = document.documentElement;
const shown = () =>
  document.prerendering
    ? new Promise((resolve) => document.addEventListener("prerenderingchange", resolve, { once: true }))
    : Promise.resolve();

async function boot() {
  if (document.prerendering) await shown();
  if (root.hasAttribute("data-vx-plain")) {
    root.dataset.vx = "plain";
    return;
  }
  const stage = await mountFront();
  root.dataset.vx = stage ? "live" : "plain";
}

document.addEventListener("vx-plain", () => {
  root.dataset.vx = "plain";
});

boot();
