import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

interface McpClientOptions {
  id: string;
  transport?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

export class McpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, PendingRequest>();
  private stderr = '';
  private started = false;

  constructor(private readonly opts: McpClientOptions) {}

  async start(): Promise<void> {
    if ((this.opts.transport ?? 'stdio') === 'http') {
      this.started = true;
      return;
    }
    if (this.started && this.child) return;
    if (!this.opts.command?.trim()) throw new Error(`MCP server ${this.opts.id} 未配置命令`);

    this.child = spawn(this.opts.command, this.opts.args ?? [], {
      cwd: this.opts.cwd || undefined,
      windowsHide: true,
      shell: false
    });
    this.started = true;

    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString('utf8')).slice(-8000);
    });
    this.child.on('error', (err) => this.rejectAll(err));
    this.child.on('exit', (code, signal) => {
      const suffix = this.stderr ? ` stderr=${this.stderr.slice(-1000)}` : '';
      this.rejectAll(new Error(`MCP server ${this.opts.id} 已退出 code=${code} signal=${signal}.${suffix}`));
      this.started = false;
      this.child = null;
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'reader-pet', version: '0.1.0' }
    });
    this.notify('notifications/initialized', {});
  }

  isRunning(): boolean {
    if ((this.opts.transport ?? 'stdio') === 'http') return this.started;
    return this.started && !!this.child && !this.child.killed;
  }

  async listTools(): Promise<any[]> {
    await this.start();
    const result = await this.request('tools/list', {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.start();
    return this.request('tools/call', { name, arguments: args ?? {} });
  }

  async listResources(): Promise<any[]> {
    await this.start();
    const result = await this.request('resources/list', {});
    return Array.isArray(result?.resources) ? result.resources : [];
  }

  async readResource(uri: string): Promise<unknown> {
    await this.start();
    return this.request('resources/read', { uri });
  }

  async listPrompts(): Promise<any[]> {
    await this.start();
    const result = await this.request('prompts/list', {});
    return Array.isArray(result?.prompts) ? result.prompts : [];
  }

  async getPrompt(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.start();
    return this.request('prompts/get', { name, arguments: args ?? {} });
  }

  async stop(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`MCP server ${this.opts.id} 已被紧急停止`));
    }
    this.pending.clear();
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.started = false;
  }

  private request(method: string, params: any): Promise<any> {
    if ((this.opts.transport ?? 'stdio') === 'http') return this.httpRequest(method, params);
    if (!this.child) throw new Error(`MCP server ${this.opts.id} 未启动`);
    const id = this.nextId++;
    const timeoutMs = Math.max(1000, Math.min(this.opts.timeoutMs ?? 30_000, 120_000));
    const payload = { jsonrpc: '2.0', id, method, params };
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const frame = Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'), body]);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(frame, (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  private async httpRequest(method: string, params: any): Promise<any> {
    if (!this.opts.url?.trim()) throw new Error(`MCP HTTP server ${this.opts.id} 未配置 URL`);
    const id = this.nextId++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Math.min(this.opts.timeoutMs ?? 30_000, 120_000)));
    try {
      const res = await fetch(this.opts.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(this.opts.headers ?? {})
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`MCP HTTP ${method} failed: ${res.status} ${res.statusText}`);
      const text = await res.text();
      const jsonText = text.split('\n').find((line) => line.trim().startsWith('{')) ?? text;
      const msg = JSON.parse(jsonText.replace(/^data:\s*/, ''));
      if (msg.error) throw new Error(msg.error.message ?? JSON.stringify(msg.error));
      return msg.result;
    } finally {
      clearTimeout(timeout);
    }
  }

  private notify(method: string, params: any): void {
    if (!this.child) return;
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method, params }), 'utf8');
    this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'), body]));
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString('utf8');
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const frameEnd = headerEnd + 4 + length;
      if (this.buffer.length < frameEnd) return;
      const body = this.buffer.slice(headerEnd + 4, frameEnd).toString('utf8');
      this.buffer = this.buffer.slice(frameEnd);
      this.onMessage(body);
    }
  }

  private onMessage(body: string): void {
    let msg: any;
    try {
      msg = JSON.parse(body);
    } catch {
      return;
    }
    if (typeof msg.id !== 'number') return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
    else pending.resolve(msg.result);
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
