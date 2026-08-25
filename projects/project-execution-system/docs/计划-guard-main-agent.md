# 实施计划 v1.3：guard-main-agent（主 agent 行为保障）插件

> 日期：2026-08-21 | 状态：**P2 实施完成（code-execution 2026-08-21，T1-T9 全过，T10 人工验收待重启后执行）** | v1.3 响应主agent清单v2.1修订
> 修订要点：v2.1清单.temp/类型限制/H3 temporaryOverrides时序说明/H4 glob匹配算法补充

---

## 一、设计决策（5 个关键问题）

### 决策 1：拦截时机 — **tools/pre-execute 事件**

- **选择**：监听 `tools/pre-execute` 事件，在工具实际执行前拦截
- **理由**：
  - `agent/pre-step` 在每轮提议步骤时触发，但此时 tool call 尚未确定（模型还在思考）
  - `tools/pre-execute` 在工具调用提交时触发，可获取完整的 `toolName` + `arguments`
  - 这是"语言→设备"转化的最佳时机：把规则变成机器门禁
- **权衡**：pre-step 更早但信息不足；post-execute 太晚无法阻止
- **实现**：插件注册 `ctx.on('tools/pre-execute', async (exec, next) => {...})`

### 决策 2：分类逻辑 — **辅助模型判断任务类型 + 动作是否越界**

- **选择**：使用 9888 辅助模型（`agnes/agnes-2.5-flash`）判断：
  1. 当前任务类型（代码/文档/配置/诊断）
  2. 主 agent 的动作是否越界
  3. 应派哪个子代理
- **实现**：
  - HTTP POST 到 `http://10.10.10.2:9888/v1/chat/completions`
  - system prompt 包含主 agent 职责边界规则（从 docs/主agent职责边界.md 提炼）
  - user message 包含：当前工具名、参数摘要、历史消息上下文（最近 5 轮）
  - 输出格式：`{"verdict": "block|allow", "reason": "...", "delegateTo": "code-agent|check-agent|null", "reviewPrompt": "..."}`
- **降级策略**：**fail-close（fallback close）**
  - 与 skill-router 的 fail-close 一致：guard 防越界的目标是拦截，不是放行
  - classifier 失败 → 阻断原工具调用，记录 warning 日志供事后审计
  - **例外**：诊断类/只读类操作（read/grep/lsp）可 fallback open，代码类操作强制 close
  - 配置项 `fallback: 'close'`（默认 close），诊断类可单独配置 `diagnosticFallback: 'open'`

### 决策 3：拦截动作 — **deny + 通过现有 subagent 工具派发**

- **选择**：返回 `{kind: 'deny', reason: '...'}` 并触发子代理调用
- **实现**：
  1. `next()` 不调用（阻断原工具调用）
  2. 注入系统提示说明拦截原因（写入对话流）
  3. 根据 classifier 输出的 `delegateTo` 字段，通过现有 subagent 工具自动派发：
     - 代码任务 → `call_code_agent`（opencode-go/deepseek-v4-flash）
     - 质检任务 → `call_check_agent`（agnes/agnes-2.5-flash）
  4. **方案评审类任务**：不自动派发 `call_plan_reviewer`；classifier 输出 `reviewPrompt` 字段（评审 prompt 文本），由主 agent 读取后决定是否调用 `call_plan_reviewer`
- **不变**：诊断超时/复杂诊断 → `call_check_agent`（熔断规则，与四道闸手册一致）

### 决策 4：上下文感知 — **任务类型缓存 + 消息历史窗口**

- **选择**：基于任务类型缓存分类结果，避免每工具调用都调 classifier
- **实现**：
  - 缓存 key：`sessionId|messageHash|workspacePath|presetId`（与 skill-router 保持一致的四元组格式）
  - TTL：10 分钟（覆盖一轮对话）
  - 任务类型判定：从用户消息推断，而非从工具调用序列推断
  - 窗口历史：最近 5 轮 user+assistant 消息作为上下文
- **缓存失效条件**：
  - 用户明确切换任务（**每次 pre-execute 时计算最近 user message 的 hash，与缓存 key 中的 messageHash 比对；不一致则清除旧缓存并重新分类**）
  - TTL 过期
  - 收到 `/reset` 命令

### 决策 5：配置来源 — **外部配置，不硬编码**

