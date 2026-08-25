# guard-main-agent 测试报告（P2 实施）

> 日期：2026-08-21 | agent：code-execution | 状态：✅ 全绿（104 用例）
> 配套：`POC-报告-guard-main-agent-tools-pre-execute.md`（T1 POC）

## 一、测试总览

| #        | 测试文件                         | 用例数  | 覆盖                                                                                                                                                 |
| -------- | -------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | `tests/cache.spec.ts`            | 11      | TTLMap（TTL 过期/LRU 淘汰/缓存命中/hash 刷新/clear/构造校验）+ cacheKeyString 四元组 + hashText                                                      |
| 2        | `tests/policy.spec.ts`           | 21      | 工具分类集（write/diagnostic/delegation/code-class）+ parseClassifierOutput 容错（对象/纯文本/fence/数组/垃圾）+ resolveVerdict 正常/fallback 全分支 |
| 3        | `tests/classifier.spec.ts`       | 16      | 9888 POST payload（endpoint/model/system+user/temperature/max_tokens）+ 超时 abort + 信号 abort + 500 字符截断 + <1s 耗时（验收#4）                  |
| 4        | `tests/delegate.spec.ts`         | 10      | delegateTo→工具映射（code→call_code_agent / check→call_check_agent）+ 结果提取 + 派发失败降级 + null 不派发 + 缺 tools 降级 + denial notice 注入     |
| 5        | `tests/file-policy.spec.ts`      | 28      | 白名单命中/类型拒绝/fail-close/glob 正则/symlink realpath 防绕过（文件+父目录+白名单内保持）/temporaryOverrides 生效+过期                            |
| 6        | `tests/messages.spec.ts`         | 5       | 会话最近 5 轮 user+assistant 提取 + 上限 + 空会话                                                                                                    |
| 7        | `tests/guard-main-agent.spec.ts` | 13      | **端到端** pre-execute 集成：场景1-4 + 文件权限场景5-12 + 派发通道不递归                                                                             |
| **合计** | **7**                            | **104** | **全绿**                                                                                                                                             |

## 二、验收标准逐条核对（对应计划「四、验收标准」）

| #   | 标准                                                    | 状态 | 证据                                                                                                                                           |
| --- | ------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 主agent写代码被拦截+自动派 code-agent                   | ✅   | 集成场景1：`write src/main.ts` → deny + call_code_agent 被调（track.code=1）+ 注入说明含拦截原因与派发结果                                     |
| 2   | 简单诊断 read/grep/lsp 放行                             | ✅   | 集成场景2（read allow, nextCalls=1）；DIAGNOSTIC_TOOLS 覆盖 read/grep/lsp 等；场景3 lsp 放行                                                   |
| 3   | 分类失败时代码 close / 诊断 open                        | ✅   | 集成场景3：bash→deny+派 code-agent；write 白名单内→allow；lsp→allow                                                                            |
| 4   | 单次分类耗时 <1s                                        | ✅   | classifier.spec「类 well under 1s」断言 elapsed<1000                                                                                           |
| 5   | 无回归（既有子代理仍可用）                              | ✅   | 相邻包回归 580 用例全绿（skill-router/tool-subagent/core-tools/core-agent）；派发经真实 ToolRuntime.execute                                    |
| 6   | 拦截决策可追溯（日志含 verdict+reason）                 | ✅   | index.ts `logDecision` 打印 `tool=… verdict=… reason="…" delegateTo=… ms=…`                                                                    |
| 7   | 插件可配置（endpoint/model/fallback/清单路径从 config） | ✅   | Config schema 全字段 + 默认值；preset 挂载含 8 配置项                                                                                          |
| 8   | 任务切换缓存自动刷新                                    | ✅   | 集成场景4：同一任务缓存命中（fetch=1）；换 user message→hash 变→重新分类（fetch=2）                                                            |
| 9   | 文件权限拦截生效（D1）                                  | ✅   | 场景5=~/.dsh/settings.yaml deny、6=docs/新文档.md allow、7=docs/配置.yaml deny、8=.temp/test.txt allow、9=.temp/test.ts deny、5=AGENTS.md deny |
| 10  | symlink 绕过被拦截                                      | ✅   | file-policy + 集成场景10：白名单内 symlink 指向禁区 → deny，reason 含 resolvedPath                                                             |
| 11  | 临时例外过期自动失效                                    | ✅   | file-policy：live override allow；expired override deny（reason 含「过期」）；activeOverrides 过滤                                             |

## 三、工具链门禁留痕

| 门禁                                                        | 结果                                                                                               |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `tsc -b packages/extensions/guard-main-agent/tsconfig.json` | ✅ 0 错                                                                                            |
| `oxlint packages/extensions/guard-main-agent`               | ✅ 0 错 / 0 警告                                                                                   |
| `pnpm vitest run packages/extensions/guard-main-agent/`     | ✅ 104 passed                                                                                      |
| 全仓 `npm run typecheck`                                    | guard-main-agent 0 错（剩余 4 错全在**未纳入本任务**的 untracked skill-router 测试，与本任务无关） |
| `tsdown --env.DSH_BUILD_FACE host`                          | ✅ 生成 `lib/index.js` + `lib/invariant.js` + `lib/types/`                                         |

## 四、验收中发现并修复的实现决策

1. **glob 转换 bug**：计划 §8.0 伪代码的 escape 类未含 `*`，导致 `*` 被当成正则量词而非段匹配（实测 `projects/*/docs/` 匹配失败）。已修正为「先转义含 `*` 在内全部元字符、再恢复段」。
2. **生产 symlink 防御**：createFilePolicy 默认 fs 必须用真实 `fs.realpath`（绝不可 identity 返回，否则 symlink 绕过失防）。
3. **sync `agent.inject`**：block 说明/派发结果经公开 `Agent.inject` API 注入，属已验证通道。

## 五、遗留（不属于本任务）

- 重启 dsh 后 T10 人工验收 12 场景（Web GUI 实测截图留存）。
- 相邻 **untracked** 包 skill-router 的 4 个存量 typecheck 错误（在 skill-router 自身测试里），与本任务无关。
- 未 git commit：留待 check-agent 独立质检后提交。
