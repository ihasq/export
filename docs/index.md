---
layout: home

hero:
  name: export
  text: Import your server as a module.
  tagline: Turn any Cloudflare Worker into a remotely importable ES module. No SDK, no codegen, no build step on the client.
  image:
    light: /placeholder.svg
    dark: /placeholder.svg
    alt: " "
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/ihasq/export

features:
  - title: Just import
    details: Import directly from a Worker URL. Functions, classes, and objects become async proxies automatically.
  - title: Vite integration
    details: "npx exportc init adds export to any Vite project. Auto-starts Wrangler, auto-generates types, deploys with npm run export."
  - title: Shared state
    details: Add ?shared to share state across clients via Durable Objects. Real-time collaboration with zero setup.
  - title: Streaming
    details: ReadableStream and AsyncIterator work out of the box. Stream data to the client as it's produced.
  - title: Types included
    details: TypeScript definitions auto-generated from your code. Full inference in Deno via X-TypeScript-Types, auto-updated in Vite.
  - title: Rich data types
    details: Date, Map, Set, BigInt, URL, RegExp, TypedArrays, circular references -- all serialize and deserialize seamlessly.
---