- **选择**：所有参数从 cordis.yml 读取，与 skill-router 保持一致
- **配置项**：
  ```yaml
  - id: guard-main-agent
    name: '@dsf/guard-main-agent'
    config:
      classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
      classifierModel: 'agnes/agnes-2.5-flash'
      fallback: 'close' # 'close' | 'open' | 'warn'（默认 close，防越界目标优先）
      diagnosticFallback: 'open' # 诊断/只读类操作的 fallback，默认 open
      timeoutMs: 5000
      cacheTtlMs: 600000 # 10 分钟
      cacheMax: 50
      presetId: 'main-agent'
      boundaryDocPath: 'docs/主agent职责边界.md' # 可选：从文件读取规则
  ```
- **默认值**：与 skill-router 相同 endpoint/model，fallback 为 `close`（防越界目标优先，与 skill-router 一致）

---

## 二、文件结构

```
/home/dingx/DSF-work/packages/guard-main-agent/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts              # 插件入口（apply 函数，注册 tools/pre-execute 监听）
    ├── classifier.ts         # 辅助模型调用封装（HTTP POST 到 9888）
    ├── policy.ts             # 越界判断逻辑（规则引擎 + 分类结果解析）
    ├── filePolicy.ts         # 文件权限拦截（白名单+fail-close，对接主agent可改写文件清单）
    ├── delegate.ts           # 子代理派发逻辑（仅 call_code_agent / call_check_agent）
    ├── cache.ts              # 任务类型缓存（TTLMap，四元组 key）
    └── types.ts              # 类型定义
```

**挂载位置**：用户 preset 的 `~/.dsh/.agent-presets/full/agent.cordis.yml` 追加行：

```yaml
- id: guard-main-agent
  name: '@dsf/guard-main-agent'
  config:
    classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
    classifierModel: 'agnes/agnes-2.5-flash'
    fallback: 'close'
    diagnosticFallback: 'open'
    timeoutMs: 5000
    cacheTtlMs: 600000
    cacheMax: 50
    presetId: 'main-agent'
```

---

## 三、bite-sized 任务列表

### T1. POC 验证 tools/pre-execute 可行性（依赖：无）⭐ 关键路径

- 读 `/home/dingx/deepseek-harness/packages/core/tools/src/index.ts` 确认 `tools/pre-execute` 事件签名
- 验证 payload 是否包含：`toolName`、`arguments`、`agent`、`signal`
- 写小脚本验证：注册监听器 → 模拟工具调用 → 观察 intercept 是否触发
- 验收：**POC 报告**（含源码引用行号 + 结论：hook 可行/不可行）+ typecheck 通过
- 若 hook 不可行 → 切备选方案（`agent/pre-step` + 消息预测），计划相应调整

### T2. 项目脚手架（依赖：T1 POC 通过）

- 在 `packages/guard-main-agent/` 创建 package.json + tsconfig.json + src/index.ts 骨架
- 定义基础类型（Config、ClassifierContext、PolicyVerdict）
- 验收：`pnpm tsc --noEmit` 通过（零报错）

### T3. classifier.ts — 辅助模型调用封装（依赖：T2）

- 实现 `callClassifier(userMessage, context): Promise<ClassifierResult>`
- 从 config 读取 endpoint + model（`agnes/agnes-2.5-flash`）+ timeout
- 构建 system prompt：提取 docs/主agent职责边界.md 的核心规则（禁止事项清单 + 任务类型决策表）
- 构建 user message：工具名 + 参数摘要（前 500 字符）+ 最近 5 轮对话历史
- 5s 超时 + AbortController
- 验收：单元测试 mock fetch，验证请求 payload（含 system prompt + user message）和正确返回结构；typecheck + test 全绿

### T4. policy.ts — 越界判断逻辑（依赖：T3）

- 实现 `classify(exec, messages): Promise<PolicyVerdict>`
- 解析 classifier 输出（JSON 容错：对象格式/数组格式/纯文本）
- 应用 fallback 策略：
  - 代码类操作 → 强制 `close`（阻断）
  - 诊断/只读类操作 → `diagnosticFallback`（默认 `open`）
  - classifier 异常 → 按上述规则降级
