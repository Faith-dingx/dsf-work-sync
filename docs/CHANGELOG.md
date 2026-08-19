# 改动记录（CHANGELOG）

> 记录本工作区所有已完成 / 进行中的改动。新会话据此了解"之前做过什么"。
> 原则：改动完成 → 在此记录（含时间、位置、验证状态）；有待办 → 标 ⏳。

---

## 🟢 2026-08-19 — 阶段5：辅助模型省钱全景 + 插件生态安装（本轮）

**目标**：把辅助 LLM 调用全部换成免费 agnes / 免费引擎，并直接采用社区现成插件，省成本省开发。

### 5.1 A2 会话标题 → agnes（已完成 ✅）
文件：`~/.dsh/profiles/web/cordis.patch.yml`
- 新增 `session-title-llm` 配置：`provider: router-9888` + `model: agnes-2.5-flash`
  （targetWords 5 / targetCjkCharacters 10 / maxInputBytes 4096 / maxOutputTokens 64 / timeoutMs 60000），
  覆盖 host 默认（原 fallback 到最新路由模型）。
- 备份：`~/.dsh/profiles/web/cordis.patch.yml.bak-085146`。

### 5.2 免费 web 搜索：dsh-free-search（已生效 ✅）
- 安装：`pnpm dsh plugin --profile web add 'dsh-free-search@^0.4.7' -w`（声明 `dsh.bundle` → 自动加入 bundles）。
- 效果：web 搜索**不再依赖 DEEPSEEK_API_KEY**；默认免费 **bing** + ddg/ddg-lite/anysearch/exa/tavily/keenable 多引擎**自动回退**；
  附带 `advanced_search`（时间过滤）、`platform_search`（GitHub/V2EX/B站）、`web_fetch`、`free_search_test`。
- 验证（free_search_test 实测）：bing/ddg/ddg-lite/anysearch/exa/tavily/keenable ✅ OK；
  searxng 某实例 429（自动回退）；perplexity/deepseek-official 无 key（付费，正好不用）。
- 兼容坑：**0.4.5 注入 keyed slot `settings.plugin.item` 缺 `key`** → "Failed to load plugins"；
  Hermes 手改 node_modules 补 `key` 应急 → 最终升级 **0.4.7 官方修复版**根治（自带 `key: "free-search"`），手改补丁已清除。

### 5.3 跨会话记忆：dsh-persona-memory（已生效 ✅）
- 安装：`pnpm dsh plugin --profile web add dsh-persona-memory -w`（0.1.19，bundle 自动激活）。
- 功能：MEMORY.md/USER.md 持久记忆 + 每请求注入 + 后台自动学习 + 纠正检测 + 容量合并（与 pi-hermes-memory 字节兼容）。
- 坑：依赖 sharp/protobufjs → `~/.dsh/profiles/web/pnpm-workspace.yaml` 加 `allowBuilds: {protobufjs: true, sharp: true}`。

### 5.4 放弃 dsh-restart（一键重启按钮）
- 原因：pnpm 11.22 `inheritedParentPkgBreaksPeerDiamond` 崩溃（`--legacy-peer-deps` 不存在、
  `--config.strict-peer-dependencies=false` 无效），价值低。
- 替代：已有 `~/bin/dsh-lan restart` + Hermes 建的监控面板 **[DSH] 重启按钮**。

### 5.5 重启问题修复（Hermes 协作，2026-08-19）
- 现象：重启后插件区报 "Failed to load plugins dsh-free-search"。
- 修复链：Hermes 定位（keyed slot 校验 `ui-slots:806` → `client.js:391` 缺 key）→ 手补 key 应急 + 重启 →
  本会话升级 0.4.7 根治。Hermes 报告存档：`与agent的交互目录/dsh-free-search插件加载失败修复分析报告.md`。
- 附带（Hermes 做）：新建 `dsh-web.service`（systemd user，开机自启，`--host 0.0.0.0 --port 3080`）
  + 监控面板 `system_monitor_web.py` 加 [DSH] 重启按钮。

### 5.6 插件安装方法论（本机实测）
- `dsh plugin --profile web add <pkg> -w`：profile 是 pnpm workspace，**必须 `-w`**；
  reconcile 自动把声明 `dsh.bundle` 的包加入 `dsh.profile.bundles`，无需手动改配置。
