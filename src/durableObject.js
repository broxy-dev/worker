// ===== Durable Object - 浏览器连接管理 =====

import { MCPHandler } from './mcpHandler.js';

export class BrowserConnection {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Map(); // 存储WebSocket连接
    this.pendingRequests = new Map(); // 存储待处理的HTTP请求
    this.timeout = parseInt(env.DEFAULT_TIMEOUT || '30000');
    this.mcpHandler = new MCPHandler(); // MCP协议处理器
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket升级请求
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    // 内部API执行请求
    if (url.pathname === '/execute') {
      return this.handleExecute(request);
    }

    // MCP POST请求处理
    if (url.pathname === '/mcp') {
      return this.handleMCPRequest(request);
    }

    return mcpResponse({ error: 'Not found' }, 404);
  }

  // 处理WebSocket连接（浏览器脚本连接）
  async handleWebSocket(request) {
    const [client, server] = Object.values(new WebSocketPair());
    
    server.accept();
    
    const connectionId = crypto.randomUUID();
    this.connections.set(connectionId, server);
    
    // 发送连接成功消息
    server.send(JSON.stringify({
      type: 'connected',
      connectionId,
      message: 'Browser bridge connected successfully'
    }));
    
    // 处理浏览器返回的消息
    server.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'response' && data.requestId) {
          // 这是浏览器对API请求的响应
          const pending = this.pendingRequests.get(data.requestId);
          if (pending) {
            pending.resolve(data.result);
            this.pendingRequests.delete(data.requestId);
          }
        }
      } catch (error) {
        console.error('Failed to parse browser message:', error);
      }
    });
    
    // 处理连接关闭
    server.addEventListener('close', () => {
      this.connections.delete(connectionId);
      
      // 清理所有待处理请求
      for (const [requestId, pending] of this.pendingRequests) {
        if (pending.connectionId === connectionId) {
          pending.reject(new Error('Browser disconnected'));
          this.pendingRequests.delete(requestId);
        }
      }
    });
    
    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  // 处理API执行请求
  async handleExecute(request) {
    const apiRequest = await request.json();
    const requestId = crypto.randomUUID();
    
    // 检查是否有浏览器连接
    if (this.connections.size === 0) {
      return jsonResponse({
        error: 'No browser connected',
        details: 'No active browser script connection found'
      }, 503);
    }
    
    // 获取第一个可用的连接
    const [connectionId, ws] = this.connections.entries().next().value;
    
    // 创建Promise等待浏览器响应
    const responsePromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, this.timeout);
      
      this.pendingRequests.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
        connectionId
      });
    });
    
    // 发送请求到浏览器
    ws.send(JSON.stringify({
      type: 'request',
      requestId,
      data: apiRequest
    }));
    
    try {
      const result = await responsePromise;
      return jsonResponse({ data: result });
    } catch (error) {
      if (error.message === 'Request timeout') {
        return jsonResponse({
          error: 'timeout',
          userId: this.state.id?.name,
          details: `Browser did not respond within ${this.timeout}ms`
        }, 504);
      }
      
      return jsonResponse({
        error: 'Request failed',
        details: error.message
      }, 500);
    }
  }

  // 处理MCP JSON-RPC请求
  async handleMCPRequest(request) {
    try {
      const message = await request.json();
      const authHeader = request.headers.get('Authorization') || '';

      const { method, params, id } = message;

      if (method.startsWith('notifications/')) {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Last-Event-ID, mcp-protocol-version',
            'Access-Control-Max-Age': '86400'
          }
        });
      }

      let responseData;

      switch (method) {
        case 'tools/list':
          if (this.connections.size === 0) {
            responseData = this.mcpHandler.createErrorResponse(
              id,
              -32000,
              'No browser connected'
            );
          } else {
            const toolsResult = await this.getBrowserTools(authHeader);
            console.log('[MCP] Tools result from browser:', JSON.stringify(toolsResult));
            
            if (!toolsResult || !toolsResult.tools || !Array.isArray(toolsResult.tools)) {
              console.error('[MCP] Invalid tools result:', toolsResult);
              responseData = this.mcpHandler.createErrorResponse(
                id,
                -32001,
                'Invalid tools response from browser',
                JSON.stringify(toolsResult)
              );
            } else {
              responseData = {
                jsonrpc: '2.0',
                id,
                result: {
                  tools: this.mcpHandler.generateToolsList(toolsResult.tools)
                }
              };
            }
          }
          break;

        case 'tools/call':
          if (this.connections.size === 0) {
            responseData = this.mcpHandler.createErrorResponse(
              id,
              -32000,
              'No browser connected'
            );
          } else {
            const toolResult = await this.executeBrowserTool(params.name, params.arguments, authHeader);
            responseData = this.mcpHandler.createToolResponse(id, toolResult);
          }
          break;

        case 'initialize':
          const mcpConfig = await this.getBrowserMCPConfig(authHeader);
          responseData = this.mcpHandler.handleInitialize(params, id, mcpConfig);
          break;

        case 'ping':
          responseData = {
            jsonrpc: '2.0',
            id,
            result: {}
          };
          break;

        default:
          responseData = this.mcpHandler.handleMessage(JSON.stringify(message));
      }

      if (responseData === null) {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Last-Event-ID, mcp-protocol-version',
            'Access-Control-Max-Age': '86400'
          }
        });
      }

      return mcpResponse(responseData, 200);
    } catch (error) {
      const response = this.mcpHandler.createErrorResponse(
        null,
        -32700,
        'Parse error',
        error.message
      );
      return mcpResponse(response, 400);
    }
  }

  // 从浏览器获取工具列表
  async getBrowserTools(authHeader = '') {
    const [connectionId, ws] = this.connections.entries().next().value;
    const requestId = crypto.randomUUID();
    
    console.log('[MCP] Requesting tools list from browser, requestId:', requestId);
    
    const resultPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, this.timeout);
      
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        connectionId
      });
    });
    
    // 发送获取工具列表请求
    ws.send(JSON.stringify({
      type: 'request',
      requestId,
      data: {
        method: 'GET',
        path: '/mcp/tools/list',
        headers: authHeader ? { Authorization: authHeader } : {}
      }
    }));
    
    try {
      const result = await resultPromise;
      console.log('[MCP] Received tools list result:', JSON.stringify(result));
      
      // 检查响应是否包含 tools 数组
      if (!result || typeof result !== 'object') {
        console.error('[MCP] Invalid result type:', typeof result);
        throw new Error('Invalid response from browser: result is not an object');
      }
      
      if (!result.tools) {
        console.error('[MCP] Result does not have tools property:', result);
        throw new Error('Invalid response from browser: missing tools property');
      }
      
      if (!Array.isArray(result.tools)) {
        console.error('[MCP] Tools is not an array:', typeof result.tools);
        throw new Error('Invalid response from browser: tools is not an array');
      }
      
      return result;
    } catch (error) {
      console.error('[MCP] Failed to get tools list:', error);
      throw error;
    }
  }

  // 从浏览器获取 MCP 配置
  async getBrowserMCPConfig(authHeader = '') {
    if (this.connections.size === 0) {
      return { name: 'Broxy MCP Server', version: '1.0.0' };
    }

    const [connectionId, ws] = this.connections.entries().next().value;
    const requestId = crypto.randomUUID();

    console.log('[MCP] Requesting MCP config from browser, requestId:', requestId);

    const resultPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({ name: 'Broxy MCP Server', version: '1.0.0' });
      }, 5000);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        connectionId
      });
    });

    ws.send(JSON.stringify({
      type: 'request',
      requestId,
      data: {
        method: 'GET',
        path: '/mcp/config',
        headers: authHeader ? { Authorization: authHeader } : {}
      }
    }));

    try {
      const result = await resultPromise;
      console.log('[MCP] Received MCP config:', JSON.stringify(result));
      return result || { name: 'Browser Bridge MCP Server', version: '1.0.0' };
    } catch (error) {
      console.error('[MCP] Failed to get MCP config, using defaults:', error);
      return { name: 'Broxy MCP Server', version: '1.0.0' };
    }
  }

  // 执行浏览器工具
  async executeBrowserTool(toolName, args = {}, authHeader = '') {
    const [connectionId, ws] = this.connections.entries().next().value;
    const requestId = crypto.randomUUID();
    
    const resultPromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, this.timeout);
      
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        connectionId
      });
    });
    
    // 发送工具执行请求
    ws.send(JSON.stringify({
      type: 'request',
      requestId,
      data: {
        method: 'POST',
        path: '/mcp/' + toolName,
        body: args,
        headers: authHeader ? { Authorization: authHeader } : {}
      }
    }));
    
    try {
      const result = await resultPromise;
      return result;
    } catch (error) {
      throw error;
    }
  }
}

// API响应构建函数 - 统一CORS
function jsonResponse(data, status = 200, headers = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...defaultHeaders, ...headers }
  });
}

// MCP响应构建函数 - 统一CORS
function mcpResponse(data, status = 200, headers = {}) {
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Last-Event-ID, mcp-protocol-version',
    'Access-Control-Max-Age': '86400'
  };
  
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...defaultHeaders, ...headers }
  });
}
