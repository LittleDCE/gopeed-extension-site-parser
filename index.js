gopeed.events.onResolve(async function (ctx) {
  const entryUrl = ctx.req.url;
  let baseHostname = "";
  try { baseHostname = new URL(entryUrl).hostname; } catch(e) { return; }

  // 读取设置
  const maxTotalFiles = Number(gopeed.settings.maxTotalFiles) || 100;
  const parseNested = gopeed.settings.parseNested === true;

  // 格式化后缀
  const formatExts = (str) => (str || "").split(",").map(s => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean);
  const pageExts = formatExts(gopeed.settings.pageExts || "html,htm,php,asp,aspx,jsp,do,action");
  const targetExts = formatExts(gopeed.settings.targetExts || "css,js,json,xml,vue,png,jpg,jpeg,gif,svg,webp,mp4,mp3");
  const parsableExts = Array.from(new Set([...pageExts, ...targetExts]));

  const files = [];
  const seenFiles = new Set();
  const visitedNodes = new Set(); 
  
  // 队列元素只有 URL
  const queue = [entryUrl]; 

  const fetchWithTimeout = async (url, timeoutMs = 8000) => {
    return Promise.race([
      fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
    ]);
  };

  while (queue.length > 0) {
    // 🌟 核心熔断机制：只要收集的文件数达标了，立刻收工！绝不多跑一秒。
    if (files.length >= maxTotalFiles) {
      break;
    }

    const currentUrl = queue.shift();
    if (visitedNodes.has(currentUrl)) continue;
    visitedNodes.add(currentUrl);

    try {
      const pathname = new URL(currentUrl).pathname;
      const lastDot = pathname.lastIndexOf(".");
      const ext = lastDot !== -1 ? pathname.slice(lastDot + 1).toLowerCase() : "";
      
      const isPage = pageExts.includes(ext) || ext === "";
      const isParsable = parsableExts.includes(ext);

      // 如果是网页，或者允许深层解析的代码文件，就去抓内容
      if (isPage || (isParsable && parseNested)) {
        const resp = await fetchWithTimeout(currentUrl, 8000);
        if (!resp.ok) continue;
        
        let text = await resp.text();
        if (text.length > 300000) text = text.substring(0, 300000); // 防大文件卡死

        let regex;
        if (isPage || ext === "xml" || ext === "svg") {
          regex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
        } else if (ext === "css") {
          regex = /url\s*\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi;
        } else {
          regex = /["'`]([^"'`]+\.(?:png|jpg|jpeg|gif|svg|webp|css|js|json|mp4|mp3|woff2?|ttf))["'`]/gi;
        }

        if (!regex) continue;

        let match;
        while ((match = regex.exec(text)) !== null) {
          // 每次找到一个，都检查一下是不是已经达标了
          if (files.length >= maxTotalFiles) break;

          let link = match[1].trim();
          if (/^(javascript|mailto|tel|data|blob):/i.test(link) || link.charAt(0) === "#") continue;

          try {
            const abs = new URL(link, currentUrl).href.split("#")[0];
            const absObj = new URL(abs);
            
            if (absObj.hostname !== baseHostname) continue; // 限制同源

            const absPath = absObj.pathname;
            const absLastDot = absPath.lastIndexOf(".");
            const absExt = absLastDot !== -1 ? absPath.slice(absLastDot + 1).toLowerCase() : "";
            const segments = absPath.split("/");
            const name = decodeURIComponent(segments[segments.length - 1] || "file");

            // 如果是想要的文件，加入结果列表
            if (targetExts.includes(absExt) || parsableExts.includes(absExt) || absExt === "") {
              if (!seenFiles.has(abs)) {
                seenFiles.add(abs);
                files.push({ name: name, req: { url: abs } });
              }
            }

            // 把还没访问过的链接塞进队列，继续挖
            if (!visitedNodes.has(abs)) {
              if (isPage || (targetExts.includes(absExt) && parseNested)) {
                // 把网页排在队列前面，优先扫清所有页面
                if (isPage || absExt === "") {
                  queue.unshift(abs); 
                } else {
                  queue.push(abs);
                }
              }
            }
          } catch (e) {}
        }
      } else {
        // 纯资源文件，直接加入列表
        const segments = pathname.split("/");
        const name = decodeURIComponent(segments[segments.length - 1] || "file");
        if (!seenFiles.has(currentUrl)) {
           seenFiles.add(currentUrl);
           files.push({ name: name, req: { url: currentUrl } });
        }
      }
    } catch (err) {
      continue; // 单个网页请求失败直接跳过
    }
  }

  if (files.length === 0) {
    throw new MessageError("未找到匹配的静态文件，请检查网页或网络情况。");
  }

  ctx.res = {
    name: baseHostname || "site-files",
    files: files.slice(0, maxTotalFiles) // 最终硬截断，保证绝不超标
  };
});