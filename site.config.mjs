// One place for the site's settings. The build, the Worker config and the checks read it.
export default {
  title: "TODO: site title",
  // Used in <meta name="description">, llms.txt and the feed.
  description: "TODO: one sentence about the site. Notes on AI, music, games, what I learned, and a dev diary for Village.",
  author: "TODO: author name",
  language: "en",
  // TODO: the real origin once the domain is chosen. Feed, sitemap, canonical links and
  // the Markdown twins use it for absolute URLs.
  origin: "https://example.com",

  // Answer `Accept: text/markdown` on page routes from the Worker.
  // Off by default: every page view would then invoke the Worker and count against the
  // Workers Free plan's 100,000 requests a day, and over the limit those requests get 429
  // instead of the static page. Turn on once the account is on Workers Paid.
  // The static .md URLs and <link rel="alternate"> work either way and cost nothing.
  // `npm run dev` always negotiates, whatever this says.
  negotiateMarkdown: false,

  // Home page sections.
  intro: "TODO: a short intro, written by the owner.",
  projects: [
    {
      name: "Village",
      description: "TODO: one line about Village, the engine and home project. Its dev diary lives under the village tag.",
      tag: "village",
    },
  ],
  links: [
    // TODO: real links, e.g. { name: "GitHub", url: "https://github.com/…" }
  ],
};
