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
  const targetExts = formatExts(gopeed.settings.targetExts || "css,js,json,xml,vue,png,jpg,jpeg,gif,svg,webp,mp4,mp3,zip,pdf");
  const parsableExts = Array.from(new Set([...pageExts, ...targetExts]));

  const files = [];
  const seenFiles = new Set();
  const visitedNodes = new Set(); 
  const queue = [entryUrl]; 
  
  // 核心安全限制：最多允许拉起多少次 WebView
  let webviewCount = 0;
  const MAX_WEBVIEW_LIMIT = 30; 

  const fetchWithTimeout = async (url, timeoutMs = 8000) => {
    return Promise.race([
      fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
    ]);
  };

  while (queue.length > 0) {
    if (files.length >= maxTotalFiles) break;

    const currentUrl = queue.shift();
    if (visitedNodes.has(currentUrl)) continue;
    visitedNodes.add(currentUrl);

    try {
      const pathname = new URL(currentUrl).pathname;
      const lastDot = pathname.lastIndexOf(".");
      const ext = lastDot !== -1 ? pathname.slice(lastDot + 1).toLowerCase() : "";
      
      const isPage = pageExts.includes(ext) || ext === "";
      const isParsable = parsableExts.includes(ext);

      if (isPage || (isParsable && parseNested)) {
        let text = "";
        let success = false;

        if (isPage && webviewCount < MAX_WEBVIEW_LIMIT) {
          // 方案 A：网页使用真实浏览器渲染（突破防爬和动态加载）
          try {
            webviewCount++;
            const view = await gopeed.runtime.webview.open(currentUrl);
            text = await view.evaluate(() => document.documentElement.outerHTML);
            if (view.close) view.close();
            success = true;
          } catch (e) {
            success = false; // WebView 失败（如不支持等），降级为普通请求
          }
        } 
        
        // 方案 B：普通请求（针对 CSS/JS 文件，或者 WebView 次数耗尽的降级方案）
        if (!success) {
          const resp = await fetchWithTimeout(currentUrl, 8000);
          if (!resp.ok) continue;
          text = await resp.text();
        }

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
          if (files.length >= maxTotalFiles) break;

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

            if (targetExts.includes(absExt) || parsableExts.includes(absExt) || absExt === "") {
              if (!seenFiles.has(abs)) {
                seenFiles.add(abs);
                files.push({ name: name, req: { url: abs } });
              }
            }

            if (!visitedNodes.has(abs)) {
              if (isPage || (targetExts.includes(absExt) && parseNested)) {
                if (isPage || absExt === "") {
                  queue.unshift(abs); // 优先处理网页
                } else {
                  queue.push(abs);
                }
              }
            }
          } catch (e) {}
        }
      } else {
        // 纯资源文件，不入队直接加
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
    throw new MessageError("未找到匹配文件。如果目标网站有严格的滑动验证码，可能仍然无法突破。");
  }

  ctx.res = {
    name: baseHostname || "site-files",
    files: files.slice(0, maxTotalFiles) 
  };
});