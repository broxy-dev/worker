# AGENTS.md - Coding Agent Guidelines for Broxy Worker

## Project Overview

Cloudflare Workers + Durable Objects backend providing WebSocket bridging, REST API proxy, and MCP (Model Context Protocol) support to expose browser capabilities as callable API services.

## Build/Lint/Test Commands

```bash
# Development server (default: http://localhost:8787)
npx wrangler dev

# Deploy to Cloudflare
npx wrangler deploy

# Generate TypeScript types
npx wrangler types

# Tail production logs
npx wrangler tail --format pretty
```

Note: No test framework configured. If added, use `npm test`.

## Code Style Guidelines

### Language & Modules
- **JavaScript ES6+** (not TypeScript) with ES module system
- **Runtime**: Cloudflare Workers (V8 isolates)
- Use `async/await` over raw Promises

### Formatting
- 2-space indentation, single quotes, no semicolons
- Space after keywords (`if (`, `for (`), around operators
- Opening brace on same line, max 80-100 char lines

### Naming Conventions
- **Variables/Functions**: camelCase (`handleRequest`, `userId`)
- **Classes**: PascalCase (`BrowserConnection`, `MCPHandler`)
- **Constants**: UPPER_SNAKE_CASE (`DEFAULT_TIMEOUT`)
- **Booleans**: `is/has` prefixes (`isSessionExpired`)
- **Handlers**: `handle` prefix (`handleWebSocket`)

### Imports Pattern
```javascript
import { MCPHandler } from './mcpHandler.js'
export class BrowserConnection { }
export default { }
export { BrowserConnection } from './durableObject.js'
```

### Response Patterns

**JSON Response with CORS:**
```javascript
function jsonResponse(data, status = 200, headers = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...defaultHeaders, ...headers }
  })
}
```

**Custom Response Format (browser returns):**
```javascript
// Browser scripts can return custom format:
{
  status: 200,
  headers: { 'Content-Type': 'image/png' },
  body: 'base64data...',
  isBase64: true
}
```

**Error Response Structure:**
```javascript
{ error: 'Error type', userId: 'user123', details: 'Info', hint: 'Suggestion' }
```

### Error Handling
```javascript
try {
  const result = await response.json()
} catch (error) {
  if (error.message === 'Durable Object not found') {
    return jsonResponse({ error: 'Browser not connected', userId }, 404)
  }
  return jsonResponse({ error: 'Request failed', details: error.message }, 500)
}

// Early validation returns
if (!userId) return jsonResponse({ error: 'Missing userId' }, 400)
```

### Data Structures
- `Map` for dynamic key-value collections (`this.connections = new Map()`)
- Plain objects for static structures (`{ method, params, id }`)
- `const` by default, `let` only when reassignment needed

### Comments
```javascript
// Chinese and English comments are both acceptable
// ===== Section headers use this format =====
const timeout = parseInt(env.DEFAULT_TIMEOUT || '30000') // Parse env var with fallback
```

## Cloudflare Workers Specifics

### Durable Objects
```javascript
export class BrowserConnection {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.connections = new Map()
  }
  async fetch(request) { /* Handle requests */ }
}
```

### WebSocket Handling
```javascript
const [client, server] = Object.values(new WebSocketPair())
server.accept()
return new Response(null, { status: 101, webSocket: client })
```

### Environment Variables
- Access: `env.VARIABLE_NAME`
- Parse numbers: `parseInt(env.DEFAULT_TIMEOUT || '30000')`

## Project Structure
```
worker/
├── src/
│   ├── index.js          # Main entry, route dispatching
│   ├── durableObject.js  # Durable Object, connection management
│   └── mcpHandler.js     # MCP JSON-RPC protocol handler
└── wrangler.toml         # Cloudflare Worker configuration
```

## Key Routes
| Route | Purpose |
|-------|---------|
| `GET /connect?id={userId}` | WebSocket connection (browser script) |
| `POST /mcp/{userId}` | MCP JSON-RPC endpoint |
| `GET/POST /api/{userId}/{route}` | REST API proxy |
| `GET /health` | Health check |

## Best Practices
1. **Always include CORS headers** in responses
2. **Handle timeouts** for browser requests (default 30s)
3. **Clean up resources** when WebSocket connections close
4. **Use `crypto.randomUUID()`** for unique identifiers
5. **Validate inputs early** with meaningful error messages
6. **Log important events** with prefixes like `[MCP]`
7. **Use Object spread** for merging: `{ ...defaultHeaders, ...headers }`

## Common Patterns

```javascript
// Route matching
const mcpMatch = path.match(/^\/mcp\/([^\/]+)$/)
if (mcpMatch) const userId = mcpMatch[1]

// Promise with timeout
const responsePromise = new Promise((resolve, reject) => {
  const timeoutId = setTimeout(() => {
    this.pendingRequests.delete(requestId)
    reject(new Error('Request timeout'))
  }, this.timeout)
  this.pendingRequests.set(requestId, { resolve, reject, connectionId })
})
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_TIMEOUT` | `30000` | Browser request timeout (ms) |

## Notes
- Uses Cloudflare free tier Durable Objects with SQLite storage
- No package.json - uses `npx wrangler` directly
- Supports REST API and MCP protocol for browser automation
