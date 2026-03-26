# Deploy

## To Cloudflare Workers

```bash
npm run export
```

This runs two steps:

1. **`generate-export-types`** -- parses your source with oxc-parser, generates type definitions, minifies the client, and produces a unique cache-busting UUID
2. **`wrangler deploy`** -- deploys your Worker to Cloudflare

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
