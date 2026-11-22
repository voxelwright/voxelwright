// The generator, feed, and Worker share this configuration.
export default {
  title: "Pavlo Zahynailo",
  author: "Pavlo Zahynailo",
  description: "Pavlo Zahynailo’s writing and interactive Voxelmorphism experiments.",
  language: "en",
  origin: "https://zahynailo.dev",

  // Answer `Accept: text/markdown` on page routes from the Worker.
  // Off by default: every page view would then invoke the Worker and count against the
  // Workers Free plan's 100,000 requests a day, and over the limit those requests get 429
  // instead of the static page. Turn on once the account is on Workers Paid.
  // The static .md URLs and <link rel="alternate"> work either way and cost nothing.
  // `npm run dev` always negotiates, whatever this says.
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
  ],
};