- 官方 registry 慢 → 加 `--registry=https://registry.npmmirror.com`。
- 第三方 bundle **必须用 `dsh plugin add` 装**（peerDeps 唯一实例；勿把核心包复制进 profile node_modules，
  否则工具调度器失效）。

### 5.7 全量修改 bug 审查（2026-08-19，只读排查）
**结论：无明确 bug，无需紧急修复。** 逐项验证：
- ✅ **A2 标题 patch 已生效**（`dump-config` 铁证：`session-title-llm` 带 `provider: router-9888 / model: agnes-2.5-flash`，
  注释 `patched by cordis.patch.yml`；`resolveRoute` 源码确认显式 provider/model 优先、成对校验 throw）。
- ✅ **router-9888 provider**：9888 **不校验 key**（无 key POST 返回 200）、`/v1/chat/completions` 与 `/chat/completions` 均通。
- ✅ **compaction-basic**：preset 层 `summarizationProvider: router-9888 / model: agnes-2.5-flash` 生效（压缩实测 in=180648/out=1814）；
  压缩失败有兜底（`catch → logger.warn('step compaction failed; continuing the turn')`，不崩）。
- ✅ **5 个插件 bundle** 全部激活、无重复、无启动错误（dump-config 确认 5 行插件）。
- ✅ **peer 警告**：官方 monorepo 包 `workspace:^` 协议在 pnpm 下的信息级噪音，不影响运行时（详见下）。

**记录的风险点（非崩溃，可选项）**：
1. ⚠️ **9888 单点依赖**：压缩/标题硬编码 router-9888；软路由挂则压缩失败（有兜底不崩但上下文不压缩），
   无自动切主模型的 fallback。可接受（软路由为核心设施）。
2. ⚠️ **插件版本偏旧**（supply-chain minimumReleaseAge 限制）：persona-memory 0.1.19→latest 0.2.0、
   pocket 1.4.8→1.7.2、free-vision 1.0.1→1.0.7。旧版可能有已修复 bug，**可日后升级**。
3. ⚠️ **dsh-web.service 无 key env**：Environment 未含 OPENCODE_GO_API_KEY/HUOSHAN_API_KEY；
   当前 9888 不校验（无碍）、huoshan key 从 dsh 配置读取（正常）。**隐患**：将来加需进程 env key 的 provider 时 systemd 会缺。
4. ℹ️ **trusted-host 白名单仅 2 个 IP**（10.10.10.9 / 100.67.219.105）：新设备访问需加（安全设计）。
5. ℹ️ 插件依赖 caret 范围（`^0.4.7` 等）：0.x 下锁定 minor，安全。

### 5.8 记忆管理诊断：`forbidden: loopback-only`（2026-08-19）
- **现象**：设置页「记忆管理」读取失败 `forbidden: loopback-only`。
- **根因**：**非 bug，是作者安全设计**。dsh-persona-memory 的 `/api/persona-memory/*` 管理路由带 loopback fence
  （`lib/admin.js` `isLoopbackRequest`：强制 `remoteAddress ∈ {127.0.0.1,::1}` + host same-origin），远程浏览器（LAN IP）一律 403。
- **核心记忆功能正常**：`~/.dsh/memory/USER.md` 正常写入（11:52 记录用户偏好）→ 注入/后台学习不受影响，仅管理页远程受限。
- **市场对比结论**（记忆插件）：
  | 插件 | 文档 | 局域网管理页 | 备注 |
  |---|---|---|---|
  | dsh-persona-memory（已装 0.1.19）| 中 | ❌ loopback-only | 核心正常，管理页仅 127.0.0.1 |
  | **dsh-mnemon 0.2.9** | 最全（13.9K+中文+demo）| ✅ **受信主机机制** | 需额外装 Mnemon 引擎（go/brew），本地 SQLite 免费 |
  | dsh-auto-memory 0.1.28 | 全（中文）| ❌ loopback-only | cache-friendly |
  | memos-local-plugin 2.0.16 | 全 | ❌ loopback-only | 算法强但 viewer 仅本机 |
