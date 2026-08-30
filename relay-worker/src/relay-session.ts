import { DurableObject } from "cloudflare:workers";

interface HttpRequestMessage {
  type: "http_request";
  requestId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

interface HttpResponseStartMessage {
  type: "http_response_start";
  requestId: string;
  status: number;
  headers: Record<string, string>;
}

interface HttpResponseChunkMessage {
  type: "http_response_chunk";
  requestId: string;
  data: string;
}

interface HttpResponseEndMessage {
  type: "http_response_end";
  requestId: string;
}

type DesktopMessage =
  | HttpResponseStartMessage
  | HttpResponseChunkMessage
  | HttpResponseEndMessage
  | { type: "pong" };

interface PendingRequest {
  resolveResponse: (res: Response) => void;
  controller?: ReadableStreamDefaultController<Uint8Array>;
}

export class RelaySession extends DurableObject {
  private desktopWs: WebSocket | null = null;
  private deviceKey: string | null = null;
  private pendingRequests = new Map<string, PendingRequest>();

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket endpoint for Desktop application connection
    if (url.pathname === "/ws/connect") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      const deviceKeyHeader = request.headers.get("x-device-key");
      if (!deviceKeyHeader) {
        return new Response("Missing x-device-key header", { status: 401 });
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.desktopWs = server;
      this.deviceKey = deviceKeyHeader;

      server.accept();
      server.addEventListener("message", (event) => {
        try {
          const msg = JSON.parse(event.data as string) as DesktopMessage;
          this.handleDesktopMessage(msg);
        } catch {
          // ignore malformed message
        }
      });

      server.addEventListener("close", () => {
        this.desktopWs = null;
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // Handle forwarded requests from mobile browser
    const token =
      url.searchParams.get("token") ||
      request.headers.get("x-relay-token") ||
      this.getTokenFromCookie(request.headers.get("Cookie"));

    if (!token || token !== this.deviceKey) {
      return new Response(this.renderUnauthorizedPage(), {
        status: 401,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!this.desktopWs) {
      return new Response(this.renderOfflinePage(), {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const requestId = crypto.randomUUID();
    const headersRecord: Record<string, string> = {};
    request.headers.forEach((val, key) => {
      if (!key.startsWith("cf-") && key !== "host") {
        headersRecord[key] = val;
      }
    });

    const bodyText = request.body ? await request.text() : undefined;

    const forwardMessage: HttpRequestMessage = {
      type: "http_request",
      requestId,
      method: request.method,
      url: url.pathname + url.search,
      headers: headersRecord,
      body: bodyText,
    };

    return new Promise<Response>((resolve) => {
      this.pendingRequests.set(requestId, {
        resolveResponse: resolve,
      });

      this.desktopWs?.send(JSON.stringify(forwardMessage));
    });
  }

  private handleDesktopMessage(msg: DesktopMessage) {
    if (msg.type === "http_response_start") {
      const pending = this.pendingRequests.get(msg.requestId);
      if (!pending) return;

      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          pending.controller = controller;
        },
      });

      const responseHeaders = new Headers(msg.headers);
      if (this.deviceKey) {
        responseHeaders.append(
          "Set-Cookie",
          `yachiyo_relay_token=${this.deviceKey}; Path=/; SameSite=Lax; HttpOnly; Max-Age=2592000`,
        );
      }

      const res = new Response(stream, {
        status: msg.status,
        headers: responseHeaders,
      });

      pending.resolveResponse(res);
    } else if (msg.type === "http_response_chunk") {
      const pending = this.pendingRequests.get(msg.requestId);
      if (pending?.controller) {
        const encoder = new TextEncoder();
        pending.controller.enqueue(encoder.encode(msg.data));
      }
    } else if (msg.type === "http_response_end") {
      const pending = this.pendingRequests.get(msg.requestId);
      if (pending?.controller) {
        try {
          pending.controller.close();
        } catch {
          // ignore if already closed
        }
      }
      this.pendingRequests.delete(msg.requestId);
    }
  }

  private getTokenFromCookie(cookieHeader: string | null): string | null {
    if (!cookieHeader) return null;
    const match = /(?:^|;\s*)yachiyo_relay_token=([^;]+)/.exec(cookieHeader);
    return match ? decodeURIComponent(match[1]) : null;
  }

  private renderUnauthorizedPage(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Yachiyo Desktop 中继配对</title>
  <style>
    body { background: #07102d; color: #e2ebff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .box { background: rgba(18,36,80,0.7); border: 1px solid rgba(140,180,255,0.25); border-radius: 1.2rem; padding: 2rem; max-width: 360px; text-align: center; }
    h1 { font-size: 1.2rem; color: #a8cdff; margin-bottom: 0.8rem; }
    p { font-size: 0.9rem; color: #b8ccf0; line-height: 1.5; }
    input { width: 100%; box-sizing: border-box; padding: 0.6rem; margin: 1rem 0; border-radius: 0.6rem; border: 1px solid #4a75c0; background: #0b183d; color: #fff; text-align: center; font-family: monospace; }
    button { width: 100%; padding: 0.65rem; border-radius: 0.6rem; border: none; background: #2c68d4; color: #fff; font-weight: bold; cursor: pointer; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Yachiyo 远程配对</h1>
    <p>请输入电脑端 Yachiyo Desktop 设置面板中的配对 Token 或使用手机扫描电脑端二维码：</p>
    <form method="GET">
      <input type="text" name="token" placeholder="输入配对 Token" required />
      <button type="submit">连接电脑端</button>
    </form>
  </div>
</body>
</html>`;
  }

  private renderOfflinePage(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>电脑端离线 - Yachiyo Chat</title>
  <style>
    body { background: #07102d; color: #e2ebff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .box { background: rgba(18,36,80,0.7); border: 1px solid rgba(140,180,255,0.25); border-radius: 1.2rem; padding: 2rem; max-width: 380px; text-align: center; }
    h1 { font-size: 1.2rem; color: #ffd666; margin-bottom: 0.8rem; }
    p { font-size: 0.9rem; color: #b8ccf0; line-height: 1.5; }
    a.btn { display: inline-block; margin-top: 1.2rem; padding: 0.6rem 1.2rem; border-radius: 0.6rem; background: #2c68d4; color: #fff; text-decoration: none; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="box">
    <h1>电脑端暂未在线</h1>
    <p>您的电脑端 Yachiyo Desktop 当前未启动或已断开网络连接。</p>
    <p>请在电脑上打开 Yachiyo Desktop 应用后刷新本页面；或返回 Cloudflare 官方手机独立版：</p>
    <a href="https://yachiyochat.amtale.cn" class="btn">打开手机独立版</a>
  </div>
</body>
</html>`;
  }
}
