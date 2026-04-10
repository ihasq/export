import { defineConfig } from "vitepress";

const SITE_URL = "https://export-docs.pages.dev";
const OG_IMAGE = `${SITE_URL}/og.svg`;
const TITLE = "export";
const DESCRIPTION =
  "Turn any Cloudflare Worker into an importable ES module. No SDK, no codegen, no build step.";

export default defineConfig({
  title: TITLE,
  description: DESCRIPTION,
  cleanUrls: true,

  sitemap: {
    hostname: SITE_URL,
  },

  head: [
    // Fonts
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

    // Canonical
    ["link", { rel: "canonical", href: SITE_URL }],

    // Open Graph
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: TITLE }],
    ["meta", { property: "og:title", content: `${TITLE} — Import your server as a module` }],
    ["meta", { property: "og:description", content: DESCRIPTION }],
    ["meta", { property: "og:image", content: OG_IMAGE }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { property: "og:url", content: SITE_URL }],

    // Twitter Card
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:title", content: `${TITLE} — Import your server as a module` }],
    ["meta", { name: "twitter:description", content: DESCRIPTION }],
    ["meta", { name: "twitter:image", content: OG_IMAGE }],

    // JSON-LD structured data
    [
      "script",
      { type: "application/ld+json" },
      JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        name: TITLE,
        description: DESCRIPTION,
        url: SITE_URL,
        codeRepository: "https://github.com/ihasq/export",
        programmingLanguage: ["JavaScript", "TypeScript"],
        runtimePlatform: "Cloudflare Workers",
        license: "https://opensource.org/licenses/MIT",
        author: { "@type": "Person", name: "ihasq", url: "https://github.com/ihasq" },
      }),
    ],

    // Misc SEO
    ["meta", { name: "author", content: "ihasq" }],
    [
      "meta",
      {
        name: "keywords",
        content:
          "cloudflare workers, esm, rpc, websocket, durable objects, export, import, remote procedure call, edge computing, serverless",
      },
    ],
    ["meta", { name: "theme-color", content: "#0a0a0a" }],
  ],

  appearance: "dark",

  // Per-page <head> transform for canonical URLs
  transformPageData(pageData) {
    const canonicalUrl = `${SITE_URL}/${pageData.relativePath}`
      .replace(/index\.md$/, "")
      .replace(/\.md$/, "");
    pageData.frontmatter.head ??= [];
    pageData.frontmatter.head.push([
      "link",
      { rel: "canonical", href: canonicalUrl },
    ]);
  },

  themeConfig: {
    logo: false,

    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API", link: "/api/" },
      {
        text: "0.0.10",
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
          { text: "Static Assets", link: "/guide/static-assets" },
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
