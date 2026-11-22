// The Signal Desk's page: the site's boot, with the desk's controller set up before the kit
// adopts the page. The controller (the kit's showcase desk) restores this visit's build and
// fits the instrument, which the whole site then follows (see the early script in each page).
// Its Switch sound is the site's one sound choice.
import { boot, soundOn, setSound } from "../site.js";

const bench = document.querySelector(".signal-desk .workbench");
await boot({
  before: async () => {
    // the desk keeps its consent for the tab; hand it the site's choice first
    try { sessionStorage.setItem("vx-showcase-switch-sound", soundOn() ? "on" : "off"); } catch {}
    await import("../vendor/village/kit/showcase/desk.js");
    document.querySelector("#sound").addEventListener("change", (e) => setSound(e.target.checked));
    for (const part of bench.querySelectorAll("[inert]")) part.inert = false;
    document.querySelector("#desk-fallback").hidden = true;
    document.querySelector("#gain-help").hidden = false;
  },
});
