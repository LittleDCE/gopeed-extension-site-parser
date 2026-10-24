gopeed.events.onResolve(async function (ctx) {
  const pageUrl = ctx.req.url;
  let baseHostname = "";
  try { baseHostname = new URL(pageUrl).hostname; } catch(e) { return; }

  // 读取设置
  const useWebView = gopeed.settings.useWebView === true;
  const formatExts = (str) => (str || "").split(",").map(s => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean);
  const targetExts = formatExts(gopeed.settings.targetExts || "zip,rar,7z,pdf,mp4,mkv,apk,exe,iso");

  let text = "";
  
  // 1. 获取网页源码
  if (useWebView) {
    // 方案 A：用真实浏览器渲染（对抗防爬）
    try {
      const view = await gopeed.runtime.webview.open(pageUrl);
      text = await view.evaluate(() => document.documentElement.outerHTML);
      if (view.close) view.close();
    } catch (e) {
      throw new MessageError("WebView 加载失败：" + e.message);
    }
  } else {
    // 方案 B：普通请求
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

  // 2. 提取链接并匹配后缀
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
      
      // 限制同源（如果你需要跨站外链下载，可以把这行注释掉）
      if (absObj.hostname !== baseHostname) continue;

      const absPath = absObj.pathname;
      const absLastDot = absPath.lastIndexOf(".");
      const absExt = absLastDot !== -1 ? absPath.slice(absLastDot + 1).toLowerCase() : "";

      // 如果后缀匹配，加入列表
      if (targetExts.includes(absExt)) {
        if (!seen.has(abs)) {
          seen.add(abs);
          const segments = absPath.split("/");
          const name = decodeURIComponent(segments[segments.length - 1] || "file");
          files.push({ name: name, req: { url: abs } });
        }
      }
    } catch (e) {}
  }

  // 3. 返回结果
  if (files.length === 0) {
    throw new MessageError("在网页中未找到指定后缀的下载链接。");
  }

  // 只返回前 10 个，防止列表太长（通常直链下载网站只有几个核心文件）
  ctx.res = {
    name: baseHostname || "download-files",
    files: files.slice(0, 10) 
  };
});