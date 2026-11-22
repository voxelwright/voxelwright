// The ai-session block reads fine without this. It adds three things:
//   "Expand all" opens every fold in the block, and closes them again (a latching key: down
//   while everything is open).
//   "Tool activity" hides or shows the tool-call lines (remembered per reader).
// Its two keys are the kit's toggle buttons; the kit hears aria-pressed change by itself.
//   Following a link to a turn opens the folds around it and scrolls it into view.
const KEY = "ais-tools";

function remembered() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function remember(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // private window or blocked storage: the choice lasts for this page only
  }
}

function setup(block) {
  if (block.dataset.aisReady) return;
  block.dataset.aisReady = "1";
  const controls = block.querySelector(".ais-controls");
  if (!controls) return;
  controls.hidden = false;
  const expand = controls.querySelector("[data-ais-expand]");
  const tools = controls.querySelector("[data-ais-tools]");
  const folds = () => block.querySelectorAll("details");

  // the keys are the kit's toggle buttons: a press flips aria-pressed and sends vx-change
  expand.addEventListener("vx-change", (event) => {
    for (const d of folds()) d.open = event.detail.pressed;
  });

  const applyTools = (on) => {
    block.dataset.tools = on ? "on" : "off";
    tools.setAttribute("aria-pressed", String(on));
  };
  applyTools(remembered() !== "off");
  tools.addEventListener("vx-change", (event) => {
    applyTools(event.detail.pressed);
    remember(event.detail.pressed ? "on" : "off");
  });
}

/** Opens every fold around the linked turn, then brings it into view. */
function reveal() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  const block = target?.closest(".ais");
  if (!block) return;
  for (const el of block.querySelectorAll(".ais-here")) el.classList.remove("ais-here");
  if (target.classList.contains("ais-act") && block.dataset.tools === "off") block.dataset.tools = "on";
  for (let d = target.closest("details"); d; d = d.parentElement?.closest("details")) d.open = true;
  if (target.matches("details")) target.open = true;
  // A link to an exchange opens what came back, too.
  target.querySelector(":scope > .ais-ex-body > .ais-answer")?.setAttribute("open", "");
  target.classList.add("ais-here");
  target.scrollIntoView({ block: "start" });
}

for (const block of document.querySelectorAll(".ais")) setup(block);
window.addEventListener("hashchange", reveal);
if (location.hash) reveal();
