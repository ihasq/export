---
description: "Configure origin restrictions and access control for your export Worker."
---

# Security

## Overview

By default, export Workers follow standard Cloudflare Workers behavior: they accept requests from any origin. The `security` configuration in `package.json` allows you to restrict access.

## Origin Restrictions

Limit which origins can access your Worker by setting `security.access.origin`:

```json
{
  "name": "my-app",
  "exports": "./src",
  "security": {
    "access": {
      "origin": ["https://example.com", "https://app.example.com"]
    }
  }
}
```

### Behavior

| Configuration | Effect |
|---------------|--------|
| `origin` omitted or `[]` | All origins allowed (default) |
| `origin: ["https://example.com"]` | Only listed origins allowed |

When origin restrictions are enabled:

- **HTTP requests** from unlisted origins receive `403 Forbidden`
- **WebSocket upgrades** from unlisted origins are rejected with `403 Forbidden`
- **CORS headers** reflect the specific allowed origin instead of `*`

### CORS Headers

Without restrictions:
```
Access-Control-Allow-Origin: *
```

With restrictions (request from allowed origin):
```
Access-Control-Allow-Origin: https://example.com
Vary: Origin
```

## Configuration Reference

```json
{
  "security": {
    "access": {
      "origin": ["https://example.com"]
    }
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `security.access.origin` | `string[]` | `[]` | Allowed origins. Empty = allow all. |

## Examples

### Single Origin

Allow only your production frontend:

```json
{
  "security": {
    "access": {
      "origin": ["https://myapp.com"]
    }
  }
}
```

### Multiple Origins

Allow production and staging:

```json
{
  "security": {
    "access": {
      "origin": [
        "https://myapp.com",
        "https://staging.myapp.com",
        "http://localhost:3000"
      ]
    }
  }
}
```

### Development

During development, you may want to allow all origins:

```json
{
  "security": {
    "access": {
      "origin": []
    }
  }
}
```

Or omit the `security` field entirely.

## Notes

- Origins must match exactly, including protocol (`https://` vs `http://`)
- Port numbers matter: `http://localhost:3000` and `http://localhost:8080` are different origins
- Trailing slashes should not be included: use `https://example.com`, not `https://example.com/`
- The `Origin` header is sent by browsers for cross-origin requests; server-to-server calls without this header are not affected by origin restrictions