- **结论/建议**：本地记忆插件远程管理页全部 loopback-only（社区安全惯例）。若仅需"能看记忆"→ 本机 127.0.0.1:3080 打开即可，或让 agent 读 `~/.dsh/memory/*.md`；
  若必须局域网管理页 → 唯一候选 dsh-mnemon（改动大，待用户拍板）。

### 5.9 persona-memory 实测验证 + 记忆系统选型（2026-08-19）
**实测结果**（第一手证据）：
- ✅ **注入**：当前会话系统提示含 `memory-context` 块（USER.md 内容）→ 每请求注入工作。
- ✅ **手动写入**：`~/.dsh/memory/USER.md`（193B，11:52 写入用户偏好）。
- ✅ **自动备份**：`~/.dsh/memory-backup/latest/` 15:24 更新（autoBackupMin=60）。
- ✅ **防失控配置**：autoConsolidate=true（超限 LLM 合并，须更小+可解析+过扫描才提交）、consolidateStaleDays=30、优先保偏好/纠正。
- ❌ **后台学习空转**：日志 0 条 persona-memory 活动；MEMORY.md/failures.md **从未生成**。
  - **根因（实锤）**：learnIntervalTurns=10 **按单个会话累计** turn/end，而实测所有会话 turn/end ≤2（用户高频短会话，每会话 1-5 轮即换）→ **从未有会话到 10 轮 → 学习从未触发**。
  - request/header 的 `data.header.config.provider/model` 确认存在（latestRoute 能拿到路由，不是路由问题）。
- ⚠️ **成本**：学习/合并代码写死走会话主模型路由（huoshan 付费），**无 provider/model 配置项，不可配 agnes**。
- ⚠️ **管理页 loopback-only**（局域网 403，见 5.8）。

**记忆系统选型决策点**（用户使用模式 = 高频短会话）：
| 方案 | 适配度 | 理由 |
|---|---|---|
| **persona-memory + 调 learnIntervalTurns**（推荐先试）| ✅ | 机制健全（注入/纠正/安全合并/备份），只差轮数门槛；改 3-4 即适配，hot-reload 零风险 |
| dsh-auto-memory（备选）| ✅ 每轮沉淀 | per-turn 沉淀不依赖累计轮数，天然适配；但管理页同 loopback-only、模型调用未确认、需重装重启有踩坑风险 |
| dsh-mnemon | ⚠️ | 最强+局域网，但需装 Mnemon 引擎（go/brew）+复杂，短期不划算 |
| memos-local | ❌ | loopback + 复杂 |

**推荐**：**保留 persona-memory**，先加一行 patch 调 `learnIntervalTurns: 3`（hot-reload），观察 1 天学习是否开始积累；不行再评估 dsh-auto-memory。→ **待用户确认后执行**。

> **【2026-08-19 更新：用户纠正保守倾向】**
> 用户明确：插件在磨合期，**现在多试多踩坑就是为以后顺畅**，"换装有风险"不构成不换的理由。
> → 重新深挖 **dsh-auto-memory 0.1.28**（代码级，非纸面）：
> - ✅ **不发起独立 LLM 调用**（lib 0 次 `llm/chat`）：每轮"记忆管家评估"prompt 注入让 agent 在主回复**同一轮顺带完成**（复用 KV 缓存）→ **几乎不额外花钱**，真 cache-friendly。
> - ✅ **每轮自动沉淀**（turn-stopping 评估，`[自动沉淀]` 标记，寒暄跳过、按 turn 去重）+ 长期价值升格项目笔记/用户级记忆。
> - ✅ **30 天蒸馏**（memory_maintain：AI 提炼旧日志进项目笔记，原文归档）。
> - ✅ **5 个记忆工具**：memory_recall / memory_maintain / memory_status / memory_reflect / memory_consolidate。
> - ✅ **注入**：`<memory_system>` 块（用户规则+项目笔记+今日日志+最近反思），缓存刷新（启动/session-start/turn-stopping/工具写/TTL）。
> - ✅ **每日反思**：昨日日志未反思 → 会话首轮注入反思块 → agent 生成 → memory_reflect 落盘。
> - ✅ 中文 UI：概览/日志/笔记/反思/接续/日历/检索/工作区（三级抽屉）。
> - ⚠️ 短板：管理页 loopback-only（同 persona）；沉淀消耗主模型同轮 token（复用缓存，量小）。
> **对比结论更新**：dsh-auto-memory 在"适配高频短会话（每轮沉淀）+ 省钱（不独立调 LLM）+ 管理丰富"三维度全面优于 persona-memory 实测现状 → **值得装测**（用户态度：磨合期该试）。

