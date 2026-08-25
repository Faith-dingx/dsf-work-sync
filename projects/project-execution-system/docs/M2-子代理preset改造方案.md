# M2 双 Agent 协作流：子代理「按 preset 组合」改造方案

> 日期：2026-08-20　所属：项目全流程执行保障系统 · M2（双 Agent 协作，子系统 2）
> 状态：**方案待用户确认**（尚未实施）
> 目标模式：主 agent 编排 + `call_code_agent`/`call_check_agent` 全自动跑真 code-agent/check-agent preset（精确工具集 + 硬规则 + 独立模型 go/agnes）

## 一、为什么需要这次改造（现状差距）

现状 `call_code_agent` 已能 spawn 子代理并指定 go 模型（`agentOptions: opencode-go/deepseek-v4-flash`），但：

| 维度   | 现状（spawn 继承）                           | 目标（真 preset）                                 |
| ------ | -------------------------------------------- | ------------------------------------------------- |
| 工具集 | 继承 full preset 全部工具（含管理类，偏杂）  | code/check preset 精确裁剪                        |
| 规则   | 调用时 prompt 传 persona，模型可能不严格遵守 | preset 写死的硬规则（TDD/小步/门禁/熔断），绕不过 |
| 上下文 | 继承主会话部分上下文                         | 完全独立                                          |

差距的本质：`child-agent.ts:168` 把子代理 preset 来源写死为 `composeFrom(childCtx, parent.ctx)`——永远继承父 preset。

## 二、机制探查结论（可行性依据）

dsh 已具备改造所需全部底层能力：

1. **preset 预挂载**：`agentPresets.standingKeyFor(presetId)`（`packages/preset/agent-presets/src/index.ts:485`）可把任意 preset 组合为常驻 standing mount（组合插件但**不启动 agent/会话/回合**），返回该 preset 的 standing `ScopeKey`。
2. **scope 绑定公开 API**：`bindScopeParent(key, parent)`（`packages/core/scope/src/index.ts:72`）——把子 agent 的 scope key 的 parent 指向目标 standing key，即"加入该 preset"。
3. **composeFrom 内部实现即此绑定**：`composeFrom` = `bindScopeParent(agentKey, standing.key)` + 返回 `standing.presetId`。当前只是从 `parentCtx` 取 standing，改为"从 presetId 取的 standing"即可。
4. **同步/异步边界**：`applyChildComposition` 在子代理创建的**同步 setup** 里执行，而 `standingKeyFor` 是**异步**的。改造点在创建流程的**异步阶段**（`agents.create` 之前）先 `await standingKeyFor(presetId)`，把得到的 `ScopeKey` 传入同步 setup。
5. **两条子代理路径都走同一入口**：
   - spawn 一次性：`startInProcessRun`（`subagent-in-process-driver/src/index.ts:102`，async，setup 在 `agents.create` 里）
   - continuable 可续：`continuation.ts:1065`（setup 同样调 `applyChildComposition`）
   - 两条都需支持 presetId。

## 三、改造设计

### 数据流

```
tool-subagent Config.presetId?          ← [改] tool-subagent/src/index.ts
  └─ execute 构造 request 加 presetId     ← [改] 同上
ctx.subagents.start({ provider, request })  ← request: SubagentStartRequest 加 presetId [改] types.ts
spawn provider start(request) → startInProcessRun(request)   ← 无需改，透传
startInProcessRun（async）:
  if (request.presetId) { presets.standingKeyFor(presetId) → standingKey }  ← [改] in-process-driver
  setup(childCtx):
    applyChildComposition(childCtx, parent, {persona, toolFilter}, standingKey)  ← [改] child-agent.ts
      ├─ 有 standingKey → presets.composeStanding(childCtx, standingKey)      ← [改] agent-presets/index.ts
      │                  （bindScopeParent 到目标 standing；返回 key.agentPreset 记入 meta）
      └─ 无 standingKey → 原 composeFrom(childCtx, parent.ctx)（向后兼容）
agents.create({ meta: childSessionMeta(..., presetId), agentOptions: resolveChildAgentOptions(...) })
```

continuable 路径（`continuation.ts`）完全同构：`startContinuable` 的 request 加 presetId → async 阶段 standingKeyFor → setup 传。

### 改动文件清单（6 个源码 + 测试 + 文档）

