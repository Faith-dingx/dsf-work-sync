# 实施计划 v2：skill-router（能力路由）子系统

> 日期：2026-08-20 | 状态：P1 规划（v2，响应 plan-reviewer 7 点修订）| 只规划不实施

---

## 一、设计决策（对 5 个待讨论问题的明确建议）

### 决策 1：触发时机 — **任务开始一次性分类 + 消息变更重分类**

- 选择：监听 `agent/pre-step` 事件，仅在以下情况调 classifier 一次：
  1. 新用户消息到达且内容不同于上一轮（**判定条件**：session events 末尾 user message 文本 hash 变化，或显式 `/reset` 命令）
  2. 用户主动 `/reset` 重置会话
- 同任务内后续轮次（连续 assistant/user 对话）**复用缓存结果**，不做重复调用
- 权衡：每轮调用 = 每次请求多一次 LLM 开销（~0.1-0.3s + token），对计划/文档对话浪费明显；消息变更时分类 = 一次调用覆盖一轮，成本最低
- 实现：classifier() 入参包含当前用户消息文本 + workspace 根路径 + preset id（用于上下文感知）

### 决策 2：辅助模型调用方式 — **独立 HTTP POST + 可配置降级策略**

- 选择：直接 POST 到 9888 `/v1/chat/completions`（model: agnes-2.5-flash），不走 ctx.llm（preset 层无统一 LLM）
- 实现：插件内部封装 `callClassifier(text: string, context): Promise<SkillFilterResult>`，带 5s 超时
- **降级策略（关键修订）**：**fail-close**（而非 fail-open）—— classifier 失败时注入**空 catalog**（或仅注入基础安全 skill：tool-read），记录 warning 日志。**宁可少注入也不能破坏"源头隔离"语义**，隔离目标优先于可用性。提供配置项 `fallback: 'close' | 'open' | 'minimal'`（默认 close）
- **9888 配置来源**：从挂载配置读取 `config.classifierEndpoint`（默认 `http://10.10.10.2:9888/v1/chat/completions`）+ `config.classifierModel`（默认 `agnes-2.5-flash`），**不硬编码**

### 决策 3：输出粒度与格式 — **JSON 字符串，强容错**

- 输出格式：纯 JSON，形如 `{"included": ["skill-a", "skill-b"], "reason": "..."}` 或简化版 `["skill-a", "skill-b"]`
- 容错：解析失败 → 回退 fallback 策略（默认空 catalog）；只含无关字段 → 忽略；空数组 → 注入空 catalog
- 判断输入：当前用户消息文本（最近 2000 字符）+ workspace 根路径 + 当前 preset id

### 决策 4：与 full preset 关系 — **过滤叠加，不影响 baseline**

- 策略：skill-router 不替换 preset，而是在 preset 提供的 catalog 之上加一层过滤
- 行为：full preset 继续挂载所有 skill（tool-fs/tool-bash/subagent 等），skill-router 只控制"哪些 skill 出现在 catalog 里给模型看到"
- 安全性：filtering 是视图层面，底层 skill 注册不被篡改，调试/回退都简单

### 决策 5：挂钩点 — **agent/pre-step 事件 + skill-catalog 消息替换**

- 位置：在 `@deepseek-ai/dsh-tool-skill` 的 pre-step 监听器之后运行（注册顺序控制），在渲染 catalog 前用 filtered entries 替换原始 entries
- 机制：监听 `agent/pre-step`，拿到 decision.messages，定位 source.kind === 'skill-catalog' 的消息，将其 entries 替换为 filtered 结果；若尚未有 catalog 消息则插入新消息
- **前置 POC**：T0.5 专门验证此 hook 点可行性（见任务列表）
- 替代方案（备选）：注册 custom `skills` provider 层，在 snapshot() 层面做过滤——更干净但侵入更深

### 决策 6：System Prompt 设计（关键新增）

classifier 的效果 100% 取决于 prompt 质量，必须明确设计：

