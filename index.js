gopeed.events.onResolve(async function (ctx) {
  const entryUrl = ctx.req.url;
  const baseHostname = new URL(entryUrl).hostname; // 获取主域名，防止爬到外站去
  
  // 读取用户配置的深度，默认 1
  const maxDepth = gopeed.settings.maxDepth !== undefined ? Number(gopeed.settings.maxDepth) : 1;
  const maxPages = gopeed.settings.maxPages !== undefined ? Number(gopeed.settings.maxPages) : 100;
  
  // 允许下载的文件后缀
  const targetExts = ["html", "htm", "php", "png", "jpg", "jpeg", "gif", "svg", "webp", "js", "css", "json", "xml", "pdf", "zip", "rar", "7z", "txt"];

  const files = [];
  const seenFiles = new Set(); // 文件去重
  const visitedPages = new Set(); // 页面去重
  const queue = [{ url: entryUrl, depth: 0 }]; // 爬取队列
  
  let pageCount = 0;

  // 开始广度优先爬取
  while (queue.length > 0 && pageCount < maxPages) {
    const current = queue.shift();
    const pageUrl = current.url;
    const depth = current.depth;

    if (visitedPages.has(pageUrl)) continue;
    visitedPages.add(pageUrl);
    pageCount++;

    try {
      const resp = await fetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });

      if (!resp.ok) continue;
      const html = await resp.text();

      const regex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
      let match;

      while ((match = regex.exec(html)) !== null) {
        let link = match[1].trim();
        if (/^(javascript|mailto|tel|data|blob):/i.test(link) || link.charAt(0) === "#") continue;

        try {
          const abs = new URL(link, pageUrl).href.split("#")[0];
          const absObj = new URL(abs);
          
          // 同源限制：绝对不能爬出当前网站
          if (absObj.hostname !== baseHostname) continue;

          const pathname = absObj.pathname;
          const lastDot = pathname.lastIndexOf(".");
          const ext = lastDot !== -1 ? pathname.slice(lastDot + 1).toLowerCase() : "";
          const segments = pathname.split("/");
          const name = decodeURIComponent(segments[segments.length - 1] || "file");

          // 1. 如果是我们需要的目标文件，直接收集
          if (targetExts.includes(ext)) {
            if (!seenFiles.has(abs)) {
              seenFiles.add(abs);
              files.push({
                name: name,
                req: { url: abs }
              });
            }
          } 
          // 2. 如果是 HTML/PHP 或者是无后缀的路径（如 /about），视为子页面
          else if (["html", "htm", "php", "asp", "aspx", "jsp"].includes(ext) || ext === "") {
            // 只有在深度未超过限制时，才加入队列
            if (depth < maxDepth) {
              queue.push({ url: abs, depth: depth + 1 });
            }
          }
        } catch (e) {}
      }
    } catch (err) {
      // 单个页面抓取失败不影响整体，继续下一个
      continue; 
    }
  }

  if (files.length === 0) {
    throw new MessageError("未找到匹配的静态文件，请检查网页是否为空或是否为动态渲染。");
  }

  // 返回最终结果
  ctx.res = {
    name: baseHostname || "site-files",
    files: files.slice(0, 1000) // 最终列表最多返回 1000 个文件防卡顿
  };
});