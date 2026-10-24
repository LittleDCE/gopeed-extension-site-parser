gopeed.events.onResolve(async function (ctx) {
  const entryUrl = ctx.req.url;
  const baseHostname = new URL(entryUrl).hostname;
  
  // 读取设置
  const maxDepth = gopeed.settings.maxDepth !== undefined ? Number(gopeed.settings.maxDepth) : 1;
  const maxPages = gopeed.settings.maxPages !== undefined ? Number(gopeed.settings.maxPages) : 100;
  const parseNested = gopeed.settings.parseNested === true; // 深度解析开关

  // 允许下载的文件后缀
  const targetExts = ["html", "htm", "php", "png", "jpg", "jpeg", "gif", "svg", "webp", "js", "css", "json", "xml", "pdf", "zip", "rar", "7z", "txt", "mp4", "mp3", "woff", "woff2", "ttf"];

  const files = [];
  const seenFiles = new Set();
  const visitedNodes = new Set(); // 去重（页面和文件共享）
  
  // 队列结构扩展：加入 type 区分是页面还是资源文件
  const queue = [{ url: entryUrl, depth: 0, type: "html" }]; 
  let pageCount = 0;

  while (queue.length > 0 && pageCount < maxPages) {
    const current = queue.shift();
    const currentUrl = current.url;
    const depth = current.depth;

    if (visitedNodes.has(currentUrl)) continue;
    visitedNodes.add(currentUrl);
    pageCount++;

    try {
      const resp = await fetch(currentUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      });

      if (!resp.ok) continue;
      
      let text = await resp.text();
      // 如果是 JS 且文件太大，截断防止内存溢出卡死
      if (current.type === "js" && text.length > 200000) {
          text = text.substring(0, 200000);
      }

      // 针对不同类型，使用不同的正则提取
      let regex;
      if (current.type === "html") {
        regex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
      } else if (current.type === "css") {
        regex = /url\s*\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi;
      } else if (current.type === "js") {
        // JS 极度危险，只匹配带有明确定义后缀的字符串
        regex = /["']([^"']+\.(?:png|jpg|jpeg|gif|svg|webp|css|js|json|mp4|mp3|woff2?|ttf))["']/gi;
      }

      let match;
      while ((match = regex.exec(text)) !== null) {
        let link = match[1].trim();
        if (/^(javascript|mailto|tel|data|blob):/i.test(link) || link.charAt(0) === "#") continue;

        try {
          // 基于当前文件的 URL 解析相对路径
          const abs = new URL(link, currentUrl).href.split("#")[0];
          const absObj = new URL(abs);
          
          // 同源限制
          if (absObj.hostname !== baseHostname) continue;

          const pathname = absObj.pathname;
          const lastDot = pathname.lastIndexOf(".");
          const ext = lastDot !== -1 ? pathname.slice(lastDot + 1).toLowerCase() : "";
          const segments = pathname.split("/");
          const name = decodeURIComponent(segments[segments.length - 1] || "file");

          // 1. 如果是目标文件，加入下载列表
          if (targetExts.includes(ext)) {
            if (!seenFiles.has(abs)) {
              seenFiles.add(abs);
              files.push({ name: name, req: { url: abs } });
              
              // 2. 深度解析：如果是 CSS/JS 且开启了开关，丢进队列进行二次审查
              if (parseNested && (ext === "css" || ext === "js")) {
                  queue.push({ url: abs, depth: depth, type: ext }); // 内部引用的深度不增加
              }
            }
          } 
          // 3. 如果是 HTML 页面，根据深度限制决定是否排队
          else if (["html", "htm", "php", "asp", "aspx", "jsp"].includes(ext) || ext === "") {
            if (depth < maxDepth) {
              queue.push({ url: abs, depth: depth + 1, type: "html" });
            }
          }
        } catch (e) {}
      }
    } catch (err) {
      continue; 
    }
  }

  if (files.length === 0) {
    throw new MessageError("未找到匹配的静态文件。");
  }

  ctx.res = {
    name: baseHostname || "site-files",
    files: files.slice(0, 1000)
  };
});