- 输出：`{verdict: 'block'|'allow', reason: string, delegateTo: 'code-agent'|'check-agent'|null, reviewPrompt: string|null}`
- 验收：覆盖正常/异常/空响应三种 case；unit test 验证每种 verdict 行为；全绿

### T5. delegate.ts — 子代理派发逻辑（依赖：T2, T4）

- 实现 `delegate(agent, target, context): Promise<void>`
- 根据 `delegateTo` 字段选择子代理：
  - `code-agent` → 调用 `call_code_agent` 工具（现有 subagent，验证过）
  - `check-agent` → 调用 `call_check_agent` 工具（现有 subagent，验证过）
  - `null` → 不派发，仅注入系统消息说明拦截原因
- **方案评审类**：不直接调用 `call_plan_reviewer`；将 `reviewPrompt` 作为系统提示写入对话，由主 agent 自主决定是否调用
- 通过已有 subagent 工具派发（不使用未验证的 `agent.steer()` / `agent.inject()`）
- 验收：单元测试 mock subagent 工具调用，验证 delegateTo 字段与工具调用的正确映射；typecheck 通过

### T6. cache.ts — 任务类型缓存（依赖：T2）

- 实现 `TTLMap<K, V>` 类（复用 skill-router 的缓存逻辑）
- 缓存 key 格式：`sessionId|messageHash|workspacePath|presetId`（四元组，与 skill-router 一致）
- TTL：10 分钟
- **任务切换刷新逻辑**：每次 pre-execute 时，计算最近一条 user message 的 hash，与缓存 key 中的 messageHash 比对；不一致则清除旧缓存并触发重新分类
- 验收：单元测试验证 TTL 过期、LRU 淘汰、缓存命中、任务切换 hash 变化时强制刷新；全绿

### T7. 主插件 index.ts — 组装全部模块（依赖：T3+T4+T5+T6）

- `apply(ctx, config)`：注册 `tools/pre-execute` 监听器
- 逻辑：
  1. 从 exec 提取 toolName + arguments
  2. 计算最近 user message hash
  3. 查询缓存（key = sessionId|hash|workspacePath|presetId）
  4. 缓存命中 → 直接复用分类结果；缓存未命中或 hash 变化 → 调 classifier → 更新缓存
  5. 调 policy 判断（block/allow + delegateTo）
  6. block → 调 delegate 派发子代理 + 注入系统消息；allow → 调 next() 继续执行
- 验收：typecheck 通过；单元测试 mock 各子模块验证组装逻辑 + 缓存行为

### T8. 端到端集成测试（依赖：T7）

- 写 tests/guard-main-agent.spec.ts：模拟完整 pre-execute 流程
- 验证场景：
  - 场景1：主 agent 尝试 write_file → 被拦截 → 派 call_code_agent
  - 场景2：主 agent 尝试简单诊断（read/grep）→ 允许执行
  - 场景3：classifier 超时 → 代码类 close / 诊断类 open → 日志记录
  - 场景4：任务切换（user message hash 变化）→ 缓存刷新 → 重新分类
- 验收：测试全绿；`pnpm test` 通过

### T9. 用户 preset 挂载 + 文档（依赖：T8）

- 在 `~/.dsh/.agent-presets/full/agent.cordis.yml` 追加 guard-main-agent 插件行
- 写 README.md（配置说明 + 拦截逻辑 + 降级策略 + 与 skill-router 的关系）
- 验收：YAML 语法通过；diff 只改 full preset（备份）

### T10. 人工验收（依赖：T9 + 重启 dsh）

- 打开 DSH Web GUI：
  - 测试1（代码越界拦截）：主 agent 尝试直接 write_file → 应被拦截并派 call_code_agent
  - 测试2（简单诊断自主执行）：主 agent 进行 read/grep 诊断 → 应被允许执行
  - 测试3（降级策略）：模拟 9888 超时 → 代码类 close / 诊断类 open，warning 日志记录
  - 测试4（任务切换刷新）：主 agent 切换任务类型 → 缓存刷新 → 分类结果变化
- 验收：四项均通过，截图留存；CHANGELOG 记录

---

## 四、验收标准（量化，对应立项验收标准 6）

