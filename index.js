gopeed.events.onResolve(async function (ctx) {
  const pageUrl = ctx.req.url;
  let baseHostname = "";
  try { baseHostname = new URL(pageUrl).hostname; } catch(e) { return; }

  // 读取设置
  const useWebView = gopeed.settings.useWebView === true;
  const filterByExt = gopeed.settings.filterByExt !== false; // 默认开启过滤
  
  const formatExts = (str) => (str || "").split(",").map(s => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean);
  const targetExts = formatExts(gopeed.settings.targetExts || "zip,rar,7z,pdf,mp4,mkv,apk,exe,iso");

  let text = "";
  let useFallbackFetch = false;

  // 1. 环境检测：防止手机端不支持 webview 报错
  const hasWebView = typeof gopeed.runtime !== 'undefined' && gopeed.runtime.webview;

  // 2. 获取网页源码
  if (useWebView && hasWebView) {
    try {
      const view = await gopeed.runtime.webview.open(pageUrl);
      text = await view.evaluate(() => document.documentElement.outerHTML);
      if (view.close) view.close();
    } catch (e) {
      useFallbackFetch = true; // WebView 失败，静默降级
    }
  } else {
    useFallbackFetch = true; // 没开 WebView 或手机不支持，直接降级
  }

  // 3. 降级使用普通请求抓取
  if (useFallbackFetch) {
    try {
      const resp = await fetch(pageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" }
      });
      if (!resp.ok) throw new MessageError("HTTP " + resp.status);
      text = await resp.text();
    } catch (e) {
      throw new MessageError("请求失败：" + e.message);
    }
  }

  // 4. 提取链接并判断
  const files = [];
  const seen = new Set();
  const regex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    let link = match[1].trim();
    if (/^(javascript|mailto|tel|data|blob):/i.test(link) || link.charAt(0) === "#") continue;

    try {
      const abs = new URL(link, pageUrl).href.split("#")[0];
      const absObj = new URL(abs);
      
      // 限制同源（只抓当前域名下的，不抓跳到外站的）
      if (absObj.hostname !== baseHostname) continue;

      const absPath = absObj.pathname;
      const absLastDot = absPath.lastIndexOf(".");
      const absExt = absLastDot !== -1 ? absPath.slice(absLastDot + 1).toLowerCase() : "";

      let isMatch = false;

      if (filterByExt) {
        // 【模式一：开启过滤】只抓取你设置的后缀
        if (targetExts.includes(absExt)) {
          isMatch = true;
        }
      } else {
        // 【模式二：关闭过滤】遇到文件就下载（排除掉根目录、空链接、以及当前页面自身）
        if (abs !== pageUrl && absPath !== "/" && absExt !== "") {
          isMatch = true;
        }
      }

      if (isMatch) {
        if (!seen.has(abs)) {
          seen.add(abs);
          const segments = absPath.split("/");
          const name = decodeURIComponent(segments[segments.length - 1] || "file");
          files.push({ name: name, req: { url: abs } });
        }
      }
    } catch (e) {}
  }

  // 5. 返回结果
  if (files.length === 0) {
    throw new MessageError(filterByExt ? "未找到指定后缀的下载链接。" : "未找到任何同源文件。");
  }

  ctx.res = {
    name: baseHostname || "download-files",
    files: files.slice(0, 100) // 关闭过滤时可能会抓到很多，限制最多显示 100 个
  };
});