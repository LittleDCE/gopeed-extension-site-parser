gopeed.events.onResolve(async function (ctx) {
  const entryUrl = ctx.req.url;
  const baseHostname = new URL(entryUrl).hostname;
  
  // 读取设置与后缀格式化
  const maxParseDepth = Number(gopeed.settings.maxParseDepth) || 2;
  const maxRequests = Number(gopeed.settings.maxRequests) || 100;
  const parseNested = gopeed.settings.parseNested === true;
  
  // 解析用户自定义的后缀 (去除空格和点)
  const formatExts = (str) => (str || "").split(",").map(s => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean);
  
  const pageExts = formatExts(gopeed.settings.pageExts || "html,htm,php,asp,aspx,jsp,do,action");
  const targetExts = formatExts(gopeed.settings.targetExts || "css,js,json,xml,vue,png,jpg,jpeg,gif,svg,webp,mp4,mp3");
  
  // 合并所有可解析的后缀
  const parsableExts = Array.from(new Set([...pageExts, ...targetExts]));

  const files = [];
  const seenFiles = new Set();
  const visitedNodes = new Set(); 
  const queue = [{ url: entryUrl, depth: 0 }]; 
  let requestCount = 0;

  // 带超时控制的 fetch
  const fetchWithTimeout = async (url, timeoutMs = 10000) => {
    return Promise.race([
      fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
    ]);
  };

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

      // 如果是网页、或者嵌套深度还没用尽，就去请求内容
      if ((isPage || isParsable) && (depth < maxParseDepth || isPage)) {
        
        const resp = await fetchWithTimeout(currentUrl, 10000); // 10秒超时

        if (!resp.ok) continue;
        let text = await resp.text();
        
        // 限制超大文件解析
        if (text.length > 300000) text = text.substring(0, 300000);

        let regex;
        if (isPage || ext === "xml" || ext === "svg") {
          regex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
        } else if (ext === "css" || ext === "scss" || ext === "less") {
          regex = /url\s*\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi;
        } else {
          // 其他代码文件
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
            
            if (absObj.hostname !== baseHostname) continue; 

            const absPath = absObj.pathname;
            const absLastDot = absPath.lastIndexOf(".");
            const absExt = absLastDot !== -1 ? absPath.slice(absLastDot + 1).toLowerCase() : "";
            const segments = absPath.split("/");
            const name = decodeURIComponent(segments[segments.length - 1] || "file");

            // 命中目标文件后缀
            if (targetExts.includes(absExt) || parsableExts.includes(absExt) || absExt === "") {
              if (!seenFiles.has(abs)) {
                seenFiles.add(abs);
                files.push({ name: name, req: { url: abs } });
              }
            }

            // 推入队列
            const isSubPage = pageExts.includes(absExt) || absExt === "";
            const isSubAsset = targetExts.includes(absExt);

            if (parseNested) {
              // 如果是子页面或者深层文件，且没超过最大深度，就继续扒
              if ((isSubPage || isSubAsset) && depth < maxParseDepth) {
                queue.push({ url: abs, depth: depth + 1 });
              }
            } else if (isSubPage && depth === 0) {
              queue.push({ url: abs, depth: depth + 1 });
            }

          } catch (e) {}
        }
      } else {
        // 不需要解析的直接进下载列表
        const segments = pathname.split("/");
        const name = decodeURIComponent(segments[segments.length - 1] || "file");
        if (!seenFiles.has(currentUrl)) {
           seenFiles.add(currentUrl);
           files.push({ name: name, req: { url: currentUrl } });
        }
      }
    } catch (err) {
      // 超时或请求失败，忽略并继续
      continue; 
    }
  }

  if (files.length === 0) {
    throw new MessageError("未找到文件。可能被拦截，或网页是动态渲染。");
  }

  ctx.res = {
    name: baseHostname || "site-files",
    files: files.slice(0, 1000) 
  };
});