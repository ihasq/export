---
description: "Deploy your export project to Cloudflare Workers with a single command. Supports standalone Workers and Workers Sites for full-stack apps."
---

# Deploy

## Standalone Worker

For projects created with `npm create export`:

```bash
npm run export
```

This runs two steps:

1. **`generate-export-types`** -- reads `package.json`, parses your source with oxc-parser, generates type definitions, minifies the client, produces a unique cache-busting UUID, and auto-generates `wrangler.toml`
2. **`wrangler deploy`** -- deploys your Worker to Cloudflare

## Workers Sites (Vite + export)

For Vite projects with `exportc`:

```bash
npm run export
```

This deploys your entire app to Workers Sites:

1. **`vite build`** -- builds your frontend app
2. **`wrangler deploy`** -- deploys static assets + server exports together

Your Vite app's `dist/` folder becomes the static assets, and your `export/` functions are the Worker. Everything runs on Cloudflare's edge.

The production URL is auto-detected from `export/package.json` name. Your app is live at `https://{name}.workers.dev`.

## Generated files

The build process generates several files in your project root:

| File | Purpose |
|------|---------|
| `wrangler.toml` | Auto-generated Cloudflare configuration |
| `.export-types.js` | Type definitions and minified client core |
| `.export-module-map.js` | Module routing map |
| `.export-shared.js` | Shared state proxies for Workers RPC |

These files are regenerated on each build. You can add them to `.gitignore`:

```gitignore
wrangler.toml
.export-*.js
```

## Environment setup

If deploying from a headless server (CI, VPS), set your Cloudflare API token:

```bash
export CLOUDFLARE_API_TOKEN=your-token-here
npm run export
```

Create a token at [Cloudflare Dashboard > API Tokens](https://dash.cloudflare.com/profile/api-tokens) using the **Edit Cloudflare Workers** template.

## Requirements

- Node.js 18+
- Cloudflare Workers account ([free tier](https://developers.cloudflare.com/workers/platform/pricing/) works)
- Wrangler 4+
