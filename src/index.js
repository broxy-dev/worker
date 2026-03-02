// ===== Broxy - Worker主入口 =====
// 路由说明：
// POST /connect - WebSocket连接端点（浏览器脚本连接）
// GET/POST/PUT/DELETE /api/{userId}/* - API调用端点
// POST /mcp/{userId} - MCP JSON-RPC端点

export { BrowserConnection } from './durableObject.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // OPTIONS preflight for CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, mcp-protocol-version',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // WebSocket连接端点 - 浏览器脚本连接到这里
    if (path === '/connect') {
      const userId = url.searchParams.get('id');
      if (!userId) {
        return jsonResponse({ error: 'Missing userId parameter' }, 400);
      }
      return handleWebSocket(request, env, userId);
    }

    // MCP JSON-RPC端点 - MCP客户端连接到这里
    const mcpMatch = path.match(/^\/mcp\/([^\/]+)$/);
    if (mcpMatch) {
      const userId = mcpMatch[1];
      return handleMCPRequest(request, env, userId);
    }

    // API调用端点 - 外部调用到这里
    const apiMatch = path.match(/^\/api\/([^\/]+)(.*)$/);
    if (apiMatch) {
      const userId = apiMatch[1];
      const route = apiMatch[2] || '/';
      return handleApiCall(request, env, userId, route);
    }

    // 健康检查
    if (path === '/health') {
      return jsonResponse({
        status: 'ok',
        service: 'broxy',
        endpoints: {
          connect: '/connect?id={userId}',
          mcp: '/mcp/{userId}',
          api: '/api/{userId}/{route}'
        }
      });
    }

    return jsonResponse({ error: 'Not found' }, 404);
  }
};

// WebSocket连接处理
async function handleWebSocket(request, env, userId) {
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader !== 'websocket') {
    return jsonResponse({ error: 'Expected websocket' }, 400);
  }
  
  const id = env.BROWSER_CONNECTIONS.idFromName(userId);
  const durableObject = env.BROWSER_CONNECTIONS.get(id);
  
  return durableObject.fetch(request);
}

// API调用处理
async function handleApiCall(request, env, userId, route) {
  const id = env.BROWSER_CONNECTIONS.idFromName(userId);
  
  try {
    const durableObject = env.BROWSER_CONNECTIONS.get(id);
    
    // 构建请求体
    const body = await parseBody(request);
    const apiRequest = {
      method: request.method,
      path: route,
      query: Object.fromEntries(new URL(request.url).searchParams),
      headers: Object.fromEntries(request.headers),
      body: body
    };
    
    // 转发给浏览器执行
    const result = await durableObject.fetch(new Request('http://internal/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(apiRequest)
    }));
    
    const response = await result.json();
    
    if (response.error) {
      return jsonResponse({ 
        error: response.error, 
        userId,
        details: response.details 
      }, response.status || 500);
    }
    
    return jsonResponse(response.data);
    
  } catch (error) {
    if (error.message === 'Durable Object not found' || 
        error.message?.includes('not found')) {
      return jsonResponse({ 
        error: 'Browser not connected', 
        userId,
        hint: 'Browser script may not be running or userId is invalid'
      }, 404);
    }
    
    return jsonResponse({ 
      error: 'Request failed', 
      userId,
      details: error.message 
    }, 500);
  }
}

// 辅助函数
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

async function parseBody(request) {
  const contentType = request.headers.get('Content-Type') || '';
  
  if (contentType.includes('application/json')) {
    try {
      return await request.json();
    } catch {
      return null;
    }
  }
  
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text();
    return Object.fromEntries(new URLSearchParams(text));
  }
  
  return null;
}

// MCP JSON-RPC请求处理
async function handleMCPRequest(request, env, userId) {
  const id = env.BROWSER_CONNECTIONS.idFromName(userId);

  try {
    const durableObject = env.BROWSER_CONNECTIONS.get(id);

    const result = await durableObject.fetch(new Request('http://internal/mcp', {
      method: request.method,
      headers: request.headers,
      body: request.body
    }));

    return result;

  } catch (error) {
    if (error.message === 'Durable Object not found' ||
        error.message?.includes('not found')) {
      return mcpResponse({
        error: 'Browser not connected',
        userId,
        hint: 'Browser script may not be running or userId is invalid'
      }, 404);
    }

    return mcpResponse({
      error: 'MCP request failed',
      userId,
      details: error.message
    }, 500);
  }
}

// MCP响应构建函数 - 统一CORS
function mcpResponse(data, status = 200, headers = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, mcp-protocol-version',
    'Access-Control-Max-Age': '86400'
  };

  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...defaultHeaders, ...headers }
  });
}
