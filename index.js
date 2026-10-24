gopeed.events.onResolve(async function (ctx) {
  const entryUrl = ctx.req.url;
  let baseHostname = "";
  try { 
    baseHostname = new URL(entryUrl).hostname; 
  } catch(e) { 
    return; 
  }

  // 1. 读取用户设置
  const maxParseDepth = Number(gopeed.settings.maxParseDepth) || 2;
  const maxRequests = Number(gopeed.settings.maxRequests) || 100;
  const parseNested = gopeed.settings.parseNested === true;

  // 格式化用户输入的后缀（去除空格、转小写、去点）
  const formatExts = (str) => (str || "").split(",").map(s => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean);
  
  const pageExts = formatExts(gopeed.settings.pageExts || "html,htm,php,asp,aspx,jsp,do,action");
  const targetExts = formatExts(gopeed.settings.targetExts || "css,js,json,xml,vue,png,jpg,jpeg,gif,svg,webp,mp4,mp3");
  
  // 合并所有可以读取内容的文本后缀
  const parsableExts = Array.from(new Set([...pageExts, ...targetExts]));

  const files = [];
  const seenFiles = new Set();
  const visitedNodes = new Set(); 
  
  // 队列元素：{ url: 链接, depth: 当前深度 }
  const queue = [{ url: entryUrl, depth: 0 }]; 
  let requestCount = 0;

  // 2. 封装带超时控制的 fetch（防止某个网页卡死拖垮整个任务）
  const fetchWithTimeout = async (url, timeoutMs = 10000) => {
    return Promise.race([
      fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), timeoutMs))
    ]);
  };

  // 3. 开始广度优先遍历爬虫
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

      // 如果是网页，或者满足深度条件的文件，就去请求读取内容
      if ((isPage || isParsable) && (depth < maxParseDepth || isPage)) {
        
        const resp = await fetchWithTimeout(currentUrl, 10000);
        if (!resp.ok) continue;
        
        let text = await resp.text();
        // 防止超大文件撑爆手机内存
        if (text.length > 300000) text = text.substring(0, 300000);

        // 4. 针对不同文件格式使用不同正则
        let regex;
        if (isPage || ext === "xml" || ext === "svg") {
          regex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
        } else if (ext === "css" || ext === "scss" || ext === "less") {
          regex = /url\s*\(\s*['"]?([^'"\)]+)['"]?\s*\)/gi;
        } else {
          // JS / JSON / Vue 等代码文件
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
            
            // 只解析同一个域名下的内容，防止爬出站外
            if (absObj.hostname !== baseHostname) continue; 

            const absPath = absObj.pathname;
            const absLastDot = absPath.lastIndexOf(".");
            const absExt = absLastDot !== -1 ? absPath.slice(absLastDot + 1).toLowerCase() : "";
            const segments = absPath.split("/");
            const name = decodeURIComponent(segments[segments.length - 1] || "file");

            // 5. 如果是你想要的文件，加入下载列表
            if (targetExts.includes(absExt) || parsableExts.includes(absExt) || absExt === "") {
              if (!seenFiles.has(abs)) {
                seenFiles.add(abs);
                files.push({ name: name, req: { url: abs } });
              }
            }

            // 6. 决定要不要继续套娃解析
            const isSubPage = pageExts.includes(absExt) || absExt === "";
            const isSubAsset = targetExts.includes(absExt);

            if (parseNested) {
              // 如果开启了深度解析，且没超过最大深度限制，就推入队列
              if ((isSubPage || isSubAsset) && depth < maxParseDepth) {
                queue.push({ url: abs, depth: depth + 1 });
              }
            } else if (isSubPage && depth === 0) {
              // 如果没开启深度解析，只抓取第一层子页面
              queue.push({ url: abs, depth: depth + 1 });
            }

          } catch (e) {}
        }
      } else {
        // 不需要读取内容的二进制文件（如图片、压缩包），直接加入下载
        const segments = pathname.split("/");
        const name = decodeURIComponent(segments[segments.length - 1] || "file");
        if (!seenFiles.has(currentUrl)) {
           seenFiles.add(currentUrl);
           files.push({ name: name, req: { url: currentUrl } });
        }
      }
    } catch (err) {
      // 碰到超时或请求错误，直接跳过，继续处理下一个
      continue; 
    }
  }

  if (files.length === 0) {
    throw new MessageError("未找到匹配的静态文件，请检查网页是否为空或被拦截。");
  }

  // 7. 返回结果，最多返回 1000 个文件
  ctx.res = {
    name: baseHostname || "site-files",
    files: files.slice(0, 1000) 
  };
});