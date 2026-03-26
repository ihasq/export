import { defineConfig } from "vitepress";

export default defineConfig({
  title: "export",
  description: "Turn any Cloudflare Worker into an importable ES module.",
  // base: "/export/",  // Set this if deploying to a subpath
  cleanUrls: true,

  head: [
    ["link", { rel: "preconnect", href: "https://cdn.jsdelivr.net" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://cdn.jsdelivr.net/npm/geist@1.4.1/dist/fonts/geist-sans/style.min.css",
      },
    ],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://cdn.jsdelivr.net/npm/geist@1.4.1/dist/fonts/geist-mono/style.min.css",
      },
    ],
  ],

  appearance: "dark",

  themeConfig: {
    logo: false,

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/" },
      {
        text: "0.0.8",
        items: [
          {
            text: "Changelog",
            link: "https://github.com/ihasq/export/commits/main",
          },
          {
            text: "npm",
            link: "https://www.npmjs.com/package/export-runtime",
          },
        ],
      },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "What is export?", link: "/guide/" },
          { text: "Getting Started", link: "/guide/getting-started" },
        ],
      },
      {
        text: "Features",
        items: [
          { text: "Path-based Imports", link: "/guide/path-imports" },
          { text: "Classes", link: "/guide/classes" },
          { text: "Streaming", link: "/guide/streaming" },
          { text: "Shared Exports", link: "/guide/shared-exports" },
          { text: "TypeScript & Deno", link: "/guide/typescript" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Supported Types", link: "/api/" },
          { text: "Deploy", link: "/guide/deploy" },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/ihasq/export" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright 2024-present ihasq",
    },

    search: {
      provider: "local",
    },
  },
});