```
SYSTEM PROMPT（固定，硬编码）：
You are a skill router for a project execution system. Given a user message and workspace path,
decide which skills should be injected into the model's context.

Available skills (full list from preset):
- tool-fs: 文件读写
- tool-fs-search: 文件搜索
- tool-bash: 终端执行
- tool-lsp: 代码智能
- tool-subagent: 子代理派发
- tool-skill: 技能加载
- tool-str-replace-editor: 精准编辑
...（从 preset catalog 动态获取完整列表）

Rules:
- If user message is about planning/writing docs/config → include only: tool-fs, tool-fs-search, tool-session-query, tool-str-replace-editor, tool-skill
- If user message is about coding/implementing → include all code-related skills (tool-fs, tool-bash, tool-lsp, tool-subagent, tool-skill, tool-str-replace-editor)
- If user message is ambiguous → default to minimal set (tool-fs, tool-skill)

Output: JSON array of skill names only, e.g., ["tool-fs", "tool-skill"]
```

- 分类指令示例 + few-shot：在 classifier prompt 里包含 3 对 task→skill 匹配示例
- skill 列表：从 preset catalog 动态获取（不硬编码），保证扩展性

---

## 二、文件结构

```
/home/dingx/DSF-work/packages/skill-router/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # 插件入口（apply 函数，注册 pre-step 监听）
│   ├── classifier.ts     # 辅助模型调用封装（HTTP POST 到 9888）
│   ├── filter.ts         # 分类结果解析 + 容错逻辑
│   ├── injector.ts       # skill-catalog 消息拦截与替换
│   └── types.ts          # 类型定义
└── tests/
    └── skill-router.spec.ts  # 核心逻辑测试

挂载位置：用户 preset 的 agent.cordis.yml 追加行（配置从外部读取，不硬编码）：
- id: skill-router
  name: '@dsf/skill-router'
  config:
    classifierEndpoint: 'http://10.10.10.2:9888/v1/chat/completions'
    classifierModel: 'agnes-2.5-flash'
    fallback: 'close'  # 可选：'close' | 'open' | 'minimal'，默认 close
```

---

## 三、bite-sized 任务列表

### T0.5. POC 验证 hook 点可行性（依赖：无）⭐ 新增

- 读 `/home/dingx/deepseek-harness/packages/skill-router/...` 和 `dsh-tool-skill/src/index.ts` 源码，确认：① `agent/pre-step` 事件参数类型 ② `source.kind === 'skill-catalog'` 是否真实存在 ③ catalog 消息插入位置
- 写小脚本验证 hook 点可触达
- 验收：**POC 报告**（含源码引用行号 + 结论：hook 可行/不可行）+ typecheck 通过
- 若 hook 不可行 → 切换到备选方案（provider 层过滤），计划相应调整

### T1. 项目脚手架（依赖：T0.5 POC 通过）

- 在 `packages/skill-router/` 创建 package.json + tsconfig.json + src/index.ts 骨架
- 验收：`pnpm tsc --noEmit` 通过（零报错）

### T2. classifier.ts — 辅助模型调用封装（依赖：T1）

- 实现 `callClassifier(userMessage, context): Promise<SkillFilterResult>`
- 从 config 读取 endpoint + model + fallback；5s 超时；降级走 fallback 策略
- 验收：单元测试 mock fetch，验证请求 payload（含 system prompt + user message + few-shot）和正确返回结构；typecheck + test 全绿

### T3. filter.ts — 结果解析 + 容错（依赖：T2）

- 实现 `parseFilterResult(raw, fallback): SkillFilterResult`
- 支持 JSON 数组 + 对象两种格式；解析失败 → 回退 fallback（close/open/minimal）
- 验收：覆盖正常/异常/空响应三种 case 的单元测试；全绿

### T4. injector.ts — catalog 消息拦截替换（依赖：T1，结合 T0.5 结论）

- 实现 `interceptCatalog(messages, filteredNames): messages`
- 定位 skill-catalog 消息，替换 entries；无 catalog 消息时插入新条目（参照 T0.5 确认的位置）
- 验收：单元测试 mock messages 数组，验证 entries 被正确替换；typecheck 通过

