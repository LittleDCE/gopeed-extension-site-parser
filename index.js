gopeed.events.onResolve(async function (ctx) {
  const entryUrl = ctx.req.url;
  let baseHostname = "";
  try { baseHostname = new URL(entryUrl).hostname; } catch(e) { return; }

  // 读取设置
  const maxTotalFiles = Number(gopeed.settings.maxTotalFiles) || 100;
  const filterByExt = gopeed.settings.filterByExt !== false; 
  const parseNested = gopeed.settings.parseNested === true;
  const useWebView = gopeed.settings.useWebView === true;

  // 格式化后缀
  const formatExts = (str) => (str || "").split(",").map(s => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean);
  const targetExts = formatExts(gopeed.settings.targetExts || "zip,rar,7z,pdf,mp4,mkv,apk,exe,iso,png,jpg,js,css");
  
  // 固定的页面后缀，用于判断是否继续爬
  const pageExts = ["html", "htm", "php", "asp", "aspx", "jsp", "do", "action"];
  const parsableExts = Array.from(new Set([...pageExts, ...targetExts, "css", "js", "json", "xml", "vue"]));

  const files = [];
  const seenFiles = new Set();
  const visitedNodes = new Set(); 
  const queue = [entryUrl]; 

  // 环境检测：防止手机端不支持 webview 报错
  const hasWebView = typeof gopeed.runtime !== 'undefined' && gopeed.runtime.webview;
  
  const fetchWithTimeout = async (url, timeoutMs = 8000) => {
    return Promise.race([
      fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
    ]);
  };

  // 辅助函数：从 URL 中提取带目录结构的相对路径（极简纯净版）
  const getRelativePath = (urlObj) => {
    let path = decodeURIComponent(urlObj.pathname); 
    if (path.startsWith("/")) path = path.substring(1); 
    if (!path || path.endsWith("/")) path += "index.html"; 
    
    // 把连续的双斜杠替换为单斜杠
    path = path.replace(/\/+/g, "/");

    // 直接返回带斜杠的路径
    return path;
  };

  while (queue.length > 0) {
    // 核心熔断机制：找够文件立马收工
    if (files.length >= maxTotalFiles) break;

    const currentUrl = queue.shift();
    if (visitedNodes.has(currentUrl)) continue;
    visitedNodes.add(currentUrl);

    try {
      const currentUrlObj = new URL(currentUrl);
      const pathname = currentUrlObj.pathname;
      const lastDot = pathname.lastIndexOf(".");
      const ext = lastDot !== -1 ? pathname.slice(lastDot + 1).toLowerCase() : "";
      
      const isPage = pageExts.includes(ext) || ext === "";
      const isParsable = parsableExts.includes(ext);

      // 如果需要解析内容
      if (isPage || (isParsable && parseNested)) {
        let text = "";
        let useFallback = false;

        // 尝试使用 WebView (如果是网页，且开了开关，且手机支持)
        if (isPage && useWebView && hasWebView) {
          try {
            const view = await gopeed.runtime.webview.open(currentUrl);
            text = await view.evaluate(() => document.documentElement.outerHTML);
            if (view.close) view.close();
          } catch (e) {
            useFallback = true; // 失败则降级
          }
        } else {
          useFallback = true;
        }

        // 普通 Fetch 请求
        if (useFallback || !text) {
          const resp = await fetchWithTimeout(currentUrl, 8000);
          if (!resp.ok) continue;
          text = await resp.text();
        }

        if (text.length > 300000) text = text.substring(0, 300000); 

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

            // 判断是否要加入下载列表
            let isMatch = false;
            if (filterByExt) {
              if (targetExts.includes(absExt)) isMatch = true;
            } else {
              // 全量抓取模式：排除空路径和当前页面自己
              if (abs !== entryUrl && absPath !== "/" && absExt !== "") isMatch = true;
            }

            if (isMatch) {
              if (!seenFiles.has(abs)) {
                seenFiles.add(abs);
                // 🌟 核心：获取带目录的路径作为文件名
                const filePath = getRelativePath(absObj);
                files.push({ name: filePath, req: { url: abs } });
              }
            }

            // 判断是否要加入队列继续深层爬取
            if (!visitedNodes.has(abs)) {
              const isSubPage = pageExts.includes(absExt) || absExt === "";
              const isSubAsset = targetExts.includes(absExt) || parsableExts.includes(absExt);

              if (parseNested) {
                if (isSubPage || isSubAsset) {
                  // 网页优先插队，资源文件排后面
                  if (isSubPage) queue.unshift(abs);
                  else queue.push(abs);
                }
              } else if (isSubPage) {
                queue.push(abs);
              }
            }
          } catch (e) {}
        }
      } else {
        // 不需要读取内容的二进制文件，直接加入列表
        let isMatch = false;
        if (filterByExt) {
          if (targetExts.includes(ext)) isMatch = true;
        } else {
          if (currentUrl !== entryUrl && ext !== "") isMatch = true;
        }

        if (isMatch && !seenFiles.has(currentUrl)) {
           seenFiles.add(currentUrl);
           // 🌟 核心：获取带目录的路径作为文件名
           const filePath = getRelativePath(currentUrlObj);
           files.push({ name: filePath, req: { url: currentUrl } });
        }
      }
    } catch (err) {
      continue; 
    }
  }

  if (files.length === 0) {
    throw new MessageError("未找到匹配的文件。可能网页是动态渲染或有防爬限制。");
  }

  ctx.res = {
    name: baseHostname || "download-files",
    files: files.slice(0, maxTotalFiles) 
  };
});