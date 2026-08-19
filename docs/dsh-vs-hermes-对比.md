# dsh ↔ Hermes 功能对比与可借鉴清单

> 探查时间：2026-08-18。对象：本机 dsh（DeepSeek Harness，Cordis 插件架构）↔ 本机 Hermes（`~/.hermes/hermes-agent/`，Python agent 框架）。
> 目的：找出 dsh 可以移植/借鉴的 Hermes 好功能。

## 一、Hermes 是什么（官方定位）

"个人 AI agent，同一套 agent 核心跑在 CLI、消息网关（约 20 个平台）、TUI、Electron 桌面应用。跨会话学习（记忆+技能）、委派子代理、定时任务、驱动真实终端和浏览器。主要通过插件和技能扩展。"

两大设计原则（决定它的形态）：
1. **per-conversation prompt caching is sacred** — 对话提示缓存神圣，不随意重建上下文
2. **core is narrow waist; capability at edges** — 核心窄腰，能力在边缘（少而精核心工具，能力靠 CLI 命令+技能/插件）

## 二、dsh 已有能力（服务清单，来自 host 服务注册表）

插件架构(Cordis)、事件溯源会话、全文检索(sessionQuery)、审批栈、沙箱、LSP、PTY 终端、web 服务、subagents、workflow、goals、jobs、compaction、settings、credentials、storage、skills、llm 路由、tool pipeline、planMode、userQuestions、webServer、workspaceRegistry。

**一句话**：dsh 的强项在"内核纵深"——沙箱/审批/事件溯源/会话管理/插件化。

## 三、Hermes 独有/更强 —— 可借鉴清单（分级）

### A 级：强烈推荐移植（高价值 + 契合 dsh 架构）

1. **后台评审自动沉淀记忆/技能**（`agent/background_review.py`）
   - 每轮对话后 fork 一个 agent 回放对话快照，自问"该保存/更新什么技能或记忆"？写入直接进记忆+技能库。
   - **关键**：主对话和 prompt cache 从不被触碰；fork 继承父运行环境（同 provider/模型/凭证/缓存）；工具白名单只限记忆/技能管理工具。
   - **对 dsh 的意义**：这是"跨对话持续学习"的工程实现，正是我们 WORKSPACE.md 约定式记忆的自动化升级版。

2. **多平台消息网关**（`gateway/platforms/`）
   - 支持 Telegram / Discord / Slack / 飞书 / Signal / WhatsApp / 微信 / QQBot / Yuanbao / Bluebubbles / Matrix / Mattermost 等。
   - 抽象平台适配器接口 + 路由/投递/镜像/配对/速率限制/音频投递。
   - **对 dsh 的意义**：dsh 没有对外 IM 接入。这是"局域网统一管理 + 多方协作"最可能用到的能力。

3. **OpenAI 兼容 API 服务器**（`gateway/platforms/api_server.py`）
   - 暴露 `/v1/chat/completions`、`/v1/responses`、`/v1/runs`（SSE 事件流）、审批接口、会话 CRUD/fork。
   - 任意 OpenAI 兼容前端（Open WebUI、LobeChat、LibreChat 等）可接；本机已启用 `0.0.0.0:8666`。
   - **对 dsh 的意义**：dsh 有内部 Remote/RPC API 但缺对外标准接入面。这是"让多方客户端接入"的关键架构。

4. **工具循环护栏**（`agent/tool_guardrails.py`）
   - 连续失败 N 次 block、无进展 N 次 halt（默认 5 次）—— 防 agent 卡死/空转。
   - **对 dsh 的意义**：dsh 有 guard/工具限制，但缺这种"循环健康护栏"。

5. **验证证据账本**（`agent/verification_evidence.py`）
   - 记录已验证命令的结果分类（`verification_evidence.db`），完成前必须提供证据。
   - **对 dsh 的意义**：正是 Superpowers verification-before-completion 的工程实现；dsh 的 guard 理念可借鉴其"证据数据库"形态。

### B 级：值得借鉴/改造适配

6. **学习图谱 + 多 provider 记忆**（`agent/learning_graph*.py`、`memory_manager.py`）
   - 知识图谱（learning graph）+ 记忆多 provider 抽象 + nudge 主动记忆 + streaming 上下文擦除。
