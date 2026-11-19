# Go Engineering & Concurrency Guardrails

## 1. 网络与流式度量安全
- 全链路追踪必须基于 `net/http/httptrace`，事件时间戳需精确至微秒级。
- 处理流式响应（SSE / Chunked）时，必须通过 `bufio.Scanner` 或流式读取器逐块解析，严禁一次性全内存加载。
- 严禁空 `catch` 或忽略致命网络错误，不可忽略资源释放（`resp.Body.Close()`）。

## 2. 并发与协程生命周期
- 启动 Goroutine 时必须绑定 `context.Context`，严格控制超时并防止 Goroutine 泄漏。
- 并发测速引擎强制限制 Worker Pool 规模（默认 4~8），严禁无限开辟协程压垮本地文件描述符或触发服务熔断。

