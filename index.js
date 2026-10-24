gopeed.events.onResolve(async function (ctx) {
  const pageUrl = ctx.req.url;

  try {
    // 1. 尝试抓取网页
    const resp = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });

    if (!resp.ok) {
      // 如果状态码不对，直接把状态码弹出来
      return showDebug(ctx, "HTTP错误_" + resp.status, pageUrl);
    }

    const html = await resp.text();

    // 2. 用正则提取链接
    const regex = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
    let match;
    const files = [];
    const seen = new Set();

    while ((match = regex.exec(html)) !== null) {
      let link = match[1].trim();
      if (/^(javascript|mailto|tel|data|blob):/i.test(link) || link.charAt(0) === "#") continue;

      try {
        const abs = new URL(link, pageUrl).href.split("#")[0];
        if (!seen.has(abs)) {
          seen.add(abs);
          const segments = new URL(abs).pathname.split("/");
          let name = decodeURIComponent(segments[segments.length - 1] || "file");
          files.push({
            name: name,
            req: { url: abs }
          });
        }
      } catch (e) {}
    }

    // 3. 核心调试逻辑：如果没找到文件，就把网页源码的开头变成文件名显示出来！
    if (files.length === 0) {
      // 提取 html 的前 30 个字符，去掉换行和特殊符号
      let preview = html.substring(0, 30).replace(/[\r\n\t\s<>]/g, "_");
      if (!preview) preview = "空内容";
      
      return showDebug(ctx, "没提取到文件_预览_" + preview, pageUrl);
    }

    // 4. 成功提取到文件
    ctx.res = {
      name: new URL(pageUrl).hostname || "site-files",
      files: files.slice(0, 200) // 最多显示200个，防止卡死
    };

  } catch (err) {
    // 如果是网络错误、超时等
    return showDebug(ctx, "解析异常_" + err.message, pageUrl);
  }
});

// 辅助函数：用来把调试信息直接显示在 Gopeed 的界面上
function showDebug(ctx, msg, url) {
  // 把错误信息当作文件名返回，让你在弹窗里能直接看到
  ctx.res = {
    name: "【调试信息】",
    files: [
      { name: msg.substring(0, 50) + ".txt", req: { url: url } }
    ]
  };
}