7. **文件系统检查点/快照**（`~/.hermes/checkpoints/`，git 式 branches/HEAD/hooks/indexes）
   - status/list/prune/clear 命令，工作区快照回滚。dsh 无对等原生功能。
8. **cron 定时任务 + 蓝图目录**（`cron/`）
   - 预置模板：每日简报/每 N 分钟/每周一/工作日/提醒，cron 表达式 + 参数化。
9. **LSP 客户端完备**（`agent/lsp/`）
   - 多语言服务器、自动安装(install_strategy:auto)、诊断收集、eventlog。dsh 刚接 tsserver，可借鉴其多服务器管理。
10. **快捷命令 quick_commands**（中文：/大模型 /快照 /状态 /提供商 /本地模型 等）
11. **会话导出 Markdown/QMD**（`session_export_md.py`）

### C 级：理念参考（可暂缓）

12. 多浏览器 provider / 多搜索 provider（可插拔后端，brave/ddgs/searxng/exa/tavily）
13. TTS/STT/语音（edge/openai/elevenlabs）
14. 看板 kanban（kanban.db）
15. MCP 服务器（hermes_mcp_server.py）
16. 会话状态库 + resume/snapshot
17. 安全审计（security_audit / mcp_security / write_approval / model_cost_guard）
18. 模型多提供商 + 多级 fallback 链 + 在线 model_catalog（13+ 提供商）

## 四、架构对比洞察

- **同源思想**：Hermes goals.py 注释明说 "the Ralph loop for Hermes"，dsh 有 goals 服务 → 两框架都借鉴 Ralph 循环理念，目标管理机制本质相同。
- **理念一致**：Hermes"核心窄腰+能力边缘" = dsh"Cordis 插件化 + skill"。都是"核心薄、能力靠插件/技能"。
- **最大互补**：
  - dsh 内核纵深强（沙箱/审批/事件溯源/会话/插件）
  - Hermes 外围接入强（IM 网关 / OpenAI 兼容 API / 自动记忆 / 多模型 fallback）
  - **最值得移植**：Hermes 的"对外接入面"（API 服务器 + IM 网关）和"自动记忆评审"。

## 五、落地建议（dsh 移植/借鉴路径）

1. **快速可行（不动 dsh 内核）**：让 dsh 的 agent 通过 HTTP 调用本机 Hermes 的 `0.0.0.0:8666` OpenAI 兼容 API —— dsh 作为客户端接入 Hermes，立即获得 Hermes 的多模型能力。作为临时整合路径。
2. **借鉴实现（推荐）**：把 Hermes 的"后台评审自动记忆"作为 dsh 的插件实现（利用 dsh 已有 subagents/goals/skills 能力，fork 会话回放 + 只限记忆工具写库）。
3. **借鉴实现**：OpenAI 兼容 API 服务器作为 dsh 的 host 插件（dsh 已有 webServer/apiProxy，可加对外 /v1 面）。
4. **借鉴实现**：工具循环护栏 + 验证证据账本（dsh 已有 tools.guard，可加健康护栏与证据记录）。
5. **远期**：IM 网关（若需微信/飞书/Telegram 接入，需较大工程，可先做单平台）。

> 注意：dsh 与 Hermes 是不同语言（TS vs Python），"移植"指借鉴设计/理念并以 dsh 插件形式重新实现，非直接搬运代码。

## 六、集成面子代理深度发现（网关/定时/看板/MCP/ACP/插件/钩子）

