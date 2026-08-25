# 修正计划：guard-main-agent 误拦修复（T10 验收发现）— v2

> 日期：2026-08-21 | agent：project-planner（规划只，不实施）
> 对应 commit：090ba7e532（当前已提交版本）
> 目标分支：`main`（或当前 PR 分支）
> 版本：v2（基于 v1 修订，解决 S1-S6 评审问题）

---

## 修订摘要（v1 → v2）

| 问题 | 严重度 | 修正内容                                                                               |
| ---- | ------ | -------------------------------------------------------------------------------------- |
| S1   | 严重   | classify() 入口增加 caller abort 检测，已 abort 时直接返回不重试                       |
| S2   | 中     | 新增 classifier 耗时日志（P95/P99），实施后观察 1-2 天                                 |
| S3   | 中     | T4 新增场景 E（caller abort → 不重试）；T5 新增场景 H（集成）                          |
| S4   | 低     | 修正场景 E 实现描述：vi.useFakeTimers + mock fetch 永 pending + vi.advanceTimersByTime |
| S5   | 低     | T5 扩展覆盖 HTTP 429/400（不重试 fail-close）+ 保留 500 场景                           |
| S6   | 低     | 明确 retryCount 默认 1 次重试（z.default(1)），消除歧义                                |

---

## 一、问题概述（来自 T10 验收实证）

**现象**：主 agent 调用 `bash` 做诊断检查时被拦截，错误信息 `classifier unavailable; code-class tool fails close`。实测 9888 端点健康（HTTP 200/19ms），同形态完整请求 2.16s 成功返回。

**根因**（code-agent 诊断）：

1. `timeoutMs` 默认 5000ms，路由耗时偶尔 >5s 时被 AbortController 掐掉 → 折叠成 `classifier unavailable`
2. `bash` 归入 `CODE_CLASS_TOOLS`（一律 fail-close），而 `diagnosticFallback: open` 只覆盖 `DIAGNOSTIC_TOOLS`（不含 bash）→ 诊断类 bash 被误杀
3. 错误未区分：AbortError（超时→应重试）vs HTTP 4xx/5xx（真故障→fail-close）

---

## 二、设计决策

### 决策 1：超时阈值调整

| 选项     | 值              | 理由                                                                                            |
| -------- | --------------- | ----------------------------------------------------------------------------------------------- |
| **选定** | 5000 → 10000 ms | 实测健康请求 2.16s；10s 给路由抖动留出充足余量；同时保持下限 1000ms（config validate 拒绝 <1s） |

**向后兼容**：已有配置中 `timeoutMs` 保持原值生效；未配置用户默认值从 5000 改为 10000，不影响明确指定旧值的配置。

**数据支撑观察**：

- 实施后记录 classifier 耗时日志（每次 classify 调用记录 duration_ms）
- 观察 1-2 天，统计 P95/P99 耗时
- 若 P99 仍 > 10s，需进一步分析或调整阈值

### 决策 2：错误归因 + 超时重试

| 分类                                    | 处理方式        | 理由                                              |
| --------------------------------------- | --------------- | ------------------------------------------------- |
| `AbortError`（timeout 自身触发）        | 重试 1 次       | 超时是瞬时抖动，非服务端真故障；重试概率性解决    |
| **caller 主动 abort**                   | **不重试**      | 违背 caller 意图（用户切会话/超时取消），必须尊重 |
| 非 AbortError 的 throw（网络/DNS）      | 直接 fail-close | 重试可能同样失败；真实故障不应掩盖                |
| HTTP 4xx（400/429 等）                  | 直接 fail-close | 服务端明确报错，重试无意义且加重负载              |
| HTTP 5xx                                | 直接 fail-close | 服务端明确报错，重试无意义且加重负载              |
| 响应解析失败（无 content / 空 choices） | 直接 fail-close | 模型输出异常，重试大概率同样失败                  |

