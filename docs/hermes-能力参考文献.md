# Hermes 能力探查参考文献（dsh 可借鉴功能全景）

> **用途**：这是"dsh 借鉴 Hermes 功能"的长期参考文献。工作推进中需要加功能时，先查这份文档找对应条目。
> **探查时间**：2026-08-18。**对象**：本机 Hermes `~/.hermes/hermes-agent/`（NousResearch/hermes-agent @ main f4df260f，Python agent 框架）。
> **方法**：作者第一手探查 + 2 个深度子代理（集成面/核心面），核心面子代理又用 6 个并行子代理深挖 + 逐行读码双重验证。全部只读。
> **注意**：dsh 是 TypeScript/Cordis，Hermes 是 Python。"移植"= 借鉴设计理念，以 dsh 插件形式重新实现，非搬运代码。

---

## 目录

1. [Hermes 是什么](#一hermes-是什么)
2. [dsh 已有能力对照](#二dsh-已有能力对照)
3. [集成面：消息网关](#三集成面消息网关gateway)
4. [集成面：定时任务 cron](#四集成面定时任务-cron)
5. [集成面：看板 kanban](#五集成面看板-kanban)
6. [集成面：MCP / ACP 双向](#六集成面-mcp--acp-双向)
7. [集成面：插件系统 / 桌面 / 钩子](#七集成面插件系统--桌面--钩子)
8. [核心面：记忆系统](#八核心面记忆系统)
9. [核心面：技能系统](#九核心面技能系统)
10. [核心面：上下文与压缩](#十核心面上下文与压缩)
11. [核心面：子代理与委派](#十一核心面子代理与委派)
12. [核心面：工具执行](#十二核心面工具执行)
13. [核心面：验证与证据](#十三核心面验证与证据)
14. [可借鉴功能总表（含优先级）](#十四可借鉴功能总表含优先级)
15. [架构洞察与落地路径](#十五架构洞察与落地路径)

---

## 一、Hermes 是什么

官方定位（来自仓库 AGENTS.md）：
> "个人 AI agent，同一套 agent 核心跑在 CLI、消息网关（约 20 个平台）、TUI、Electron 桌面应用。跨会话学习（记忆+技能）、委派子代理、定时任务、驱动真实终端和浏览器。主要通过插件和技能扩展。"

**两大设计原则**（决定它的形态）：
1. **per-conversation prompt caching is sacred** — 对话提示缓存神圣，不随意重建上下文（长对话复用缓存前缀省成本）。
2. **core is narrow waist; capability at edges** — 核心窄腰，能力在边缘：核心工具少而精（每加一个核心工具都进每次 API 调用），新能力以 CLI 命令+技能/插件/服务门控工具的形式加入。

**架构概览**：
- 前端面：CLI（`cli.py` 74 万字符）/ TUI / 消息网关 / Electron 桌面 / OpenAI 兼容 API
- 核心：AIAgent 对话循环（conversation_loop.py）、上下文引擎、记忆、技能、子代理、验证
- 扩展面：插件系统（PluginContext）、技能（SKILL.md）、钩子（30 个生命周期）
- 数据：会话状态库（session_db/SQLite）、记忆 Markdown、看板 SQLite、cron 任务 JSON、证据账本 SQLite

---

## 二、dsh 已有能力对照

**dsh（DeepSeek Harness）现有服务清单**（来自 host 服务注册表，作为对比基准）：

| 类别 | dsh 已有 |
|---|---|
| 会话 | sessionPersistence（事件溯源 JSONL）、sessionQuery（FTS 全文检索）、sessions（内存 store）、sessionProjections、workspaceRegistry、sessionTitle、sessionTelemetry |
| 工具 | tools（注册/guard/restrict/execute 管线）、toolResultPruner、tool-session-query、tool-lsp、tool-terminal、tool-bash-persistent、tool-str-replace-editor |
| 安全 | sandbox、sandboxPolicy、approval（审批栈）、permissionPresets |
| 代理 | agentLoop、agents、agentPresets（full 预设）、agentDefaultModel |
| 子代理 | subagents（provider 注册/start/interrupt/followup/listDescendants） |
| 上下文 | systemPrompt（组装）、compaction（压缩）、tokenMeter、messageFeedback |
| 基础设施 | llm（模型路由）、lsp、terminals（PTY）、web（搜索/抓取）、webServer、skills、settings、credentials、storage、goals、jobs、planMode、userQuestions、shell、subprocess、shellEnv、workflowEngine、typert（RPC）、apiProxy |

**一句话**：dsh 强项在"内核纵深"——沙箱/审批/事件溯源/会话管理/插件化/检索。

---

## 三、集成面：消息网关（gateway/）

> 这是 Hermes 最大的差异化能力：**接入即时通讯**。dsh 目前没有任何对外 IM 接入。

### 3.1 支持平台全景
Telegram / Discord / WhatsApp(+Cloud) / Slack / Signal / Mattermost / Matrix / HomeAssistant / Email / SMS / 钉钉 / 飞书 / 企业微信 / 微信 / BlueBubbles / QQ / 元宝 / API server / Webhook / MSGraph Webhook；另 `plugins/platforms/` 下有 IRC / LINE / Teams / Google Chat / ntfy / raft / simplex / photon 等。平台枚举在 `gateway/config.py` 的 `Platform` 枚举。

### 3.2 核心四件套（最值得移植）
1. **BasePlatformAdapter 能力位抽象**（`gateway/platforms/base.py`）
   - 最小接口仅 **4 个抽象方法**：`connect / disconnect / send / get_chat_info`。
   - 归一化 `MessageEvent`（text/source/media_urls/reply_to/auto_skill/channel_prompt/metadata）。
   - **能力标志位**（supports_code_blocks / splits_long_messages / supports_async_delivery / supports_status_text / interactive_resume 等）取代 per-platform 分支——调用侧 `getattr(adapter, flag, default)` 零分支。
   - 媒体投递安全：denylist + recency-trust + allowlist 三层；入站媒体 128MiB 上限防 OOM；UTF-16 安全截断分块。
   - **借鉴点**：这是"多平台接入"的范式——抽象到 4 个方法 + 布尔能力位，平台差异不渗透进核心。

2. **platform_registry 插件自注册 + 延迟加载**（`gateway/platform_registry.py`）
   - `PlatformEntry`（name/label/adapter_factory/check_fn/validate_config/cron_deliver_env_var/standalone_sender_fn 等 20+ 字段）+ 单例注册表。
   - **deferred loading**：重型 SDK（lark_oapi/discord.py/slack_bolt）import 推迟到首次查找该平台才加载，避免每次 `hermes chat` 付出数秒 import 成本。
   - 插件注册的平台可覆盖内置平台（last-writer-wins）。
   - **借鉴点**：插件自注册 + 首次使用才加载，核心零硬编码 if/elif。

3. **DeliveryTarget 目标语法**（`gateway/delivery.py`）
   - `origin`（回源）/ `local`（落盘）/ `telegram`（home channel）/ `telegram:123456`（指定 chat）/ `telegram:chat:thread`（线程）。
   - `DeliveryRouter` 多目标分发、大输出审计落盘+截断、silence-narration 反循环过滤。
   - **借鉴点**：一套字符串表达所有投递目标，路由层统一解析。

4. **channel_directory 名称解析 + 别名**（`gateway/channel_directory.py`）
   - 可投递目标目录 `~/.hermes/channel_directory.json`（每 5 分钟重建）：Discord/Slack 直接枚举 + 从会话历史补充 + 用户别名 `channel_aliases.json`。
   - `resolve_channel_name` 把人类可读名称解析成数字 ID——**让 agent 用名字而非 ID 发消息**。
   - **借鉴点**：跨平台消息路由的 UX 关键。

### 3.3 可靠性件（后台投递最缺的一环）
- **delivery_ledger 投递义务台账**（`gateway/delivery_ledger.py`）：持久化每条出站最终回复的投递状态（`record_obligation → mark_attempting → mark_delivered/mark_failed` 三检查点）；崩溃后按状态重投（**at-least-once**，attempting 重投带可见标记防静默重复）。
- **dead_targets 死目标自愈**（`gateway/dead_targets.py`）：确认整聊天不可达（forbidden/chat not found）后短期跳过；任何成功发送自动清除。
- **借鉴点**：dsh 后台任务（jobs）最缺的可靠性环。

### 3.4 进阶件
- **cross-platform mirror**（`gateway/mirror.py`）：主动投递后把 "delivery-mirror" 记录写进目标会话 transcript（JSONL+SQLite），保持接收侧上下文连续。
- **pairing 配对审批**（`gateway/pairing.py`）：未知用户拿一次性 8 字符配对码，owner CLI 审批（无歧义字母表/1h 过期/限流/5 次失败锁定/chmod 0600；授权结果与各平台 allowlist env 同步）。
- **profile_routing 分层路由**（`gateway/profile_routing.py`）：`platform+guild_id+chat_id+thread_id` 最具体优先 + parent-chain；**一个实例按频道路由到不同 profile（不同模型/工具/记忆/persona）**。
- **RelayAdapter 终极解耦**（`gateway/relay/`，EXPERIMENTAL）：唯一的通用适配器拨出 WebSocket 到外部 "connector"，握手时接收 `CapabilityDescriptor`（max_message_length/len_unit/draft/edit/thread/markdown_dialect），网关完全不感知具体平台，N 平台一个适配器前端。契约见 `docs/relay-connector-contract.md`。
- **OpenAI 兼容 API server**（`gateway/platforms/api_server.py`）：/v1/chat/completions、/v1/responses、sessions CRUD/fork、/v1/runs + SSE 事件流 + approval 端点；任意 OpenAI 前端（Open WebUI/LobeChat/LibreChat 等）可接入。
- **通用 webhook 平台**（`gateway/platforms/webhook.py`）：HMAC 校验、限流、幂等缓存、prompt 模板、`deliver=` 回传目标、`deliver_only` 纯转发零 LLM。
- **stream_consumer 流式投递**（`gateway/stream_consumer.py`）：同步 agent 回调 → 异步队列 → 缓冲/节流 → 单条消息渐进编辑（Telegram/Discord/Slack 通用）。

---

## 四、集成面：定时任务 cron

> Hermes 有完整 cron 调度；dsh 无原生定时任务（只有 jobs 后台任务，无时间触发）。

- **jobs.py**（`cron/jobs.py`）：任务 CRUD/存储 `~/.hermes/cron/jobs.json`（**per-profile**）；croniter 解析 + 自然语言 `parse_schedule`；跨进程文件锁；**claim_dispatch 分布式认领**（机器 ID + heartbeat + TTL）；`advance_next_run`。
- **scheduler.py**（`cron/scheduler.py`）：内置 60s ticker 后台线程 + 文件锁（多进程只一个 tick）；并行/顺序双线程池；`deliver=` 多平台投递；**continuable cron**（投递后用户回复可继续同一会话上下文）；cron 失败摘要投递。
- **scheduler_provider.py**（`cron/scheduler_provider.py`）：**触发 provider 可插拔抽象**——`CronScheduler` ABC（内置 60s ticker vs 外部 provider）。`plugins/cron_providers/chronos/` + `docs/chronos-managed-cron-contract.md`：宿主网关 scale-to-zero 方案——进程可停，NAS 远端为每个任务 arm 一个一次性 one-shot，到点用 JWT 回调唤醒 agent，跑完 re-arm 下一个。
- **blueprint_catalog.py**（`cron/blueprint_catalog.py`）：自动化蓝图——`schedule_template + prompt_template + {slot}` 占位符，把自然语言需求填成 cron 任务（每日简报/每 N 分钟/每周一/工作日/提醒等预置模板）。
- **借鉴点**：①触发 provider 抽象（执行/投递与触发分离，支持外部调度器）；②continuable cron（定时投递后用户可续同一上下文）；③蓝图目录（预置模板）。

---

## 五、集成面：看板 kanban

- **hermes_cli/kanban_db.py** — SQLite 任务看板：表 tasks/task_links/task_comments/task_events/task_runs/task_attachments/kanban_notify_subs。
- **并发策略**：WAL + BEGIN IMMEDIATE + 对 `status`/`claim_lock` 的 **compare-and-swap**——多进程抢任务靠"受影响行数为 0 即输"，**无需分布式锁**。
- **协作原语**：多 board（`kanban/boards/<slug>/`），多 profile 共享同一 board 作为**跨 profile 协作原语**。
- **机制亮点**：dispatcher 认领任务 → 注入 `HERMES_KANBAN_DB/WORKSPACES_ROOT/BOARD` 环境变量 → 派生 worker 子进程（git worktree 工作区）；`consecutive_failures` 熔断；`goal_mode`（Ralph 式目标循环 + judge）；`block_kind`/`block_recurrences` 反死循环；归档/恢复。规格文档 `docs/hermes-kanban-v1-spec.pdf`。
- **agent/kanban_stop.py** — worker 结束保护：必须以 `kanban_complete`/`kanban_block` 结尾，否则注入 bounded nudge 防"叙述下一步就 stop"的协议违规。
- **gateway/kanban_watchers.py** — 网关内嵌看板 watcher/通知（多网关部署只允许一个网关拥有 dispatcher）。
- **借鉴点**：SQLite CAS 并发范式（多进程抢任务无需分布式锁）+ dispatcher→worker 分发 + goal_mode。

---

## 六、集成面：MCP / ACP 双向

### 6.1 MCP（Model Context Protocol）
- **客户端（仓库原生主力形态）** — `tools/mcp_tool.py`：以 stdio/HTTP/SSE 三种传输连接外部 MCP server，发现 tools 注册进工具表。亮点：后台事件循环、指数退避重连、采样（createMessage）、并行工具调用、错误信息脱敏。`tools/mcp_oauth.py`：MCP OAuth 2.1+PKCE（本地回调+磁盘 token 存储）。
- **服务器（用户侧自定义，不在仓库内）** — `~/.hermes/hermes_mcp_server.py`：用户自建 FastAPI 服务，把 terminal/web_search/read_file/write_file/search_files/patch_file/memory/skill_manage/cronjob/web_extract 十个工具暴露给其它 MCP 客户端（转调 `hermes cron` CLI）。
- **结论**：Hermes **双向 MCP**——既是 client（消费外部 MCP）也能被包装成 server（被别的 agent 消费）；仓库原生只做 client。

### 6.2 ACP（Agent Client Protocol）
- **服务器侧** — `acp_adapter/`（server.py/session.py/events.py/tools.py/permissions.py/auth.py/provenance.py）：实现 `acp.Agent`，让 Zed/VS Code/JetBrains 把 Hermes 当 agent 连接。覆盖：session create/load/resume/fork/list；**load/resume 请求内流式重放历史**（用户/助手/思考/工具调用分块）；approval 流；slash 命令；模型选择器（provider:model）；`usage_update`；ACP 会话注入 MCP server 并刷新工具面。`acp_registry/agent.json` 供发现（uvx 安装入口 `hermes-acp`）。
- **客户端侧** — `agent/copilot_acp_client.py` + `auxiliary_client.py` + `tools/delegate_tool.py`：把 GitHub Copilot 的 ACP server（`copilot --acp`）当 OpenAI 兼容后端；`delegate_task` 支持 `override_acp_command` 派生 ACP 子代理。
- **结论**：Hermes **双向 ACP**——同时是 server（被编辑器/外部 agent 连）和 client（连 Copilot/Codex 等其他 agent），是"agent 对接 agent"的标准姿势。
- **借鉴点**：dsh 若想让其它 agent 或编辑器接入，"标准协议 + 双向角色"最省事。

---

## 七、集成面：插件系统 / 桌面 / 钩子

### 7.1 插件系统
- **hermes_cli/plugins.py** — `PluginContext` 注册式扩展：register_tool / register_platform / register_browser_provider / register_hook / register_middleware / register_skill / register_secret_source / register_tts|transcription|web_search|image_gen|video_gen|dashboard_auth / register_auxiliary_task / register_slack_action_handler。
  - 4 来源（bundled `<repo>/plugins/`、user `~/.hermes/plugins/`、project `./.hermes/plugins/`、pip entry-point），**同名后者覆盖前者**。
  - 目录插件 = `plugin.yaml` + `__init__.py` 里 `register(ctx)`。
  - `VALID_HOOKS` 约 30 个生命周期钩子（见 7.3）。
- **agent/plugin_llm.py** — 插件 LLM 门面：`ctx.llm.complete/complete_structured/acomplete`，宿主掌控路由/鉴权/超时/回退，插件见不到 token；覆盖参数受**显式信任标志**门控（fail-closed）。
- **plugins/ 内置**：platforms（一平台一插件）、browser、memory、context_engine、kanban、cron_providers、web、image_gen、video_gen、dashboard_auth、observability、model-providers、security-guidance、spotify、google_meet、teams_pipeline、disk-cleanup、hermes-achievements。

### 7.2 桌面 / 浏览器
- **apps/desktop**（Electron）："Electron 主进程 / React renderer / agent 后端"三方职权分离，renderer 不直触 Node，agent 逻辑永远在 gateway 侧不复刻到 React；streaming 工具输出、并排预览、文件浏览器、语音。
- **apps/bootstrap-installer**（Tauri 安装器）；**apps/shared**。
- **agent/browser_provider.py** — 云浏览器 `BrowserProvider` ABC（create_session/close_session/emergency_cleanup），Browserbase / Browser Use / Firecrawl 可插拔后端（`browser.cloud_provider` 选择）。
- **agent/browser_registry.py** — 注册中心 + 活动 provider 解析：显式配置 wins（即使不可用也返回以暴露精确报错）、否则遗留偏好按 `is_available()` 过滤。与 web_search/image_gen 等 registry 同构。

### 7.3 钩子系统
- **gateway/hooks.py** — 事件钩子：从 `~/.hermes/hooks/<name>/` 发现 `HOOK.yaml` + `handler.py`；事件 gateway:startup / session:* / agent:* / **command:\* 通配符匹配**；同步+异步 handler；错误不阻断主链路；`emit_collect` 支持决策型钩子。
- **agent/shell_hooks.py** — **shell 脚本钩子桥**：`cli-config.yaml` 的 `hooks:` 块声明 `(event, command)`，子进程以 JSON 喂 stdin、读 stdout（可 block 工具/注入 context）；首用同意记录在 `~/.hermes/shell-hooks-allowlist.json`；`shell=False` 防注入；注册幂等。Python 插件与 shell 钩子同走 `invoke_hook` 管线，Python 插件先注册所以 block 决策优先。
- **VALID_HOOKS 约 30 个生命周期钩子**：pre/post_tool_call、transform_terminal_output、transform_tool_result、transform_llm_output、pre/post_llm_call、pre_verify（可保持 agent 继续）、pre/post_api_request、api_request_error、on_session_start|end|reset|finalize、subagent_start|stop、**pre_gateway_dispatch**（可 skip/rewrite 入站消息）、pre/post_approval_request、kanban_task_claimed|completed|blocked。
- `gateway/builtin_hooks/` 目前为空，仅作扩展点。
- **借鉴点**：shell 脚本钩子桥——不写插件代码也能挂钩子（JSON 协议、首用同意、shell=False 防注入），dsh 可参考此形态做轻量扩展。

---

## 八、核心面：记忆系统

> Hermes 的跨会话记忆 = **内置"有界字符预算的 Markdown 文件"（零依赖）** + 可插拔外部语义后端（单一实例）+ 后台技能养护器。

### 8.1 内置记忆（零依赖，最值得借鉴）
- **落点** `tools/memory_tool.py`：`~/.hermes/memories/MEMORY.md`（2200 字符预算）+ `USER.md`（1375），条目用 `"\n§\n"` 分隔。
- **原子写**：临时文件 + `os.replace` + flock 锁（:770-798, :253-288）。
- **冻结快照注入**：会话开始 `load_from_disk` **冻结快照注入系统提示**（:178-215），保前缀缓存稳定（不改动已缓存前缀）。
- **预算管理 = "模型内联合并"** 而非自动裁剪：超预算返回当前条目并引导模型当回合 `replace/remove` 合并，`apply_batch` 一次调用完成删旧加新（:507-612）。
- **借鉴点**：dsh 想要零依赖跨会话记忆，直接照搬这个数据结构（双文件、§分隔、原子写、加载时冻结）。

### 8.2 外部 provider + 编排（memory_manager.py）
- **单一外部 provider 约束**（:394-460）——不强求多后端。
- **回合前 `prefetch_all` 召回 + 回合后 `sync_all` 进单 worker 后台线程**（:628-684，防 provider 阻塞回合）。
- **10 个生命周期钩子**：`on_pre_compress`（压缩前提取洞察）、`on_delegation`（父观察子代理）等。
- **借鉴点**：把"召回/写入/会话边界/压缩前提取"变成可插拔事件。

### 8.3 后台评审自动沉淀（background_review.py）
- 每轮对话后 fork 一个 agent 回放对话快照，自问"该保存/更新什么技能或记忆"？写入直接进记忆+技能库。
- **关键**：主对话和 prompt cache 从不被触碰；fork 继承父运行环境（同 provider/模型/凭证/缓存）；工具白名单只限记忆/技能管理工具。
- **借鉴点**：这是"跨对话持续学习"的工程实现——正是我们 WORKSPACE.md 约定式记忆的自动化升级版。

### 8.4 curator 技能养护（curator.py）
- **确定性技能状态机**：active → stale(30天) → archived(90天)，**只归档不删除**，pinned/cron 引用豁免（:305-383）。
- 可选 LLM "伞级化"巩固（默认关）+ **三信号对账防幻觉** + **运行前快照可回滚**。
- **借鉴点**：curator 的"快照→执行→对账→报告→可回滚"模板是任何 LLM 后台维护任务的黄金安全默认。

### 8.5 学习图谱（learning_graph.py）— 事实纠正
- **不是持久化知识图谱**：按需从 SKILL.md frontmatter + `.usage.json` + MEMORY.md/USER.md §块推导的**只读可视化视图**（词法连边），无 SQL/图库（:254-323）。
- 用途：桌面端"学习可见化"。

---

## 九、核心面：技能系统

> 技能 = 磁盘上的 `SKILL.md`（YAML frontmatter + Markdown 正文），由斜杠命令发现/惰性加载/装配进上下文，支持"技能包"与叠加命令。

### 9.1 四段管线（skill_commands.py）
- **发现**：`scan_skill_commands`（:320）扫盘建 `/slug` 索引（过滤平台/环境/禁用/撞名）。
- **加载**：`_load_skill_payload` 经 `skill_view(preprocess=False)` **惰性加载**（:138）。
- **装配**：`_build_skill_message` 装配脚手架消息（:217）。
- **反向提取**：`extract_user_instruction_from_skill_message`（:58）反向还原用户真实指令（**防技能模板污染记忆**）。

### 9.2 技能包 skill_bundles.py
- `~/.hermes/skill-bundles/*.yaml` 纯 YAML 清单把 N 个技能绑成一个命令，**bundle 优先于同名技能**；mtime 增量缓存（:95/:195）；缺失/禁用成员降级注明。
- **借鉴点**：bundle = 纯 YAML 清单，解决命名冲突的简单规则。

### 9.3 预处理（skill_preprocessing.py）— 文本级渲染不是编译
- `${HERMES_SKILL_DIR}/${HERMES_SESSION_ID}` 模板替换 + 内联 `!`cmd`` shell 展开（默认关，4000 字符上限 + 超时，失败降级不抛异常）。
- **frontmatter 健壮解析**（skill_utils.py:123）：BOM 剥离 + CSafeLoader + 畸形 YAML 降级；平台/环境门控 fail-open；禁用名单全局+平台并集（:369）。

---

## 十、核心面：上下文与压缩

> 上下文管理 = "引擎抽象接口 + 内置压缩器 + 会话语义编排"三层。这是**最值得移植**的部分。

### 10.1 ContextEngine 抽象接口（context_engine.py:56-263）
- `update_from_response / should_compress / compress` 契约，**可插件替换**（如 LCM），甚至让引擎自曝工具。
- 水位线 `threshold = (context_length - max_tokens) × 0.75`。

### 10.2 ContextCompressor（context_compressor.py）
- **反抖防死循环**（:1459-1643）：真实 usage 判定有效性 + 连续 2 次无效压缩退避 + 摘要 LLM 600s 冷却——**直接消灭"压缩完仍超限→每轮空转"的经典坑**。
- **compress() 五阶段**（:3312-3727）：
  1. 无 LLM 工具结果预剪枝；
  2. 边界 = 保护头 + token 预算保护尾；
  3. **锚点不变量**（:3018-3148, :2876-2928）：最近真实 user/assistant 消息必在尾部、切点绝不切工具组——**压缩后任务不丢失/UI 不异常**；
  4. 结构化摘要模板 + Temporal Anchoring（"待办"改写为"已完成过去式"）+ **迭代式更新**（旧摘要+新轮次合并）；
  5. 孤儿工具清理。
- **摘要输出形态**：带 `[CONTEXT COMPACTION — REFERENCE ONLY]` 前缀，明示"只响应摘要之后的用户消息"，**防旧任务被当新指令执行**（:87-116）。

### 10.3 会话语义编排（conversation_compression.py:698）
- SQLite 压缩锁防并发分叉 + 两种落库（同 id 软归档 in_place vs 轮转切新 session_id）+ 边界通知插件/记忆引擎。

### 10.4 prompt_caching（prompt_caching.py）
- **`system_and_3` 布局**：system + 最近 3 条消息共 4 断点（同 TTL），多轮成本降约 75%；适配 native/envelope 两种布局防断点浪费。
- **借鉴点**：接 Anthropic 系模型可直接照搬的纯函数。

### 10.5 @引用展开（context_references.py）
- `@file/@folder/@git/@url` 并发展开 + **25%/50% 软硬注入水位线** + 凭据 deny-list fail-closed。

### 10.6 context_breakdown 构成统计
- 8 类构成统计——揭示 system prompt + 工具 schema 是**不可压缩地板**。

---

## 十一、核心面子代理与委派

> **事实纠正**：真正的子代理在 `tools/delegate_tool.py` + `tools/async_delegation.py`——**同进程线程池**（DaemonThreadPoolExecutor，非子进程、非 RPC）。`process_bootstrap.py` 是主进程级 IO/代理引导（懒加载 OpenAI SDK、崩溃安全 stdio、HTTP proxy），`auxiliary_client.py` 是辅助 LLM 调用路由（压缩/视觉/web_extract 的 provider fallback 链，用 ContextVar 记账）。

### 11.1 启动与隔离（delegate_tool.py）
- 父线程构造子 AIAgent（:2580-2626）→ 守护线程执行；单任务内联、批量并行扇出（上限默认 3）。
- **隔离（逻辑级，无 OS 沙箱）**：`DELEGATE_BLOCKED_TOOLS` 封禁（禁递归委派/memory/send_message/execute_code/cronjob，:46-58）；`leaf`（不可再委派）vs `orchestrator`（可委派，受深度上限）角色；工具集收窄 = 父∩子；线程内 **auto-deny 审批回调**（:75-113）。

### 11.2 可靠性
- 心跳 + (tool, iteration) 陈旧检测（:1831-1908）；0-API 超时 dump 线程栈；父中断用 `wait(FIRST_COMPLETED, 0.5s)` 轮询响应（:2674-2716）。

### 11.3 成本与上下文治理（最实用两招）
- **成本逐层上卷**：每子代理 close 前捕获成本 → 累加进父会话 `session_estimated_cost_usd`，嵌套逐层上卷（:2213-2225, :2813-2864）。
- **摘要预算**：子代理返回摘要按父剩余上下文动态截断、全文落盘（:1696-1788）防父上下文爆炸。

### 11.4 触发规则与后台异步池
- **触发规则**（run_agent.py:6305-6335）：**顶层模型委派强制后台**（结果异步回投）、orchestrator 子代理的委派保持同步（当场汇总）。
- **后台异步池**（async_delegation.py）：拒绝式容量策略（满即拒不排队）、SQLite 持久化 + owner_pid 崩溃恢复 + delivery claim 幂等回投。

---

## 十二、核心面：工具执行

> 工具调用管线 = 解析→三层拦截（均在 checkpoint 前）→执行（并发/顺序/分段）→结果分类/护栏观测/预算截断→回填。

### 12.1 三层拦截闸门（tool_executor.py:241/:290/:454-520）
- Tool Search 作用域门 + 插件请求中间件 + 护栏 `before_call`（被挡工具零副作用）；`write_file/patch` 先文件 checkpoint（:56）。

### 12.2 分段并行规划器（tool_dispatch_helpers.py:105-204）
- 交互工具 → 屏障；路径型工具按**规范路径前缀重叠**（realpath 解符号链接）判定是否并发；读安全白名单并入并行段。
- **借鉴点**：纯函数可整段移植为 JS，回收 I/O 并行度同时保副作用顺序。

### 12.3 `<untrusted_tool_result>` 间接注入防护（:457-630）
- web/mcp/browser 输出包定界符明示"视为 DATA"、去势伪造定界符——**改语义而非正则**，架构级防御。
- `_tool_output_risk` 只告警不阻断。

### 12.4 三层预算截断
- per-result（默认 100K，按上下文 15% 缩放）→ 超限写沙盒文件返回 `<persisted-output>` 预览块（tool_result_storage.py:144）→ per-turn 聚合 200K（:203）。
- **借鉴点**："存文件 + 给 read 提示"优先于粗暴截断。

### 12.5 护栏 = 循环熔断（tool_guardrails.py）— 事实纠正
- **不是内容/路径安全过滤**（路径安全在 `agent/file_safety.py`，危险命令启发式在 `tool_dispatch_helpers.py:64-89`）。
- 是**工具循环熔断**：allow/warn/block/halt 四值 + 工具名+规范化参数 sha256 签名（不存原文）+ 幂等按结果哈希判无进展；warn 默认开、hard-stop opt-in。

### 12.6 失败判定单一权威
- `_detect_tool_failure`（display.py:1267），护栏 `classify_tool_failure`（:189）刻意镜像它保证口径一致；`file_mutation_result_landed`（tool_result_classification.py:26）证明写入真的落地。
- **分层安全**：循环熔断（guardrails）/ 路径沙箱（file_safety.py）/ 命令启发式 / 插件门各自独立成层，职责清晰。

---

## 十三、核心面：验证与证据

> "被动证据账本 + 完成门"两段式：把 agent 实际跑过的验证命令自动落库为结构化证据（含新鲜度），模型编辑代码后无新鲜通过证据试图收尾时，注入**有界** synthetic nudge 要求补验。

### 13.1 证据自动采集（不靠模型自述）
- terminal 命令执行后 `record_terminal_result`（terminal_tool.py:2857-2873）、文件写成功后 `mark_workspace_edited`（file_tools.py:1538-1569）自动入库。

### 13.2 证据账本（verification_evidence.py）
- sqlite 表 + `VerificationEvidence` 表单（command/canonical/kind/scope/status/exit_code/output_summary）。
- **stale 新鲜度失效**（:611-614）：编辑晚于最后证据 → `stale`——"证据必须新鲜，不只是存在"。
- 无规范命令时兜底识别 `/tmp` 下 `hermes-verify-` 前缀临时脚本为 ad_hoc。

### 13.3 完成门（verification_stop.py）
- surface-aware 开关（编码表面默认 ON、消息平台默认 OFF，:86-170）+ **文档类编辑豁免**（.md/README/LICENSE 等，:24-72）+ **有界重试**（每回合 ≤2 次）；触发点 conversation_loop.py:5546-5603；synthetic 消息从持久化转录剥离。

### 13.4 pre_verify 钩子（verify_hooks.py）
- 用户/插件/Shell 可注册，回合末让 agent 多跑一轮，`max_verify_nudges=3` 防死循环。
- **借鉴点**：数据/策略分离（被动账本 vs policy-only 完成门）+ stale 新鲜度 + 文档豁免 + surface-aware + 有界重试的完整组合。

---

---

## 十四、可借鉴功能总表（含优先级）

> 综合所有探查（作者第一手 + 集成面子代理 + 核心面子代理双重验证）。**S = 最优先，A = 高优先，B = 值得，C = 参考**。

### S 级（强烈推荐，高价值 + 契合 dsh 架构）

| # | 功能 | 出处 | 借鉴点 | 对 dsh 的价值 |
|---|---|---|---|---|
| S1 | **ContextEngine 抽象 + 反抖水位线** | §10.1-10.2 | 接口插件化 + 真实 usage 判定 + 无效压缩退避 | 消灭"压缩完仍超限→空转"经典坑 |
| S2 | **压缩边界锚点不变量** | §10.2 | 最近真实消息必在尾部、不切工具组 | 压缩后任务不丢失 |
| S3 | **被动证据账本 / 策略门分离 + stale 新鲜度** | §13 | 证据自动采集 + 数据/策略分离 + 编辑使旧证据失效 | verification-before-completion 机制化 |
| S4 | **`<untrusted_tool_result>` 注入防护** | §12.3 | 定界符标记 DATA + 去势伪造（改语义非正则） | 架构级间接注入防御 |
| S5 | **分段并行规划器** | §12.2 | 规范路径重叠判定并发 | 纯函数可整段搬，回收 I/O 并行度 |
| S6 | **护栏决策枚举 + 签名哈希** | §12.5 | allow/warn/block/halt + sha256 签名 + 幂等判无进展 | 防 agent 空转状态机 |
| S7 | **有界 Markdown 记忆 + 冻结快照注入** | §8.1 | 双文件 §分隔 原子写 加载冻结 | 零依赖跨会话记忆（升级 WORKSPACE.md） |
| S8 | **curator 快照→执行→对账→报告→可回滚** | §8.4 | 确定性状态机 + 只归档不删 + 可回滚 | LLM 后台维护安全默认 |
| S9 | **子代理成本上卷 + 摘要预算** | §11.3 | 成本进父会话 + 摘要按父上下文截断 | 并行委派最实用两招 |
| S10 | **prompt_caching `system_and_3`** | §10.4 | system+最近3条共4断点 | Anthropic 系直接照搬，多轮省 75% |

### A 级（高优先，接入/协作面）

| # | 功能 | 出处 | 借鉴点 |
|---|---|---|---|
| A1 | **BasePlatformAdapter 能力位抽象** | §3.2-1 | 4 方法 + 布尔能力位，多平台接入范式 |
| A2 | **platform_registry 自注册 + 延迟加载** | §3.2-2 | 插件自注册 + 首次使用才 import |
| A3 | **DeliveryTarget DSL** | §3.2-3 | 一套字符串表达所有投递目标 |
| A4 | **channel_directory 名称解析 + 别名** | §3.2-4 | 用名字而非 ID 发消息 |
| A5 | **delivery_ledger + dead_targets** | §3.3 | 后台投递 at-least-once + 崩溃恢复 |
| A6 | **OpenAI 兼容 API server** | §3.4 | 多方客户端接入面 |
| A7 | **每轮后台评审自动沉淀记忆/技能** | §8.3 | 跨对话自动学习 |
| A8 | **ACP/MCP 双向** | §6 | 同时当 server 和 client |

### B 级（值得借鉴/改造适配）

| # | 功能 | 出处 |
|---|---|---|
| B1 | 看板 kanban SQLite CAS 并发 + dispatcher→worker | §5 |
| B2 | cron 触发 provider 抽象 + continuable cron + 蓝图 | §4 |
| B3 | profile_routing 分层路由（类比 dsh 每会话 preset） | §3.4 |
| B4 | 插件双入口 + LLM trust-gate | §7.1 |
| B5 | shell 脚本钩子桥（JSON 协议） | §7.3 |
| B6 | 技能四段管线 + bundle=纯 YAML 清单 | §9 |
| B7 | 记忆外部 provider + 后台串行写入 + 10 钩子 | §8.2 |
| B8 | 三层预算截断（存文件+read 提示） | §12.4 |
| B9 | 多模型 13+ provider + 多级 fallback + 在线 catalog | §（模型面） |
| B10 | LSP 客户端完备（多服务器 + 自动安装） | §（LSP 面） |
| B11 | 会话导出 Markdown / QMD | §（CLI 面） |
| B12 | 文件系统检查点/快照（git 式） | §（检查点面） |
| B13 | 工具失败判定单一权威 + 分层安全 | §12.6 |

### C 级（理念参考，可暂缓）

| # | 功能 |
|---|---|
| C1 | RelayAdapter 通用适配器 + CapabilityDescriptor（需外部 connector） |
| C2 | pairing 配对码审批 |
| C3 | 云浏览器多 provider（Browserbase/Browser Use/Firecrawl） |
| C4 | TTS/STT/语音 |
| C5 | 学习图谱（学习可见化） |
| C6 | context_breakdown 构成统计 |
| C7 | 安全审计（security_audit / mcp_security / write_approval / model_cost_guard） |
| C8 | 桌面 Electron 三方职权分离 |

---

## 十五、架构洞察与落地路径

### 15.1 架构对比洞察
- **同源思想**：Hermes goals.py 注释明说 "the Ralph loop for Hermes"，dsh 有 goals 服务——两框架都借鉴 Ralph 循环理念，目标管理机制本质相同。
- **理念一致**：Hermes"核心窄腰 + 能力边缘" = dsh"Cordis 插件化 + skill"。都是"核心薄、能力靠插件/技能"。
- **最大互补**：dsh 内核纵深强（沙箱/审批/事件溯源/会话/插件）；Hermes 外围接入强（IM 网关 / OpenAI 兼容 API / 自动记忆 / 多模型 fallback）。

### 15.2 落地路径（三种）
1. **快速整合（不动 dsh 内核）**：让 dsh 的 agent 通过 HTTP 调用本机 Hermes 的 `0.0.0.0:8666` OpenAI 兼容 API——dsh 作为客户端接入 Hermes，立即获得多模型能力。作临时整合路径。
2. **借鉴实现（推荐）**：把 S 级功能的"设计理念"以 dsh 插件形式重新实现（利用 dsh 已有 subagents/goals/skills/compaction/guard 能力）。分批做。
3. **远期**：IM 网关（若需微信/飞书/Telegram 接入，需较大工程，先做单平台）。

### 15.3 建议的分批路线（供后续方案讨论）
- **第一批（性价比最高，零风险）**：S7 有界 Markdown 记忆（升级 WORKSPACE.md 机制）+ S10 prompt_caching。
- **第二批（质量基建）**：S1-S2 上下文反抖 + 锚点不变量；S6 护栏签名；S3 证据账本。
- **第三批（并发/安全）**：S4 untrusted 防护；S5 分段并行；S9 成本上卷。
- **第四批（对外接入，较大工程）**：A6 OpenAI 兼容 API 插件；A1-A5 网关四件套（若需 IM）。

---
