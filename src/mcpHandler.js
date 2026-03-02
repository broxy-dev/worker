// ===== MCP 协议处理器 =====
// 实现 Model Context Protocol (MCP) JSON-RPC 2.0 协议

export class MCPHandler {
  constructor() {
    this.sessions = new Map(); // session_id -> { controller, webId, createdAt }
    this.sessionTimeout = 5 * 60 * 1000; // 5分钟超时
  }

  // 处理传入的JSON-RPC消息
  handleMessage(message) {
    try {
      const parsed = JSON.parse(message);
      
      if (!parsed.jsonrpc || parsed.jsonrpc !== '2.0') {
        return {
          jsonrpc: '2.0',
          id: parsed.id,
          error: {
            code: -32600,
            message: 'Invalid JSON-RPC version'
          }
        };
      }

      const { method, params = {}, id } = parsed;

      switch (method) {
        case 'initialize':
          return this.handleInitialize(params, id);
        
        case 'tools/list':
          return this.handleToolsList(id);
        
        case 'tools/call':
          return this.handleToolsCall(params, id);
        
        case 'ping':
          return {
            jsonrpc: '2.0',
            id,
            result: {}
          };
        
        case 'notifications/initialized':
          return null;
        
        default:
          if (method.startsWith('notifications/')) {
            return null;
          }
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`
            }
          };
      }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
          data: error.message
        }
      };
    }
  }

  // 生成工具列表响应
  generateToolsList(tools) {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema || {
        type: 'object',
        properties: {},
        required: []
      }
    }));
  }

  // 创建工具调用成功响应
  createToolResponse(id, result) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          }
        ]
      }
    };
  }

  // 创建错误响应
  createErrorResponse(id, code, message, data = null) {
    const error = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    };
    
    if (data) {
      error.error.data = data;
    }
    
    return error;
  }

  // 处理初始化请求
  handleInitialize(params, id, config = {}) {
    const { protocolVersion, capabilities, clientInfo } = params;
    
    if (!protocolVersion) {
      return this.createErrorResponse(id, -32602, 'Missing protocolVersion parameter');
    }

    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {}
        },
        serverInfo: {
          name: config.name || 'Broxy MCP Server',
          version: config.version || '1.0.0'
        }
      }
    };
  }

  // 检查会话是否过期
  isSessionExpired(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return true;
    }
    
    const age = Date.now() - session.createdAt;
    return age > this.sessionTimeout;
  }

  // 清理过期会话
  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.sessionTimeout) {
        try {
          session.controller.close();
        } catch (e) {
          // 忽略关闭错误
        }
        this.sessions.delete(sessionId);
      }
    }
  }
}

// SSE 事件格式化
export function formatSSEMessage(eventType, eventId, data) {
  let message = `event: ${eventType}\n`;
  
  if (eventId) {
    message += `id: ${eventId}\n`;
  }
  
  message += `data: ${JSON.stringify(data)}\n\n`;
  return message;
}

// 创建初始化 priming 事件
export function createPrimingEvent(sessionId, retryInterval) {
  let event = `id: ${sessionId}\ndata: \n\n`;
  
  if (retryInterval) {
    event = `id: ${sessionId}\nretry: ${retryInterval}\ndata: \n\n`;
  }
  
  return event;
}