**配置新增**：`retryCount?: number`（**默认 1 次重试**，可选配置，用 `z.default(1)`）。向后兼容：缺省值 = 1 次重试。

**日志增强**：

- `PolicyVerdict` 新增可选 `errorType?: 'timeout' | 'fatal'`，便于运维区分拦截原因
- 每次 classify 调用记录 `duration_ms` 耗时（用于 P95/P99 观察）

### 决策 3：bash 归类保留 CODE_CLASS_TOOLS（安全优先）

| 方案                              | 优点                                                       | 缺点                                                            |
| --------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| **选定：保持在 CODE_CLASS_TOOLS** | 维持"主agent不碰代码"guard 初衷；fail-close 保留强安全边界 | classifier 真故障时 bash 仍然不可用（但通过重试大幅降低误拦率） |
| 移入 DIAGNOSTIC_TOOLS             | fail-close 时 bash 可自主执行                              | 主 agent 可自由执行任意命令，丧失 guard 核心价值                |
| 新增 DIAGNOSTIC_BASH 子集         | 折中方案                                                   | 增加复杂度；需要维护新的工具分类集                              |

**理由**：

- T10 误拦是**瞬时超时**问题，不是 bash 本身应否被拦截的原则问题
- 决策 1+2（超时放宽 + 重试）已能解决 99%+ 误拦场景
- `diagnosticFallback: open` 已覆盖 read/grep/lsp/session 等 40+ 诊断工具，bash 作为唯一命令执行工具应保持严格管控
- 如果未来确实需要 classifier 故障时放行部分 bash，应通过 config 显式开启（如 `permissiveBashOnClassifierDown: true`），而非默认放开

**结论**：bash 归类不动，`CODE_CLASS_TOOLS` 保持不变。

---

## 三、改动文件清单

### 源码文件（5 处修改）