| #   | 文件                                                        | 改动                                                                                                                                                                          |
| --- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `packages/subagent/tool-subagent/src/index.ts`              | Config 加 `presetId?: string`；execute 构造 request 时透传；README 说明                                                                                                       |
| 2   | `packages/subagent/subagent/src/types.ts`                   | `SubagentStartRequest` 加 `readonly presetId?: string`                                                                                                                        |
| 3   | `packages/subagent/subagent-in-process-driver/src/index.ts` | async 阶段 `standingKeyFor`；setup 闭包传入 standingKey；`childSessionMeta` 传 presetOverride                                                                                 |
| 4   | `packages/subagent/subagent/src/child-agent.ts`             | `applyChildComposition` 增可选 `presetStandingKey` 参数（有则走 composeStanding）；`childSessionMeta` 增 `presetOverride?`（meta.agentPreset 记录目标 preset，冷读/恢复正确） |
| 5   | `packages/subagent/subagent/src/continuation.ts`            | continuable 路径同构处理（resume/create 共用 setup）                                                                                                                          |
| 6   | `packages/preset/agent-presets/src/index.ts`                | 新增同步方法 `composeStanding(agentCtx, standingKey: ScopeKey): string`（bindScopeParent + 返回 `(standingKey as { agentPreset: string }).agentPreset`）                      |
| 7   | 测试                                                        | `tool-subagent.spec.ts` / `continuation.spec.ts` 增：presetId 生效、presetId 不存在报错、向后兼容（省略=原行为）                                                              |
| 8   | 文档                                                        | `tool-subagent/README.md`、`docs/CHANGELOG.md`                                                                                                                                |

### 边界情况

| 情况                               | 处理                                                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| presetId 省略                      | 完全原逻辑（向后兼容，现有所有调用不受影响）                                                                |
| presetId 不存在                    | `standingKeyFor` 抛 `UnknownPresetError` → 子代理创建失败，报错明确                                         |
| preset 组合损坏                    | `PresetMountError` → 创建失败                                                                               |
| presetId + persona/toolFilter 同传 | target preset 自带 persona/工具集，调用方 persona 作 shadow 覆盖、toolFilter 与之 intersect（沿用现有机制） |
| 子代理再 spawn                     | 其 parent = 该子代理自身，自动继承其 preset（code 子代理再派发 → code preset），无需额外处理                |
| 独立模型                           | `agentOptions.provider/model` 指定（已支持，本次不变）                                                      |
| standingKeyFor 首次异步 mount 慢   | 单次开销，standing 常驻复用（后续 spawn 零开销）                                                            |

## 四、验证方案

1. **单测**：presetId 生效（子代理 runningPreset == 目标 preset）、不存在报错、省略向后兼容
2. **集成实测**：配置 `call_code_agent` 加 `presetId: code-agent`，实际派发一个编码任务，验证子代理工具集为 code-agent 裁剪集（无管理类工具）、persona 为 code-agent 硬规则、模型为 opencode-go
3. **回归**：`typecheck + lint` 全绿；subagent 相关测试全过；现有 `call_check_agent` 无 presetId 行为不变

## 五、风险与对策

| 风险                                         | 对策                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| 改 subagent 核心，影响所有 spawn             | 向后兼容设计（省略=原行为）+ 完整测试覆盖                                       |
| `applyChildComposition` 签名变更波及两条路径 | 参数可选（默认 undefined），调用方不传不变                                      |
| 同步/异步边界错误（standing 未就绪就 setup） | standingKeyFor 在 `agents.create` 之前的 async 阶段完成，setup 同步闭包只读 key |

## 六、分步实施

1. **Step 1**：`agent-presets` 新增 `composeStanding`（纯新增，低风险）→ 单测
2. **Step 2**：`types.ts` + `tool-subagent` 加 `presetId`（数据面）→ typecheck
3. **Step 3**：`child-agent.ts` + `in-process-driver` + `continuation.ts` 接线（核心）→ 单测 + 集成实测
4. **Step 4**：全量回归（typecheck/lint/subagent 测试）→ 提交
5. **Step 5**：配置 `call_code_agent`/`call_check_agent` 加 `presetId`，GUI 实测闭环

## 七、后续（可选，不在本次范围）

- Agent Teams（rc.8 官方多 agent 编排：teammate/消息/任务板/等待）作为编排层增强——teammate 同样通过 `startContinuable` 创建，本次改造的 presetId 可让 teammate 也用上真 preset（两者天然兼容）
- 配置层：`--trusted-host` 之外的 preset 选择（GUI 会话启动选 preset 已支持，不涉及）
