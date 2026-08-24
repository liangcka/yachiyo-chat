// Yachiyo Chat 大陆优选反代 Worker
// 路由（见 wrangler.jsonc）：yachiyochat.amtale.cn/* -> 原样反代到 Cloudflare Pages。
// 原理：Worker 路由承担「规则层」，DNS 灰云 CNAME 到优选域名承担「解析层」，
// 大陆访客解析到低延迟 CF 边缘 IP 后按 SNI 命中本 Worker。
const ORIGIN = "https://yachiyo-chat-brn.pages.dev";
const SITE_HOST = "yachiyochat.amtale.cn";
// APK 原生壳（Capacitor WebView）的固定 origin：须原样透传，
// 由 Pages 端 CORS 白名单（functions/_shared/http.ts）放行跨源请求
const APP_ORIGIN = "https://localhost";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.hostname !== SITE_HOST) {
      // 非 Yachiyo 主机名（防御分支，当前未挂该路由）：跳转到聊天站
      return Response.redirect(
        `https://${SITE_HOST}${url.pathname}${url.search}`,
        301,
      );
    }

    // 站点流量：路径/查询/方法/请求头/请求体全部保留，响应流式透传
    const proxyUrl = ORIGIN + url.pathname + url.search;
    const proxyRequest = new Request(proxyUrl, request);

    // Pages Functions 按请求 Origin 做来源校验（functions/_shared/http.ts）：
    // - 网页版（origin = yachiyochat.amtale.cn）：反代后主机已变为 pages.dev，
    //   需改写 Origin/Referer 维持同源校验，否则 /api/* 返回 403；
    // - APK 原生壳（origin = https://localhost）：原样透传，
    //   由 Pages 端 CORS 白名单放行（预检 + SameSite=None cookie）。
    if (
      proxyRequest.headers.has("origin") &&
      proxyRequest.headers.get("origin") !== APP_ORIGIN
    ) {
      proxyRequest.headers.set("origin", ORIGIN);
    }
    const referer = proxyRequest.headers.get("referer");
    if (referer !== null) {
      proxyRequest.headers.set(
        "referer",
        referer.replace(`https://${SITE_HOST}`, ORIGIN),
      );
    }

    return fetch(proxyRequest);
  },
};