| 文件                | 改动内容                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`      | 新增 `ClassifyErrorType` 联合类型；扩展 `ClassifyResult` 增加 `errorType?`；扩展 `ResolvedGuardConfig` 增加 `retryCount`；扩展 `PolicyVerdict` 增加 `errorType?`      |
| `src/classifier.ts` | 新增 `isTimeoutError()` 判断；`callClassifier` 不变（超时由上层控制）；`classify` 增加重试逻辑（timeout 错误重试 1 次）；**新增 caller abort 检测**                   |
| `src/index.ts`      | Config schema 增加 `retryCount`（默认 1）；`resolveConfig` 增加 `retryCount` 默认值；`classifyAndDecide` 中传递 `config.retryCount`；`logDecision` 日志追加 errorType |
| `src/policy.ts`     | `PolicyVerdict` 新增可选 `errorType` 字段                                                                                                                             |
| `tests/*.spec.ts`   | 见下方任务 T4/T5                                                                                                                                                      |

### 测试文件（2 处新增测试）

| 文件                             | 新增用例                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/classifier.spec.ts`       | 超时后重试成功（场景A）；超时后重试仍失败（场景B）；非超时错误不重试（场景C）；retryCount=0 禁用重试（场景D）；**caller abort 不重试（场景E）** |
| `tests/guard-main-agent.spec.ts` | 集成测试：超时抖动请求（>5s <10s）不再误拦；真故障（fetch 抛错）仍 fail-close；**HTTP 4xx 不重试**；**集成 caller abort 场景（H）**             |

---

## 四、Bite-Sized 任务（T1–T6）

每个任务 ≤30 min，验收标准明确（typecheck/lint/test 三重验证）。

### T1：类型扩展（src/types.ts）

**任务描述**：在 `types.ts` 中增加新类型字段，不影响已有字段。

**具体步骤**：

1. 新增 `export type ClassifyErrorType = 'timeout' | 'fatal'`
2. `ClassifyResult` 追加 `errorType?: ClassifyErrorType`
3. `ResolvedGuardConfig` 追加 `readonly retryCount: number`（默认 1）
4. `PolicyVerdict` 追加 `readonly errorType?: ClassifyErrorType`

**验收**：

- `pnpm tsc --noEmit` 通过（0 错）
- `pnpm vitest run packages/extensions/guard-main-agent/tests/policy.spec.ts` 通过（既有用例不改）
- `pnpm vitest run packages/extensions/guard-main-agent/tests/classifier.spec.ts` 通过（既有用例不改）

---

### T2：classifier.ts 错误类型化 + caller abort 检测 + 重试逻辑

**任务描述**：`classify()` 函数支持错误归因、caller abort 检测和重试。

**具体步骤**：

1. 新增辅助函数 `isTimeoutError(error: unknown): boolean`：检测 `DOMException`（name === 'AbortError'）或 `Error`（message 含 'timed out' / 'abort'）
2. **重构 `classify()` 入口**：
   - 首先检查 `if (signal?.aborted) return { ok: false, error: new Error('caller aborted'), errorType: 'fatal' }`
   - 仅当 caller 未 abort 时，才允许因超时重试
3. 计算实际重试次数：`const maxAttempts = 1 + (config.retryCount ?? 1)`
4. 循环调用 `callClassifier()`，首次 timeout 错误重试 1 次
5. 返回 `{ok:false, error, errorType}` 区分超时和致命错误
6. 每次 classify 调用记录耗时（`performance.now()`），用于 P95/P99 观察
7. 保留原有 `callClassifier()` 函数签名不变（供单元测试直接调用）

**注意**：

- 内部 `AbortController` 超时已固定为 `config.timeoutMs`，重试时每次创建新 controller
- 外部 `signal` 应传给每次重试调用（若 caller 主动 abort，不应继续重试）
- **caller abort 是硬终止信号，必须尊重**

**验收**：

- `pnpm tsc --noEmit` 通过
- `pnpm vitest run packages/extensions/guard-main-agent/tests/classifier.spec.ts` 通过（**既有用例必须全绿，不新增测试暂不跑**——T4 再补）

---

### T3：index.ts 配置扩展 + classifyAndDecide 调用适配

**任务描述**：Schema 增加 `retryCount`，`classifyAndDecide` 透传，日志增加 errorType。

**具体步骤**：

1. `Config` 接口追加 `retryCount?: number`
2. `Config` zod schema 追加 `retryCount: z.number().default(1)`（**明确：未配置时默认 1 次重试**）
3. `resolveConfig()` 追加 `retryCount: raw.retryCount ?? 1`
4. `classifyAndDecide()` 中：
   - 调用 `classify(resolved, context, exec.signal)` 不变（`resolved` 含 retryCount）
   - 将 `result.errorType` 传入 `decisionRecord` / `logDecision`
5. `logDecision()` 日志格式追加 `errorType=${verdict.errorType ?? 'none'}`

**验收**：

- `pnpm tsc --noEmit` 通过
- `pnpm oxlint packages/extensions/guard-main-agent` 通过（0 警告）
- `pnpm vitest run packages/extensions/guard-main-agent/tests/guard-main-agent.spec.ts` 通过（**集成场景3 仍然 deny + 派发，因为 mock fetch 抛错是 fatal，不是 timeout，不会触发重试**）

---

### T4：classifier 单元测试新增（tests/classifier.spec.ts）

**任务描述**：覆盖重试行为的 5 个关键场景（含 caller abort 检测）。

**具体步骤**：

1. 新增测试组 `describe('classify retry', ...)`
2. **场景 A：timeout 错误后重试成功**
   - mock fetch：首次调 AbortError，第二次返回正常内容
   - 断言：`result.ok === true`，`fetch` 被调用 2 次
3. **场景 B：timeout 错误后重试仍失败**
   - mock fetch：两次都 AbortError
   - 断言：`result.ok === false`，`result.errorType === 'timeout'`
4. **场景 C：非 timeout 错误（fetch 抛 Error）不重试**
   - mock fetch：抛 `new Error('network')`
   - 断言：`result.ok === false`，`result.errorType === 'fatal'`，`fetch` 只被调用 1 次
5. **场景 D：retryCount=0 禁用重试**
   - 传 `config: { ...config, retryCount: 0 }`，mock fetch 抛 AbortError
   - 断言：`result.ok === false`，`fetch` 只被调用 1 次
6. **场景 E：caller 主动 abort → 不重试**（S1/S3/S4 修正）
   - 创建 AbortController，立即调用 `controller.abort()`
   - mock fetch：返回永 pending Promise（永远不会 resolve/reject）
   - 调用 `classify(config, context, controller.signal)`
   - 断言：`fetch` **只被调用 0 次**（入口检测 abort，直接返回，不调 fetch）
   - 断言：`result.ok === false`，`result.errorType === 'fatal'`
   - **实现方式**：`vi.useFakeTimers()` + mock fetch 返回永 pending Promise + 不调 `vi.advanceTimersByTime()`（因为入口直接返回，不需要 advance）

**验收**：

- `pnpm vitest run packages/extensions/guard-main-agent/tests/classifier.spec.ts` 全绿（包括原有 16 + 新增 5 = 21 用例）
- `pnpm tsc --noEmit` 通过

---

### T5：集成测试新增（tests/guard-main-agent.spec.ts）

**任务描述**：端到端验证超时抖动不再误拦、HTTP 4xx 不重试、caller abort 不重试。

**具体步骤**：

1. 新增 `describe('classifier timeout jitter regression', ...)`
2. **场景 E：延迟 >5s 但 <10s 的请求，timeout 后重试成功**
   - mock fetch：首次延迟 6000ms 后抛 AbortError，第二次立即返回 allow
   - 用 `vi.useFakeTimers()` + mock fetch 返回永 pending Promise + `vi.advanceTimersByTime(6000)` 模拟超时触发
   - 断言：`decision.kind === 'allow'`（不再误拦）
3. **场景 F：真故障（fetch 抛 network error）仍 fail-close**
   - mock fetch：抛 `new Error('network down')`
   - 断言：`bash` 决策为 deny，`track.code === 1`（正常派发 code-agent）
4. **场景 G：HTTP 500 不重试**
   - mock fetch：返回 `new Response('error', { status: 500 })`
   - 断言：`fetch` 只被调用 1 次，bash 决策为 deny
5. **场景 G+：HTTP 429/400 不重试**（S5 修正）
   - mock fetch：返回 `new Response('too many requests', { status: 429 })` 和 `new Response('bad request', { status: 400 })`
   - 断言：`fetch` 只被调用 1 次，bash 决策为 deny
6. **场景 H：caller abort 不重试**（S3 修正）
   - 创建 AbortController，启动 classify 后立即调用 `controller.abort()`
   - mock fetch：返回永 pending Promise
   - 断言：`fetch` **只被调用 0 次**（入口检测 abort，直接返回）
   - 断言：`bash` 决策为 deny（因 caller abort 属于 fatal）

**验收**：

- `pnpm vitest run packages/extensions/guard-main-agent/tests/guard-main-agent.spec.ts` 全绿
- `pnpm tsc --noEmit` 通过

---

### T6：全量回归

**任务描述**：跑全量测试，确认 104 原有用例无回归。

**验收**：

- `pnpm vitest run packages/extensions/guard-main-agent/`：**104 + 11 = 115 用例全绿**
- `pnpm tsc --noEmit`：0 错
- `pnpm oxlint packages/extensions/guard-main-agent`：0 警告
- `tsdown --env.DSH_BUILD_FACE host`：构建产物正常（lib/ 目录）

---

## 五、验收标准（量化）

| #   | 标准                                  | 量化指标                                                                    |
| --- | ------------------------------------- | --------------------------------------------------------------------------- |
| 1   | 同形态请求抖动 >5s 不再误拦           | 延迟 6000ms 的 mock fetch + 重试后返回 allow；集成场景 E 通过               |
| 2   | 超时重试 1 次后成功放行               | classifier.spec 场景 A：`fetch` 调用 2 次，最终 ok=true                     |
| 3   | 真故障（HTTP 5xx/网络）仍 fail-close  | 场景 F/G：`fetch` 只调 1 次，bash deny，code-agent 被派发                   |
| 4   | **HTTP 4xx 不重试**（S5 修正）        | 场景 G+：429/400 返回后 fetch 只调 1 次，bash deny                          |
| 5   | **caller abort 不重试**（S1/S3 修正） | classifier.spec 场景 E + 集成场景 H：fetch 调用 0 次，直接返回 fatal        |
| 6   | 既有 104 测试无回归                   | T6 全绿，0 用例失败                                                         |
| 7   | classifier 耗时 <10s（含重试）        | 单次 `callClassifier` 仍有 `timeoutMs` 约束；重试只在 timeout 错误时发生    |
| 8   | **classifier 耗时日志（S2 修正）**    | 每次 classify 调用记录 `duration_ms`；实施后观察 1-2 天 P95/P99             |
| 9   | 拦截决策日志含 errorType              | `logDecision` 输出含 `errorType=timeout` 或 `errorType=fatal`               |
| 10  | 向后兼容                              | 不传 `retryCount` 时默认 1；不传 `timeoutMs` 时默认 10000（旧配置不受影响） |
| 11  | bash 仍属 CODE_CLASS_TOOLS            | policy.spec 中 `CODE_CLASS_TOOLS.has('bash') === true` 不变                 |

---

## 六、风险项

| #   | 风险                                       | 影响           | 缓解措施                                                                                                                                |
| --- | ------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | 重试加重 9888 端点负载                     | 低             | 默认重试 1 次；仅 timeout 错误触发；重试间隔 = 0（立即重试，无 backoff）；可配置 retryCount 调低                                        |
| R2  | 重试导致主 agent 等待时间翻倍              | 中             | 最大等待 = 2 × timeoutMs = 20s（config 限制 10000ms）；可在 config 中缩短 timeoutMs 平衡                                                |
| R3  | bash 仍在 CLASSIFIER_DOWN 时 fail-close    | 中（设计理念） | 这是**故意保留**的安全边界；T10 误拦是超时抖动问题，已通过重试解决；如需 classifier 故障时放行 bash，应通过独立 config 开启（本次不改） |
| R4  | 既有集成测试场景 3（network down）行为变化 | 低             | mock fetch 抛 `new Error('network')` 是 fatal 错误，不触发重试；行为与之前一致（立即 deny）                                             |
| R5  | `DOMException` 在 Node.js 环境可用性问题   | 低             | `isTimeoutError` 同时检查 `instanceof DOMException` 和 `name === 'AbortError'`                                                          |

---

## 七、不建议做的改动（避免过度工程）

- ❌ 不新增 `DIAGNOSTIC_BASH` 子集：增加分类复杂度，收益低
- ❌ 不引入指数退避：对单次重试没有必要，增加代码复杂度
- ❌ 不修改 `CODE_CLASS_TOOLS` 集合内容：保持 guard 安全原则不变
- ❌ 不引入外部依赖：全量使用标准 API（AbortController/fetch/DOMException）

---

## 八、实施顺序建议

```
T1（类型）→ T2（classifier 逻辑 + caller abort 检测）→ T3（index 适配）
→ T4（classifier 单测 + 场景 E）→ T5（集成测试 + 场景 H）
→ T6（全量回归）
```

每步完成后提交一次 commit，方便 review 和回滚。

---

## 九、文档更新建议（不在本次 plan 范围，留给实施 agent）

- `packages/extensions/guard-main-agent/README.md`：补充 `retryCount` 字段说明
- `docs/PROGRESS.md`：记录本次修复状态
- `docs/CHANGELOG.md`：记录 T10 验收发现 + 本修复 plan