### 6.1 消息网关（gateway/）—— dsh 最值得抄的四件套
- **平台清单**：Telegram/Discord/WhatsApp/Slack/Signal/Mattermost/Matrix/HomeAssistant/Email/SMS/钉钉/飞书/企业微信/微信/BlueBubbles/QQ/元宝/API server/Webhook/MSGraph，另 plugins/platforms/ 下有 IRC/LINE/Teams/Google Chat/ntfy 等。
- **BasePlatformAdapter 能力位抽象**（platforms/base.py）：仅 4 个抽象方法（connect/disconnect/send/get_chat_info）+ 布尔能力标志（splits_long_messages/supports_async_delivery 等）取代 per-platform 分支 → **多平台接入范式**。
- **platform_registry 插件自注册 + 延迟加载**：重型 SDK 延迟到首次使用才 import，核心零硬编码。
- **DeliveryTarget DSL**（delivery.py）：`origin|local|platform|platform:chat|platform:chat:thread` 一套字符串表达所有投递目标。
- **channel_directory + 名称解析 + 别名**：让 agent 用名字而非 ID 发消息。
- **delivery_ledger + dead_targets**：后台投递 at-least-once + 崩溃恢复 + 死目标自愈 —— dsh 后台任务最缺的可靠性环。
- **RelayAdapter + CapabilityDescriptor**：一个适配器前端 N 平台的终极解耦。
- **mirror.py**：主动投递写回会话 transcript，保持接收侧上下文连续。
- **pairing.py**：未知用户用一次性 8 字符码，owner CLI 审批授权（无歧义字母表、1h 过期、限流、5 次失败锁定、chmod 0600）。
- **profile_routing.py**：guild→channel→thread 分层路由到不同 profile/persona。
- **stream_consumer.py**：同步 agent 回调 → 异步队列 → 缓冲/节流 → 单条消息渐进编辑（Telegram/Discord/Slack 通用）。
- **webhook.py**：通用 webhook 平台（HMAC/限流/幂等），`deliver=` 回传目标、`deliver_only` 纯转发零 LLM。

### 6.2 定时任务（cron/）
- jobs.py：per-profile 存储 + croniter + 跨进程文件锁 + **claim_dispatch 分布式认领**（机器 ID/heartbeat/TTL）。
- scheduler.py：60s ticker + 并行/顺序线程池 + deliver= 投递 + **continuable cron**（回复可续同一上下文）。
- scheduler_provider.py：触发 provider 可插拔；blueprint_catalog.py：自动化蓝图模板。

### 6.3 看板（kanban）
- SQLite 任务看板，**WAL+BEGIN IMMEDIATE+CAS** 实现多进程抢任务（无需分布式锁）；多 board/多 profile 协作原语；dispatcher→worker 子进程 + 失败熔断 + goal_mode（Ralph 式目标循环）+ block_recurrences 反死循环。
- worker 必须以 kanban_complete/kanban_block 结尾，否则注入 nudge 防协议违规。

### 6.4 MCP（双向）
- **客户端**：tools/mcp_tool.py 以 stdio/HTTP/SSE 连外部 MCP server、注册工具、OAuth 2.1+PKCE。
- **服务器**：`~/.hermes/hermes_mcp_server.py`（用户自建）把 terminal/read_file/memory/skill_manage/cronjob 等 10 个能力暴露成 MCP 工具。

### 6.5 ACP（双向 agent 对接）
- **服务器侧** acp_adapter/：实现 acp.Agent，让 Zed/VS Code 把 Hermes 当 agent 连（session CRUD/fork/resume、approval、模型选择、ACP 会话注入 MCP）。
- **客户端侧** agent/copilot_acp_client.py：把 Copilot --acp 当 OpenAI 兼容后端；delegate_task 派生 ACP 子代理。

### 6.6 插件系统
- PluginContext 注册式扩展（register_tool/platform/browser_provider/hook/middleware/skill/secret_source）；4 来源（bundled/user/project/pip），同名后者覆盖；约 30 个生命周期钩子（pre/post_tool_call、transform_llm_output、pre_verify、pre/post_approval_request…）。
- plugin_llm.py：插件 LLM 门面，宿主统一路由/鉴权，插件见不到 token。
- apps/desktop：Electron 桌面（renderer 不直触 Node，agent 逻辑在 gateway 侧）。

### 6.7 钩子
- ~/.hermes/hooks/<name>/HOOK.yaml+handler.py，支持 command:* 通配、同步+异步、emit_collect 决策型。
- shell_hooks.py：shell 脚本钩子桥，JSON stdin/stdout 协议、首用同意 allowlist、shell=False 防注入。

### 集成面"最值得抄"结论
**BasePlatformAdapter 能力位、DeliveryTarget DSL、channel_directory、delivery_ledger** 四件套 + **ACP/MCP 双向** + **kanban CAS 分发**。

## 七、核心功能面（记忆/技能/上下文/子代理/验证）—— 深度读码分析

> 本节省略了一些易误读文件的澄清：learning_graph 非持久化图谱、process_bootstrap 非子进程、auxiliary_client 是辅助 LLM 路由（非子代理客户端）、真正的子代理是 tools/delegate_tool + async_delegation（同进程线程池）。

