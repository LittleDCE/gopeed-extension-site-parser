gopeed.events.onResolve(async function (ctx) {
  const entryUrl = ctx.req.url;
  const baseHostname = new URL(entryUrl).hostname;
  
  // 读取设置
  const maxParseDepth = gopeed.settings.maxParseDepth !== undefined ? Number(gopeed.settings.maxParseDepth) : 2;
  const maxRequests = gopeed.settings.maxRequests !== undefined ? Number(gopeed.settings.maxRequests) : 200;
  const parseNested = gopeed.settings.parseNested === true;

  // 需要下载的文件后缀（覆盖主流所有资源）
  const targetExts = [
    "html", "htm", "xhtml", "shtml", "php", "asp", "aspx", "jsp", "do", "action", // 页面
    "png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", // 图片
    "js", "mjs", "cjs", "vue", "jsx", "ts", "tsx", // 脚本
    "css", "scss", "less", // 样式
    "json", "xml", "txt", "pdf", "zip", "rar", "7z", "tar", "gz", // 数据/压缩包
    "mp4", "mkv", "webm", "mp3", "wav", "flac", // 媒体
    "woff", "woff2", "ttf", "eot", "otf" // 字体
  ];

  // 允许读取内容进行二次解析的文本后缀
  const parsableExts = ["css", "js", "mjs", "cjs", "json", "vue", "jsx", "ts", "tsx", "xml", "svg"];
  
  // 被视作网页（按 href/src 提取）的后缀
  const pageExts = ["html", "htm", "xhtml", "shtml", "php", "asp", "aspx", "jsp", "do", "action"];

  const files = [];
  const seenFiles = new Set();
  const visitedNodes = new Set(); 
  
  const queue = [{ url: entryUrl, depth: 0 }]; 
  let requestCount = 0;

  while (queue.length > 0 && requestCount < maxRequests) {
    const current = queue.shift();
    const currentUrl = current.url;
    const depth = current.depth;

    if (visitedNodes.has(currentUrl)) continue;
    visitedNodes.add(currentUrl);
    requestCount++;

    try {
      const pathname = new URL(currentUrl).pathname;
      const lastDot = pathname.lastIndexOf(".");
      const ext = lastDot !== -1 ? pathname.slice(lastDot + 1).toLowerCase() : "";
      
      const isPage = pageExts.includes(ext) || ext === "";
      const isParsable = parsableExts.includes(ext);

      // 如果是页面或可解析文本，且未超深度限制，发起请求读取内容
      if ((isPage || isParsable) && (depth < maxParseDepth || isPage)) {
        
        const resp = await fetch(currentUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
        });

        if (!resp.ok) continue;
        
        let text = await resp.text();
        if ((ext === "js" || ext === "vue") && text.length > 300000) {
          text = text.substring(0, 300000); // 防大文件卡死
        }

        // 智能匹配正则
        let regex;
        if (isPage || ext === "xml" || ext === "svg") {
          // 网页、XML、SVG 使用 href 和 src 标签匹配
          regex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
        } else if (ext === "css" || ext === "scss" || ext === "less") {
          // 样式文件使用 url() 匹配
          regex = /url\s*\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi;
        } else if (["js", "json", "vue", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext)) {
          // 代码文件使用保守的字符串路径匹配
          regex = /["'`]([^"'`]+\.(?:png|jpg|jpeg|gif|svg|webp|css|js|json|mp4|mp3|woff2?|ttf))["'`]/gi;
        }

        if (!regex) continue;

        let match;
        while ((match = regex.exec(text)) !== null) {
          let link = match[1].trim();
          if (/^(javascript|mailto|tel|data|blob):/i.test(link) || link.charAt(0) === "#") continue;

          try {
            const abs = new URL(link, currentUrl).href.split("#")[0];
            const absObj = new URL(abs);
            
            if (absObj.hostname !== baseHostname) continue; // 同源限制

            const absPath = absObj.pathname;
            const absLastDot = absPath.lastIndexOf(".");
            const absExt = absLastDot !== -1 ? absPath.slice(absLastDot + 1).toLowerCase() : "";
            const segments = absPath.split("/");
            const name = decodeURIComponent(segments[segments.length - 1] || "file");

            // 添加到下载列表
            if (targetExts.includes(absExt) || absExt === "") {
              if (!seenFiles.has(abs)) {
                seenFiles.add(abs);
                files.push({ name: name, req: { url: abs } });
              }
            }

            // 决定是否将其推入队列继续解析
            const isSubPage = pageExts.includes(absExt) || absExt === "";
            const isParsableAsset = parsableExts.includes(absExt);

            if (parseNested) {
              if ((isSubPage || isParsableAsset) && depth < maxParseDepth) {
                // 子页面或者文件里的引用，深度+1
                queue.push({ url: abs, depth: depth + 1 });
              }
            } else if (isSubPage && depth === 0) {
              queue.push({ url: abs, depth: depth + 1 });
            }

          } catch (e) {}
        }
      } else {
        // 如果是不解析的二进制文件，直接加入下载
        const segments = pathname.split("/");
        const name = decodeURIComponent(segments[segments.length - 1] || "file");
        if (!seenFiles.has(currentUrl)) {
           seenFiles.add(currentUrl);
           files.push({ name: name, req: { url: currentUrl } });
        }
      }
    } catch (err) {
      continue; 
    }
  }

  if (files.length === 0) {
    throw new MessageError("未找到匹配的静态文件，或目标网站存在反爬拦截。");
  }

  ctx.res = {
    name: baseHostname || "site-files",
    files: files.slice(0, 1000) 
  };
});