---

**目标**：把 dsh 可选能力补全，为"局域网统一管理平台"打基础。

### 2.1 宿主配置 — 开启跨会话检索 + LSP/PTY 后端
文件：`~/.dsh/profiles/web/cordis.patch.yml`
- `session-query-sqlite`：从 `openAt: never`（搜索禁用）改为
  `openAt: first-search` + 持久化索引 `~/.dsh/sessions/query.sqlite`。
  → 使 `tool-session-query` 的全文搜索真正可用。
- 新增 `lsp-stdio`（`@deepseek-ai/dsh-lsp-stdio`）：接 tsserver，
  提供 `ctx.lsp`（支持 .ts/.tsx/.js/.jsx/.mjs/.cjs）。
- 新增 `terminal-bash`（`@deepseek-ai/dsh-terminal-bash`）：提供 `ctx.terminals` PTY 后端。

**验证**：YAML + `!!js` 用 harness 同款 js-yaml 解析通过；`!!js` 路径正确求值。
✅ **已生效**（2026-08-18 20:19 重启后）：`lsp`、`terminals`、`sessionQuery` 服务均确认挂载。

### 2.1b 修复记录（重启失败 → 修好后生效）
- **现象**：首次重启报 `EADDRINUSE 0.0.0.0:3080`（旧进程仍占用），停旧进程后
  新实例又因后端插件缺失起不来。
- **根因**：patch 只 insert 了 provider（`lsp-stdio`/`terminal-bash`），
  **漏了提供服务的底层插件**（`lsp`/`terminal`）；且 4 个后端包未进 profile 运行环境。
- **修复**：
  1. `~/.dsh/profiles/web/pnpm-workspace.yaml` — 指向仓库 `packages/` + `vendor/`，
     使 profile 能安装本地包；
  2. `~/.dsh/profiles/web/cordis.patch.yml` — 补 insert `lsp` + `terminal` 服务插件；
  3. `pnpm add -w file:...` 装上 dsh-lsp / dsh-lsp-stdio / dsh-terminal / dsh-terminal-bash 4 个包。
- **结果**：重启成功，三服务挂载，会话列表仅剩当前会话。

### 2.1c 修复记录（bash 工具冲突 → 删普通版）
- **现象**：会话启动后模型工具冲突、操作失败，造成**不能选择模型**。
- **根因**：full 预设里同时放了两个 bash 工具：
  `tool-bash`（普通版）与 `tool-bash-persistent`（持久化版），
  两者**都注册 `bash` 这个工具名** → 注册冲突。
- **修复**：删除普通 `tool-bash`，保留持久化版（`tool-bash-persistent`，需要的那个）；
  并在 preset 里加注释说明为何省略普通版（避免同名冲突）。
- **结果**：✅ 已修复并验证——会话可正常选择模型、bash 工具工作正常
  （本会话全程可正常执行 bash/创建文件/运行插件）。

### 2.2 full 预设 — 新增 5 个模型工具行
文件：`~/.dsh/.agent-presets/full/agent.cordis.yml`（"remaining model-facing rows" 之后新增）
- `tool-session-query`（跨会话检索）
- `tool-lsp`（代码导航）
- `tool-terminal`（交互终端）
- `tool-bash-persistent`（持久化 shell）
- `tool-str-replace-editor`（文本视图编辑器）

**验证**：YAML 解析通过（22 行插件，5 行新增均在列）；5 个包 + 2 个后端包在 workspace 确认存在、包名正确。
✅ **已生效**（2026-08-18 重启后）：新进程带上了这 5 个工具。

### 2.3 校验说明（重要，勿误判）
- `standingKeyFor('full')` 尝试 mount 校验时被**既有冲突**挡住：
  `tool-cordis` 插件注册的 Host inspect provider "Service" 与进程内同名 provider 冲突。
  **官方自带 `cordis` 预设同样失败**——证明与本轮 5 行新增无关，是本机运行中会话的已知现象。