### 7.1 记忆系统（有界 Markdown + 可插拔 provider + 后台评审）
- **内置记忆 = 有界字符预算的 Markdown 文件**：MEMORY.md / USER.md，§ 分隔，原子写，冻结快照注入（系统提示内）。
- **外部可插拔 MemoryProvider**（memory_provider.py）：单一实例、后台串行写入、prefetch/nudge/sync_turn。
- **后台评审自动沉淀**（background_review.py）：每轮 fork agent 回放对话，自问"该存什么技能/记忆"，只限记忆/技能工具写库，不碰主对话和 prompt cache。
- **curator**：确定性技能生命周期状态机（active/stale/archived，只归档不删除）+ 可选 LLM 伞级化巩固。
- **学习图谱**（learning_graph.py）：按需从 SKILL.md frontmatter + usage.json + MEMORY.md/USER.md §块推导的只读可视化（词法连边），非持久化图库。
- **对 dsh 的意义**：dsh 用 WORKSPACE.md 约定式记忆；Hermes 的"有界 Markdown + 冻结快照 + 后台评审"是零依赖自动升级方向。

### 7.2 上下文引擎（抽象接口 + 反抖水位线）—— 最值得移植
- **ContextEngine 抽象接口**（context_engine.py:56-263）：`update_from_response / should_compress / compress` 契约，可插件替换（如 LCM）。
- **ContextCompressor**：token 水位线 `(context_length - max_tokens) × 0.75`；**反抖防死循环**——真实 usage 判定有效性 + 连续 2 次无效压缩退避 + 摘要 LLM 600s 冷却；保护头尾 + **锚点不变量**（最近真实 user/assistant 消息必在尾部、切点绝不切工具组）；结构化摘要模板 + **REFERENCE-ONLY 前缀**（明示"只响应摘要之后的用户消息"，防旧任务当新指令）+ 迭代式更新；降级路径 + 孤儿工具清理。
- **conversation_compression**：SQLite 压缩锁防并发分叉 + 就地压缩 vs 轮转切新 session_id。
- **prompt_caching**：`system_and_3` 布局（system+最近3条共4断点，多轮成本降约 75%）。
- **context_references**：@file/@folder/@git/@url 并发展开 + 25%/50% 软硬注入水位线 + 凭据 deny-list fail-closed。
- **context_breakdown**：8 类构成统计（揭示 system prompt + 工具 schema 是不可压缩地板）。
- **对 dsh 的意义**：dsh 有 compaction 服务；Hermes 的"反抖水位线（消灭压缩完仍超限→空转）+ 锚点不变量（任务不丢）"是 dsh compaction 可借鉴的健壮性设计。

### 7.3 技能系统（SKILL.md + bundle + 预处理）
- SKILL.md（frontmatter）+ skill bundle（YAML 别名，bundle 优先）。
- 预处理：模板变量 + 内联 `!`shell 展开（4000 字符上限）。
- slash 命令 + 叠加命令；skill_commands / skill_utils 管理。
- **对 dsh 的意义**：dsh 有 skills 服务；Hermes 的"模板变量 + 内联 shell"是技能灵活性的借鉴点。

### 7.4 工具执行（三层闸门 + 注入防护 + 护栏）
- **三层拦截闸门**（tool_executor.py:241/:290/:454-520）：Tool Search 作用域门 + 插件请求中间件 + 护栏 before_call（均在 checkpoint 前）；write_file/patch 先文件 checkpoint。
- **`<untrusted_tool_result>` 间接注入防护**（:457-630）：web/mcp/browser 输出包定界符明示"视为 DATA"、去势伪造定界符（改语义而非正则，架构级防御）。
- **分段并行规划器**（tool_dispatch_helpers.py:105-204）：交互工具→屏障；路径型工具按**规范路径前缀重叠**（realpath 解符号链接）判定并发。
- **三层预算截断**：per-result（100K，按上下文15%缩放）→ 超限写沙盒文件返回 `<persisted-output>` 预览 → per-turn 聚合 200K。
- **护栏=循环熔断**（tool_guardrails.py）：**allow/warn/block/halt 四值** + 工具名+规范化参数 sha256 签名（不存原文）+ 幂等按结果哈希判无进展。
- **失败判定单一权威**：display.py:1267 的 `_detect_tool_failure`，护栏刻意镜像保证口径一致；`file_mutation_result_landed` 证明写入真的落地。
- **分层安全**：循环熔断（guardrails）/ 路径沙箱（file_safety.py）/ 命令启发式（tool_dispatch_helpers.py:64-89）/ 插件门各自独立成层。
- **对 dsh 的意义**：dsh 有 tools.guard；Hermes 的"`<untrusted_tool_result>` 注入防护 + 分段并行规划器 + 护栏四值签名哈希"是 dsh 工具管线可借鉴的安全/并发设计。