### T5. 主插件 index.ts — 组装全部模块（依赖：T2+T3+T4）

- `apply(ctx, config)`：注册 `agent/pre-step` 监听器
- 逻辑：检测新任务（用户消息 hash 变化或 reset）→ 调 classifier → 调 filter → 调 injector → 返回修改后 messages
- **缓存**：四元组 key `(session_id, message_hash, workspace_path, preset_id)`；TTL 5 分钟；LRU 淘汰（最多 100 条）
- 验收：typecheck 通过；单元测试 mock 各子模块验证组装逻辑 + 缓存行为

### T6. 端到端集成测试（依赖：T5）

- 写 tests/skill-router.spec.ts：模拟完整 pre-step 流程
- 验证：①聊计划时 skill-catalog 不含代码类 skill ②做代码任务时 catalog 包含相关 skill
- 验收：测试全绿；`pnpm test` 通过

### T7. 用户 preset 挂载 + 文档（依赖：T6）

- 在 `~/.dsh/.agent-presets/full/agent.cordis.yml` 追加 skill-router 插件行（参照 tool-subagent-* 块格式）
- 写 README.md（配置说明 + 降级策略）
- 验收：YAML 校验通过；diff 只改 full preset（备份）

### T8. 人工验收（依赖：T7 + 重启 dsh）

- 打开 DSH Web GUI：
  - 测试1（隔离生效）：发"帮我写个计划"，用 cordis inspect 或日志确认 skill-catalog 不含 tool-bash/tool-lsp/subagent
  - 测试2（不影响代码任务）：发"帮我改这个文件"，确认 tool-fs/tool-bash 仍在 catalog
  - 测试3（降级策略）：模拟 9888 超时，确认 fallback 生效（catalog 为空或 minimal）
- 验收：三项均通过，截图留存；CHANGELOG 记录

---

## 四、验收标准（量化，对应立项验收标准1）

| #   | 标准                                                         | 验证方法                                                                     |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | 聊计划/文档时，不被注入代码 skill（tool-bash/lsp/subagent）  | Web GUI 发"写个计划"→ cordis inspect 或日志确认 skill-catalog 无代码类 skill |
| 2   | 做代码时，相关辅助自动可用                                   | Web GUI 发"改这个文件"→ catalog 含 tool-fs/tool-bash                         |
| 3   | classifier 失败时不阻断流程（fallback 生效）                 | 模拟 9888 超时→ 系统回退 fallback 策略，对话正常                             |
| 4   | 单次分类耗时 < 2s（9888 正常）                               | 计时日志，5 次平均                                                           |
| 5   | 现有 preset 功能不受破坏（无回归）                           | 所有既有测试通过（plan-reviewer/code-agent/check-agent 仍可用）              |
| 6   | 插件可配置（endpoint/model/fallback 从 config 读，不硬编码） | 读插件源码确认配置项存在                                                     |

---

## 五、风险项

| 风险                                     | 等级 | 应对                                                        |
| ---------------------------------------- | ---- | ----------------------------------------------------------- |
| T0.5 POC 发现 hook 点不可行              | 高   | 切备选方案（provider 层过滤），计划调整                     |
| classifier prompt 分类不准导致漏/过注入  | 中   | T2 单元测试覆盖 few-shot；T8 人工验收迭代 prompt            |
| fail-close 降级导致部分对话无 skill 可用 | 低   | 可配置 fallback：close（默认）/open/minimal；用户按需求选择 |
| 缓存一致性（workspace 切换）             | 低   | TTL 5min + 四元组 key 包含 workspace_path                   |
| 9888 限流/不稳定                         | 中   | 5s 超时 + 重试 1 次（仅 1 次）；降级 fallback               |

---

_计划 v2 修订：响应 plan-reviewer 7 点评审，核心修订：fail-open→fail-close、补充 System Prompt 设计、拆分 T0.5 POC、缓存机制完善、配置从 config 读、验收标准量化_
_下一步：派 plan-reviewer 复审 v2_
