// The generator, feed, and Worker share this configuration.
export default {
  title: "Pavlo Zahynailo",
  author: "Pavlo Zahynailo",
  description: "Pavlo Zahynailo’s writing and interactive Voxelmorphism experiments.",
  language: "en",
  origin: "https://zahynailo.dev",
  // Where the site is mounted on its origin (lib/paths.mjs). The personal front page
  // (generator/front.mjs) owns "/" on zahynailo.dev, so the site lives under /blog/: the posts list
  // is /blog/, everything else the site has is below it, and the 3D landing is not built.
  // "/" builds the whole origin, with the landing at "/".
  base: "/blog/",

  // Answer `Accept: text/markdown` on page routes from src/worker.mjs (site/cloudflare.config.ts).
  // That config is used only by `npm run dev`, which always negotiates whatever this says; the
  // deployed zahynailo.dev is deploy/'s assets-only Worker and never runs src/worker.mjs.
  // The static .md URLs and <link rel="alternate"> work either way and cost nothing.
  negotiateMarkdown: false,

  // Every page is built from the Voxelmorphism kit (generator/pages.mjs, notes/voxelmorphism.md);
  // there are no alternative looks. The Ink design (iter-1) was retired on Nov 19.

  // Features behind flags: a folder in features/<name>/ is built in only when its name is true
  // here. Off is the default. Turning one on is the owner's step. See features/README.md.
  flags: {},

  // The archived design previews also read intro and projects.
  intro: "Writing and experiments in voxels.",
  projects: [{ name: "Village", description: "The engine behind the landing.", tag: "village" }],
  links: [
    { name: "X", url: "https://x.com/pasha_knz" },
    { name: "LinkedIn", url: "https://www.linkedin.com/in/pavlo-zahynailo/" },
    { name: "Twitch", url: "https://www.twitch.tv/p_bender" },
    { name: "GitHub", url: "https://github.com/zahynailo" },
  ],
};
