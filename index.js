const PAGE_EXTS = ["html", "htm", "php", "asp", "aspx", "jsp", "do", "action"];

gopeed.events.onResolve(async function (ctx) {
  const entryUrl = ctx.req.url;
  const allowedHosts = parseHosts(gopeed.settings.allowedHosts); // 读取白名单
  const maxPages = Number(gopeed.settings.maxPages) || 100;
  const maxFiles = Number(gopeed.settings.maxFiles) || 500;
  const targetExts = parseExts(gopeed.settings.extensions);

  const fileSet = {};   // 用于文件去重
  const visitedPages = {}; // 用于页面去重
  const files = [];
  const queue = [{ url: entryUrl, depth: 0 }];
  let pageCount = 0;

  while (queue.length > 0 && pageCount < maxPages && files.length < maxFiles) {
    const { url: pageUrl } = queue.shift();
    if (visitedPages[pageUrl]) continue;
    visitedPages[pageUrl] = true;
    pageCount++;

    // 抓取页面 HTML（建议加上超时控制）
    let html;
    try {
      const resp = await fetch(pageUrl, {
        headers: { "User-Agent": gopeed.settings.userAgent || "Mozilla/5.0" },
        redirect: "follow",
      });
      if (!resp.ok) continue;
      html = await resp.text();
    } catch (e) {
      gopeed.logger.warn("抓取失败: " + pageUrl);
      continue;
    }

    // 提取链接
    const links = extractLinks(html);
    for (const link of links) {
      let abs;
      try { abs = new URL(link, pageUrl).href.split("#")[0]; } catch { continue; }
      const host = new URL(abs).hostname;
      const ext = getExtension(abs);

      // 1. 如果是目标文件，直接收集
      if (targetExts.includes(ext)) {
        if (!fileSet[abs]) {
          fileSet[abs] = true;
          files.push({ name: getFileName(abs), req: { url: abs } });
        }
      }
      // 2. 如果是同域名页面且域名在白名单内，加入队列递归
      else if (PAGE_EXTS.includes(ext) || ext === "") {
        if (allowedHosts.length > 0 && allowedHosts.includes(host)) {
          if (!visitedPages[abs]) queue.push({ url: abs, depth: queue.length });
        }
      }
    }
  }

  if (files.length === 0) return;
  ctx.res = { name: getHostname(entryUrl) || "site-files", files };
});

// 工具函数：解析白名单
function parseHosts(str) {
  if (!str) return [];
  return str.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}
// parseExts / extractLinks / getExtension / getFileName 等沿用之前的实现