---
description: "Serve static files like HTML, CSS, and images alongside your API using Cloudflare Static Assets."
---

# Static Assets

Serve static files (HTML, CSS, JavaScript, images) alongside your API exports.

## Setup

Set `cloudflare.assets` in `package.json` to your static assets directory:

```json
{
  "cloudflare": {
    "name": "my-app",
    "exports": "./src",
    "assets": "./public"
  }
}
```

Create your static files:

```
my-app/
├── src/
│   └── index.ts          # API exports
├── public/
│   ├── index.html        # → /
│   ├── style.css         # → /style.css
│   ├── app.js            # → /app.js
│   └── images/
│       └── logo.png      # → /images/logo.png
└── package.json
```

## How it works

When a request comes in:

1. **API routes are checked first** -- if the path matches an export (e.g., `/greet`), the RPC handler responds
2. **Static assets are served** -- if no API route matches, the file is served from your assets directory
3. **404 is returned** -- if neither matches

This means your API exports always take precedence over static files with the same name.

## Example: Full-stack app

```json
{
  "cloudflare": {
    "name": "my-fullstack-app",
    "exports": "./src",
    "assets": "./public"
  }
}
```

```typescript
// src/index.ts
export async function createUser(name: string, email: string) {
  // ... database logic
  return { id: 1, name, email };
}

export async function getUsers() {
  // ... database logic
  return [{ id: 1, name: "Alice", email: "alice@example.com" }];
}
```

```html
<!-- public/index.html -->
<!DOCTYPE html>
<html>
<head>
  <title>My App</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div id="app"></div>
  <script type="module">
    import { getUsers, createUser } from "/";

    const users = await getUsers();
    console.log(users);
  </script>
</body>
</html>
```

## Powered by Cloudflare Static Assets

Under the hood, this uses [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/):

- **Global caching** -- files are cached at edge locations worldwide
- **Automatic compression** -- gzip/brotli compression is applied
- **Immutable caching** -- hashed filenames get long cache lifetimes

## Without static assets

If you don't need static files, simply omit the `assets` field:

```json
{
  "cloudflare": {
    "name": "my-api",
    "exports": "./src"
  }
}
```

Your Worker will only serve API exports and return 404 for unmatched paths.
