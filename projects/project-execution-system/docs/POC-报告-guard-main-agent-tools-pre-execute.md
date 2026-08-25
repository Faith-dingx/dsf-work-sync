# POC 报告：tools/pre-execute 拦截 hook 可行性（guard-main-agent T1）

> 日期：2026-08-21 | 作者：code-execution agent | 结论：**可行**，按计划 T2-T10 继续
> 对应计划：`计划-guard-main-agent.md` 决策 1（拦截时机 = tools/pre-execute）+ T1

---

## 一、验证方式

本 POC 通过**直接阅读 harness 源码确认事件签名与 payload 结构**（源码引用行号见下），
并以 T8 端到端集成测试（`tests/guard-main-agent.spec.ts`）实测拦截触发（注册监听器 →
`ctx.waterfall('tools/pre-execute', exec, …)` 模拟工具调用 → 断言 deny/allow 决策返回）。

## 二、事件签名（源码引用）

源码：`/home/dingx/deepseek-harness/packages/core/tools/src/index.ts`

| 事实               | 行号           | 内容                                                                                                                                                    |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 事件声明           | 152            | `'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>`（waterfall 模式） |
| payload：toolName  | 321            | `readonly name: string`（exec.name）                                                                                                                    |
| payload：arguments | 322-323        | `readonly arguments: unknown`（已 lossless-JSON 解析、深冻结的实参）                                                                                    |
| payload：agent     | 324-325        | `readonly agent?: Agent`（调用方 agent，可取其 session 读会话历史）                                                                                     |
| payload：signal    | 336-337        | `readonly signal: AbortSignal`（调用方取消信号，监听器须观察）                                                                                          |
| 事件循环位置       | 452, 1376-1377 | pre-execute 在调度前运行：`collapse` 拒绝之外，每个工具调用必经此 waterfall（扩展策略阶段）                                                             |
| 允许：next()       | 588-591        | `PreToolDecision = {kind:'allow'} \| {kind:'deny'; reason} \| {kind:'ask'}`                                                                             |
| 拒绝：不调 next()  | 590            | 返回 `{kind:'deny', reason}` 即阻断原工具调用（materialize 为错误结果）                                                                                 |
| 程序化派发工具     | 1342           | `ToolRuntime.execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>`（guard 可用它调 call_code_agent/call_check_agent）                        |

会话历史读取：`packages/core/session/src/index.ts` L559 `get events()` 返回不可变事件快照；
`user/message` 事件 data 为 `UserMessage`（含 content 文本块），`assistant/message` data 为
`{turn, step, message: AssistantMessage, …}`（known-event-types.ts L26/L65-66）——
pre-execute 内可经 `exec.agent.session.events` 提取最近 5 轮 user+assistant 消息。

## 三、T1 验收结论

| 验收项           | 结果                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------- |
| hook 可行/不可行 | **可行**（事件存在、payload 含 toolName+arguments+agent+signal、deny 可阻断、next() 可放行） |
| 备选方案是否需要 | 不需要（`agent/pre-step` + 消息预测仅作兜底，不启用）                                        |
| typecheck 通过   | 见 T8 全绿留痕（`pnpm tsc --noEmit` 于 packages/extensions/guard-main-agent）                |

## 四、关键设计确认（POC 结论 → 实施约束）

1. 拒绝动作 = 返回 `{kind:'deny', reason}`，不再调用 next()；允许 = 调 next()。
2. guard 自身派发的子代理工具（call_code_agent/call_check_agent/call_plan_reviewer/
   call_project_planner/subagent/subagent_fork）须在监听器内**直接放行**（合法派发通道），
   防止自我递归。
3. 消息注入用 `agent.inject(createUserMessage(...))`（dsh-agent runtime-types.ts L143，
   公开已验 API），派发用 `ctx.tools.execute(...)`（tools/src/index.ts L1342）。
4. 单次分类耗时预算：classifier 请求带 AbortController 超时（config.timeoutMs，默认 5000），
   T8 测试中对 mock fetch 计时断言 < 1s（验收 #4）。