- 因此本轮用等效验证：yaml 解析 + 包名存在性 + 纯 per-session 工具（不发布服务）判定。

---

## 🟢 阶段4：辅助模型省钱落地（2026-08-18）

**目标**：dsh 压缩改用免费辅助模型（agnes-2.5-flash），省成本。

- **发现**：9888 网关（10.10.10.2:9888）是可用的模型路由网关——模型池 71 免费 + 28 套餐 + 5 付费；含 `agnes-2.5-flash`（免费）；OpenAI 兼容（`/api/chat`、`/chat/completions`、`/v1/chat/completions` 均可）。
- **修复**：9888 网关的 SSE 流式响应（此前忽略 stream 参数返回完整 JSON，导致 dsh 流式调用报 `Stream ended without finish_reason`）。
- **改动**：
  1. `~/.dsh/settings.yaml` 新增 `router-9888` provider（api openai-completions，baseURL http://10.10.10.2:9888，模型 agnes-2.5-flash/agnes-2.0-flash）→ **热加载生效**。
  2. `~/.dsh/.agent-presets/full/agent.cordis.yml` 的 `compaction-basic` 加 `summarizationProvider: router-9888` + `summarizationModel: agnes-2.5-flash` + `maxTokens: 8192` → **重启生效**。
- **验证**：dsh→router-9888→agnes-2.5-flash 完整调用通过（返回 OK）。重启后 providers 含"软路由网关"、preset 配置已确认。
- **实测通过（23:23，实锤）**：用户手动 `/compact` 触发压缩 → 9888 记账日志：`agnes/agnes-2.5-flash client=10.10.10.9 in=180648 out=1814 POST /chat/completions 200`，结束时刻 23:23:18 与压缩窗口（23:22:49→23:23:18）完全吻合。in≈18 万 = 整个上下文（555 条/≈113923 tokens 历史 + 系统提示）一次入参，out=1814 = 摘要。**压缩 100% 走免费 agnes-2.5-flash，不再消耗主模型 token。**
- **注意**：当前主模型仍是火山 deepseek-v4-flash；prompt caching 由 DeepSeek 自动生效（适配器报告 cacheReadTokens），无需配置。压缩换 agnes 是跨 provider，不再命中 DeepSeek 缓存，但 agnes 免费，净省为正。

---

## 🟢 阶段3：Hermes 能力探查（2026-08-18）

**目标**：为"dsh 借鉴 Hermes 功能"做调研，形成参考文献。

- **产出**：`docs/hermes-能力参考文献.md`（418 行，15 大节）——完整探查报告 + 可借鉴功能总表（S/A/B/C 级）+ 分批路线。
- **方法**：作者第一手探查 + 2 个深度子代理（集成面/核心面），核心面 6 并行子代理 + 逐行读码双重验证。
- **关键结论**：dsh 内核纵深强（沙箱/审批/事件溯源）；Hermes 外围接入强（IM 网关 / OpenAI 兼容 API / 自动记忆 / 多模型 fallback）。两框架同源 Ralph 理念。
- **S 级可借鉴 TOP10**：上下文反抖/锚点不变量、证据账本、untrusted 防护、分段并行、护栏签名、有界 Markdown 记忆、curator 模板、子代理成本上卷、prompt_caching system_and_3。
- **简版摘要**：`docs/dsh-vs-hermes-对比.md`（202 行）。

---

## 🟢 阶段1：局域网访问改造（此前对话完成，恢复记录）

文件：`docs/DSH-改造部署指南.md` 已详述，要点：
- deepseek-harness `feature/lan-access` 分支（commit e03033c0ba）4 处源码改动，
  使 Web 可绑定 0.0.0.0、受信局域网主机可访问特权方法、非 HTTPS UI 正常。
- `full` 预设（基于 cordis）创建并设为默认。
- `settings.yaml`：default=full，permission=danger-full-access。
- `dsh-lan` 启动脚本（~/bin/dsh-lan）跨设备统一入口。
- 部署资产：`docs/DSH-改造部署指南.md` + `patches/`。


## 6.x 插件体系完善（2026-08-19）