| #   | 标准                                               | 验证方法                                                                                                                                                         |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 主 agent 尝试写代码时被拦截，自动派 code-agent     | Web GUI 发"帮我实现这个功能"→ 日志确认 tool-fs 调用被 deny + call_code_agent 被调用                                                                              |
| 2   | 主 agent 简单诊断（read/grep/lsp）被允许           | Web GUI 发"排查这个 bug"→ tool-fs/read_file 等正常放行执行；若派 code-agent 则拦截触发                                                                           |
| 3   | classifier 失败时，代码类 close / 诊断类 open      | 模拟 9888 超时→ 代码工具调用被阻断，诊断工具调用正常执行，warning 日志记录                                                                                       |
| 4   | 单次分类耗时 < 1s（9888 正常）                     | 计时日志，5 次平均                                                                                                                                               |
| 5   | 现有 preset 功能不受破坏（无回归）                 | 所有既有测试通过（plan-reviewer/code-agent/check-agent 仍可用）                                                                                                  |
| 6   | 拦截决策可追溯（日志含 verdict + reason）          | 查日志确认每次拦截有结构化记录                                                                                                                                   |
| 7   | 插件可配置（endpoint/model/fallback 从 config 读） | 读插件源码确认配置项存在                                                                                                                                         |
| 8   | 任务切换时缓存自动刷新                             | 切换任务后分类结果更新，旧缓存被清除                                                                                                                             |
| 9   | **文件权限拦截生效（D1）**                         | 主 agent 写 docs/test.md → 放行；写 docs/config.yaml → 拒绝（类型限制）；写 ~/.dsh/settings.yaml → 拒绝（不在白名单）；写 .temp/test.ts → 拒绝（禁止可执行脚本） |
| 10  | **symlink 绕过被拦截**                             | 创建指向禁区的 symlink 后尝试写 → deny，日志含 resolvedPath                                                                                                      |
| 11  | **临时例外过期自动失效**                           | 设置 expiresAt 为过去时间，对应文件应被拒绝                                                                                                                      |

---

## 五、风险项

| 风险                                                        | 等级 | 应对                                                          |
| ----------------------------------------------------------- | ---- | ------------------------------------------------------------- |
| T1 POC 发现 hook 点不可行                                   | 高   | 切备选方案（agent/pre-step + 消息预测），计划调整             |
| classifier prompt 误判导致过度拦截                          | 中   | T4 单元测试覆盖边界 case；T10 人工验收迭代 prompt             |
| 缓存不一致（任务切换未及时刷新）                            | 中   | 每次 pre-execute 计算 messageHash 并与缓存比对，不一致则刷新  |
| 子代理派发失败（call_code_agent / call_check_agent 不可用） | 低   | 降级：记录 warning + 放行原调用（diagnosticFallback=open 时） |
| 9888 限流/不稳定                                            | 中   | 5s 超时 + fallback close；日志记录限流事件                    |
| 工具调用参数过大（arguments 超限）                          | 低   | classifier 仅接收参数摘要（前 500 字符），完整参数不进 prompt |

---

## 六、与现有系统的关系

| 组件                              | 关系                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| `skill-router`                    | 互补：skill-router 控制模型看到哪些 skill，guard 控制模型能否调用工具                           |
| `主agent职责边界.md`              | guard 插件的规则来源：禁止事项清单 + 任务类型决策表 + 诊断熔断规则                              |
| `主agent可改写文件清单.md` (v2.1) | **D1 文件权限拦截数据源**：白名单+fail-close，控制主agent可写的文件范围（.temp/已添加类型限制） |
| `主agent可改写文件清单.yaml`      | 结构化配置，供 filePolicy 模块读取                                                              |
| `四道闸闭环操作手册.md`           | guard 插件的执行依据：诊断熔断规则 → 自动派 check-agent                                         |
| `call_code_agent`                 | 代码任务拦截后的派发目标（deepseek-v4-flash）                                                   |
| `call_check_agent`                | 质检/诊断任务拦截后的派发目标（agnes-2.5-flash）                                                |
| `call_plan_reviewer`              | guard 不直接调用；classifier 输出 reviewPrompt，由主 agent 决定是否调用                         |

---

_计划 v1.3：响应主agent清单v2.1修订，核心修正：.temp/类型限制（禁止可执行脚本）、temporaryOverrides时序说明（用户手动编辑）、glob匹配算法补充。_
_下一步：用户确认修订后，按任务列表开始 T1。_
