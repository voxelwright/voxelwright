// Collapsible. One row of words with a chevron that shows and hides what is under it, on the
// same surface.
// Tool: none. It is the browser's own <details>, and everything it does is the browser's: Enter
// and Space on the row, a press, find-in-page. With no script, and on a plain page, it needs no wiring.
// Markup: <details class="vx-collapsible"><summary>Older deploys</summary> … </details>
//         Words that change with it:
//         <summary><span data-vx-when="closed">Show older deploys</span><span data-vx-when="open">Hide them</span></summary>

export const collapsible = {
  name: 'collapsible',
  selector: '.vx-collapsible',
};