### 6.1 记忆插件双跑落地
- 新增 dsh-auto-memory 0.1.28（@a9i5k4）：三层记忆 + 每轮自动沉淀 + 5 工具 + <memory_system> 注入（走系统提示尾部通道，不进 request/header）。
- persona-memory 升级 0.2.0（覆盖安装消除市场更新提示），A3 patch（learnIntervalTurns: 3）升级后仍生效。
- 双注入并存确认：persona 注入进 request/header.system（memory-context），dsh-auto 注入走系统提示尾部（<memory_system>），两通道独立，双跑成立。
- dsh-auto 自动沉淀实证：turn 97/98 各 +3 points（log 3）——每轮写今日日志。

### 6.2 视觉插件选型与安装
- 视觉选型结论：dsh-vision-router 1.6.2（★770，开箱免 Key 免 Python、像素级 14 工具）> modlens（★3133 但需配 key）。
- dsh-free-vision（★2）因更新报错由用户删除；vision-router 覆盖安装成功。

### 6.3 插件更新提示消除（市场安装规范）
- 市场"需更新"判定 = registry latest vs package.json 声明范围；caret 锁版本（如 ^0.1.19）升不到跨 minor 的 latest 即误报。
- 根治：pnpm-workspace.yaml 加 minimumReleaseAgeExclude 白名单 → pnpm dsh plugin add 'pkg@版本' -w 覆盖安装 → 声明更新 → 提示消失。
- 已覆盖：persona 0.2.0、pocket 1.7.2、vision-router 1.6.2、dshmarket 1.14.1（恢复）。
- 教训：删插件/装插件触发 pnpm 重解析会降级其他包（dshmarket 1.14.1→1.12.1），装完需复核 package.json 依赖。

### 6.4 已知项
- dsh-auto-memory 设置页 loopback-only（isLoopbackRequest 强制 127.0.0.1，安全设计）：本机 http://127.0.0.1:3080 可访问设置页；记忆注入/沉淀/工具不受影响。
- persona-memory 不在市场目录（awesome-dsh-plugin 无条目），只能手动管理。
- 2 个无害 pnpm 警告：ini@1.3.0/prebuild-install@7.1.3 deprecated（sharp/onnxruntime 构建链，功能正常）；workspace:^ peer 警告（官方包特性）。


### 6.5 vision-router 接入 9888 免费视觉链路（2026-08-19 晚）
- vision-router 1.6.2 已加载 + 16 个 vision_* 工具注册（工具列表实证）；默认内置 OVH 匿名免费链被 429 限流（共享额度用爆）。
- 9888 网关 agnes-2.5-flash 实测支持视觉输入（10.10.10.2:9888，OPENCODE_GO_API_KEY 免费链路）——零新增 key。
- A4 patch：vision-router providers → router-9888/agnes-2.5-flash；超时调大（visionTaskTimeoutMs 45s→120s、ocrTimeoutMs 30s→60s、timeoutMs 120s→180s）——默认 45s 撞 9888 首次冷启动超时。
- 性能实测：9888 agnes-2.5-flash 冷启动 9.4s / 热响应 1.0s，OCR 精确、识图详细准确（界面标题/布局/图内文字全识别）。
- 验证通过：vision_ocr + vision_describe 走 9888 稳定工作，无超时，配置 120s 在设置界面可见。
- 设置界面位置：设置 → 插件 → 插件配置 → 视觉路由（自动识图），7 配置项（图片轮换自动路由/识图工具/图片块改写/隐身模式/视觉请求超时/包装路由名/视觉链路由名）。


### 6.6 记忆文件规矩确立（2026-08-19 晚）
- 用户约定：记忆文件只存三类内容（零细节、零无关，精简易懂）——①关键规则 ②关键文件指针（项目进项目目录，需有立项/计划/进展文档）③工作流水账指针（任何操作入账、项目内容一句+细节存项目文档）；其他任何内容不准进记忆文档。
- 已落地：用户级 MEMORY.md 重写为三类、项目笔记精简为指针式、USER.md + AGENTS.md 固化规矩。

---

## 待办（下一步）

1. ✅ **重启 dsh 验证宿主后端挂载**（LSP/PTY/FTS）——已完成，三服务确认挂载（见 2.1b）。
2. ⏳ **软路由 Hermes 接入方式确认**（凭据/细节）。
3. ⏳ **局域网统一管理/多方协作平台**开发（见 PROJECT.md）。
