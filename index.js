gopeed.events.onResolve(async function (ctx) {
  // 基础连通性测试
  ctx.res = {
    name: "测试任务",
    files: [{
      name: "test.html",
      req: { url: ctx.req.url }
    }]
  };
});