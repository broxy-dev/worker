# AGENTS.md - Coding Agent Guidelines for Broxy Worker

## Project Overview

Broxy Worker is a Cloudflare Workers + Durable Objects backend service that provides WebSocket bridging, REST API proxy, and MCP (Model Context Protocol) support to expose browser capabilities as callable API services.

## Build/Lint/Test Commands

### Development
```bash
# Start local development server (default: http://localhost:8787)
npx wrangler dev

# Start with specific port
npx wrangler dev --port 8788
```

### Deployment
```bash
# Deploy to Cloudflare Workers
npx wrangler deploy

# Deploy to specific environment
npx wrangler deploy --env production
```

### Testing
```bash
# No test framework is configured in this project
# If tests are added, use: npm test or npx wrangler dev --test-scheduled
```

### Type Generation
```bash
# Generate TypeScript types from Worker configuration
npx wrangler types
```

### Logs & Debugging
```bash
# Tail logs from deployed worker
npx wrangler tail

# Tail logs with filtering
npx wrangler tail --format pretty
```

## Code Style Guidelines

### Language & Features
- **JavaScript**: ES6+ syntax (not TypeScript)
- **Modules**: ES6 module system (`export`/`import`)
- **Runtime**: Cloudflare Workers runtime (V8 isolates)
- **Async**: Use `async/await` instead of raw Promises when possible

### Imports
```javascript
// Named exports at the top
import { MCPHandler } from './mcpHandler.js';

// Export classes/functions
export class BrowserConnection { }
export default { }

// Re-export pattern
export { BrowserConnection } from './durableObject.js';
```

### Formatting
- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings (`'text'`)
- **Semicolons**: No semicolons at end of statements
- **Spacing**: 
  - Space after keywords (`if (`, `for (`, `function (`)
  - Space around operators (`x = y`, `a + b`)
  - No trailing whitespace
- **Line length**: Aim for 80-100 characters max
- **Braces**: Opening brace on same line

### Naming Conventions
- **Variables/Functions**: camelCase (`handleRequest`, `userId`, `connectionId`)
- **Classes**: PascalCase (`BrowserConnection`, `MCPHandler`)
- **Constants**: UPPER_SNAKE_CASE for true constants (`DEFAULT_TIMEOUT`)
- **Private members**: Prefix with underscore or use closure (no `#` private fields seen)
- **Boolean variables**: Use `is/has` prefixes (`isSessionExpired`, `hasConnection`)
- **Event handlers**: Prefix with `handle` (`handleWebSocket`, `handleExecute`)

### Functions
```javascript
// Function declarations for main functions
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

// Arrow functions for callbacks and inline functions
server.addEventListener('message', (event) => {
  const data = JSON.parse(event.data)
})

// Async functions
async function handleApiCall(request, env, userId, route) {
  const result = await durableObject.fetch(request)
  return result
}

// Default parameters
function jsonResponse(data, status = 200, headers = {})
```

### Error Handling
```javascript
// Try-catch with specific error handling
try {
  const result = await response.json()
  return result
} catch (error) {
  if (error.message === 'Durable Object not found') {
    return jsonResponse({ 
      error: 'Browser not connected', 
      userId,
      hint: 'Browser script may not be running'
    }, 404)
  }
  
  return jsonResponse({ 
    error: 'Request failed', 
    details: error.message 
  }, 500)
}

// Early returns for validation
if (!userId) {
  return jsonResponse({ error: 'Missing userId parameter' }, 400)
}
```

### Data Structures
- Use `Map` for key-value collections with dynamic keys (`this.connections = new Map()`)
- Use plain objects for static structures (`{ method, params, id }`)
- Use `const` for references that don't change
- Use `let` only when reassignment is needed

### Comments
```javascript
// Chinese comments are acceptable in this codebase
// ===== Section headers use this format =====

// Inline comments explain "why", not "what"
const timeout = parseInt(env.DEFAULT_TIMEOUT || '30000') // Parse env var with fallback

// TODO and FIXME comments
// TODO: Add retry logic
// FIXME: Handle edge case when connection drops
```

### Response Patterns
```javascript
// JSON responses with CORS headers
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

// Consistent error response structure
{
  error: 'Error type',
  userId: 'user123',
  details: 'Additional information',
  hint: 'Suggestion for fixing'
}
```

### Cloudflare Workers Specifics

#### Durable Objects
```javascript
export class BrowserConnection {
  constructor(state, env) {
    this.state = state    // Durable Object state
    this.env = env        // Environment bindings
    this.connections = new Map()
  }

  async fetch(request) {
    // Handle requests to this Durable Object
  }
}
```

#### WebSocket Handling
```javascript
// Create WebSocket pair
const [client, server] = Object.values(new WebSocketPair())
server.accept()

// Return 101 Switching Protocols
return new Response(null, {
  status: 101,
  webSocket: client
})
```

#### Environment Variables
- Access via `env.VARIABLE_NAME`
- Define in `wrangler.toml` under `[vars]`
- Parse numeric strings: `parseInt(env.DEFAULT_TIMEOUT || '30000')`

### Project Structure
```
worker/
├── src/
│   ├── index.js          # Main entry, route dispatching
│   ├── durableObject.js  # Durable Object, connection management
│   └── mcpHandler.js     # MCP JSON-RPC protocol handler
└── wrangler.toml         # Cloudflare Worker configuration
```

### Best Practices
1. **Always include CORS headers** in responses for browser compatibility
2. **Handle timeouts** for browser requests (default 30 seconds)
3. **Clean up resources** when WebSocket connections close
4. **Use crypto.randomUUID()** for unique identifiers
5. **Validate inputs** early and return meaningful error messages
6. **Log important events** with prefixes like `[MCP]` for debugging
7. **Handle edge cases** like disconnected browsers, missing parameters
8. **Use Object spread** for merging headers/config: `{ ...defaultHeaders, ...headers }`

### Common Patterns
```javascript
// Route matching with regex
const mcpMatch = path.match(/^\/mcp\/([^\/]+)$/)
if (mcpMatch) {
  const userId = mcpMatch[1]
}

// Promise-based request handling
const responsePromise = new Promise((resolve, reject) => {
  const timeoutId = setTimeout(() => {
    this.pendingRequests.delete(requestId)
    reject(new Error('Request timeout'))
  }, this.timeout)
  
  this.pendingRequests.set(requestId, { resolve, reject, connectionId })
})

// Default values with fallbacks
const timeout = parseInt(env.DEFAULT_TIMEOUT || '30000')
const config = result || { name: 'Broxy MCP Server', version: '1.0.0' }
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_TIMEOUT` | `30000` | Browser request timeout in milliseconds |

## Additional Notes

- This project uses Cloudflare's free tier Durable Objects with SQLite storage
- No package.json required - uses `npx wrangler` directly
- Supports both REST API and MCP protocol for browser automation
- Chinese and English comments are both acceptable in this codebase