### 7.5 验证（被动证据账本 + 完成门）
- **证据自动采集，不靠模型自述**：terminal 命令执行后自动入库（terminal_tool.py:2857-2873）、文件写成功后 mark_workspace_edited（file_tools.py:1538-1569）。
- **verification_evidence**：sqlite 账本（command/canonical/kind/scope/status/exit_code/output_summary）；**stale 新鲜度失效**——编辑晚于最后证据即失效（"证据必须新鲜，不只是存在"）；无规范命令时兜底识别 `/tmp` 下 `hermes-verify-` 前缀脚本。
- **完成门**（verification_stop.py）：surface-aware（编码表面默认 ON、消息平台默认 OFF）+ **文档类编辑豁免**（.md/README/LICENSE）+ 有界重试 ≤2 次。
- **pre_verify 钩子**（verify_hooks.py）：用户/插件/Shell 可注册，`max_verify_nudges=3` 防死循环。
- **对 dsh 的意义**：Superpowers verification-before-completion 的机制化落地；"数据/策略分离（被动账本 vs 完成门）+ stale 新鲜度"是 dsh guard 可借鉴的形态。

### 7.6 子代理（同进程线程池 + 成本上卷）—— 事实纠正
- **真正的子代理**：tools/delegate_tool.py + tools/async_delegation.py —— **同进程 DaemonThreadPoolExecutor 线程**（非子进程、非 RPC），父线程构造子 AIAgent，DELEGATE_BLOCKED_TOOLS 逻辑隔离（禁递归委派/memory/send_message/execute_code/cronjob），成本逐层上卷进父 session_estimated_cost_usd（:2213-2225）。
- 角色：leaf（不可再委派）/ orchestrator（可委派，受深度上限）；max_concurrent_children=3、spawn 深度；工具集收窄=父∩子；线程内 auto-deny 审批回调。
- **触发规则**（run_agent.py:6305-6335）：**顶层模型委派强制后台**（结果异步回投）、orchestrator 子代理的委派保持同步（当场汇总）。
- 可靠性：心跳 + (tool, iteration) 陈旧检测（:1831-1908）、0-API 超时 dump 线程栈。
- **摘要预算**：子代理返回摘要按父剩余上下文动态截断、全文落盘（:1696-1788）防父上下文爆炸。
- **后台异步池**（async_delegation.py）：拒绝式容量策略（满即拒不排队）、SQLite 持久化 + owner_pid 崩溃恢复 + delivery claim 幂等回投。
- **对 dsh 的意义**：dsh 有 subagents 服务；Hermes 的"成本上卷 + 摘要预算 + 心跳陈旧检测 + 顶层后台/编排者同步路由"是 dsh 子代理治理可借鉴的。

### 7.7 目标/模型（Ralph 同源 + 多 provider fallback）
- goals.py：注释明说 "the Ralph loop for Hermes" —— 与 dsh goals 服务同源思想（跨轮次目标、每轮 judge 判定、/subgoal 完成契约）。
- 模型面：13+ provider + 多级 fallback 链 + 在线 model_catalog（1h TTL 动态发现）。
- **对 dsh 的意义**：dsh 有 llm 服务；Hermes 的"多级 fallback + 在线 catalog"是 dsh 模型路由可借鉴的鲁棒性。

### 7.8 核心面"最值得移植"TOP 10（6 子代理并行 + 逐行读码双重验证）
1. **ContextEngine 抽象 + 反抖水位线**（上下文管理插件化）
2. **压缩边界锚点不变量**（压缩不破坏关键上下文）
3. **被动证据账本 / 策略门分离 + stale 新鲜度**
4. **`<untrusted_tool_result>` 注入防护**
5. **分段并行规划器**（规范路径重叠判定）
6. **护栏决策枚举 + 签名哈希**
7. **技能/记忆"有界 Markdown + 冻结快照"零依赖持久化**
8. **curator 快照→执行→对账→报告→可回滚 模板**
9. **子代理成本上卷 + 摘要预算**
10. **prompt_caching `system_and_3` 布局**
