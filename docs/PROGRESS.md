# 项目执行保障系统 - 进展记录

## 2026-08-21 修复：主 agent 误操作事件

- **问题**：skill-router 实施过程中，主 agent 多次直接编辑 full preset YAML，导致 project-planner 挂载丢失、MEMORY.md 追加用户反对规则、.temp 目录未归档
- **修复闭环**：plan-reviewer 评审 → code-agent 实施 → check-agent 质检通过
- **结果**：MEMORY.md 铁律已删除；full preset project-planner 挂载已恢复；skill-router POC 报告已归档
- **教训**：主 agent 必须严格遵守"派 code-agent 实施"规则，不得亲自编辑文件

# 当前进度与阻塞点（PROGRESS）

> 每次进入实施或承接新会话时，从这里看"现在卡在哪一步、下一步做什么"。

## 当前进行中的步骤

### ✅ AI 网关配置 Web 界面 T2 前端 + T4 首启向导（2026-08-23）— 本机完成，待用户/主 agent 定夺下一步

- **交付**：`projects/ai-gateway/config-ui/`（index.html + app.js + style.css 原生三件套 + server.js 静态托管增量 + README 重写）；T2 四大标签（Provider 增删改 / 子代理编辑 / 密钥掩码 / 状态卡）+ T4 三步首启向导（token 一次明文 → 网关 9888 确认 → Provider+key → 完成检测 → 主界面）
- **验证**：骨架 8091/8092 全绿——登录、provider 增改删、subagent PUT 后 diff 仅 2 行变化且回读一致、密钥 DOM 无明文、向导全流程 + token 不二次回显、移动端 390px 无溢出、真实 ~/.dsh md5 零改动；记录 `.temp/config-ui-test/VERIFY-T2-T4.md` + screenshots/（16 张）
- **待办**：未 commit（用户约定）；T3 服务开关页、T6 LuCI 转制设计未开始；本机调优与软路由 LuCI 转制路线待用户拍板

### ✅ dsh-memory-manager LLM 超时根因修复 — 全闭环完成（2026-08-22 19:0x 重启验证）

- **根因实锤**：runCompression 硬编码 `timeoutMs: 10000`；9888 网关实测 7.5KB→4.4s、93.7KB→10.7s；百轮会话 payload 必超时 → 摘要全降级 fallbackSummary（雷同）
- **修复**：超时 10s→25s 可配置 / classify 最多最新 60 段 / summarize 最多最新 30 段 / 每段截断 400 字符 / coverage 真实传入 fallback；新增 5 字段+默认常量
- **四道闸全过**：code-agent 实施（254 测试绿 +542/-23、perFile 四维 100%）、check-agent 质检通过（S 级防御项：classify 残留 `?? 10000`→常量顺手修）、P4 提交 `dea792d436`（feature/lan-access，未 push）
- **重启验证（用户 19:04 重启）**：新进程 19:04:45 挂载日志正常；19:06:42 `turn/end #11 compressed, summary written`（无 failed-open）；摘要文件 `.dsh-memory/conversationsummary-latest.md` 19:06:42 时间戳、无 fallback 标题/coverage 行（`grep 对话历史摘要|覆盖范围=0`）→ **确认真 LLM 结构化摘要**（内容为本会话真实工作归纳，非雷同模板）——修复闭环验证完毕
- **关联修复**：code2-agent 模型 gpt-5.6-luna→**deepseek-v4-pro**（gpt-5.6-luna 在 opencode.ai 网关流式缺 `[DONE]`/finish_reason 致输出重复"777777"，根因锁定模型网关侧向题，非配置/key 错）；改 `~/.dsh/.agent-presets/full/agent.cordis.yml` L220 + code2 预设注释，备份 `.bak-code2v4pro-20260822-190103`，未入库未重启；重启后 `call_code2_agent` 探测返回 `7`（单次正常）→ **code2 切换生效**
- **guard T10 部分验证**：本次主 agent 越界 curl 凭据被 guard 拦截并自动派发 code-agent（"诊断放行、实施派发"），guard-main-agent 已正常工作
- **待办**：①injection-manager T12 R1-R10 回归仍部分待确认（5读/10写裁剪、persona 段保留已验；dsh:conversation-summary 注入段随本次重载已知挂载，需一次多轮对话实测注入是否跳进 system prompt）②dsh-memory-manager 写入入口插件（批次2）未启动 ③memory-manager 两修复可拆独立 commit（当前合并一处，无碍）

### ✅ dsh-memory-manager 修复 A/B/C 完成 + code2-agent 加载（2026-08-22 17:5x 重启验证）

- 用户 17:51 重启 dsh：code2-agent（17:43 创建）已加载，`call_code2_agent` 工具本会话可见；memory-manager host 层挂载日志 17:51:56 正常

### ✅ dsh-injection-manager 插件（2026-08-21）——P2 实施 + P3 质检 + P4 提交完成，等 T12 集成实测

- **计划**：`projects/project-execution-system/docs/计划-上下文与记忆管理.md`（v12，注入管理器批次1 T1-T6）
- **改动文件**：`packages/extensions/dsh-injection-manager/`（新包：config/tool-cut/memory-layer/dedup/index/invariant 6 源 + 4 测试 31 用例）、`apps/cli/package.json`（workspace 依赖）、`tsconfig.host.json`（路径引用）、`pnpm-lock.yaml`（pnpm install 生成）
- **核心**：system-prompt/assemble listener——静态裁 10 写工具（5 读常驻，所有 agent 统一）；记忆分层（6 短期名保留、memory:_/dsh:_ 未知名丢弃、非记忆段放行）；同名去重；双段 fail-open；无 classifier/无 agent 判断
- **验证**：31/31 测试全绿；包内 tsc 0 错；host tsc 本包 0 错（全仓 4 错均系 untracked skill-router 既有，与本任务无关）；oxlint 0；tsdown 产物 lib/index.js + lib/invariant.js 生成
- **已 git commit**：`7090ea888ae51e7d3238e21776b4db50d6a4cf19`（feat(inject) 16 文件 +773/-0 纯追加，P3 质检通过后提交）；lefthook pre-commit 全过；hash-object/update-index 暂存 injection-only 版共享文件，commit 内 skill-router 引用 0 处，skill-router WIP 原样留工作区未混入；lib/ 未跟踪不提交（仓库约定一致）；未 push（pre-push typecheck 因 skill-router 既有 4 错会失败，按约定不处理）
- **待办**：①T12 集成：preset 挂载 + 主 agent 告知用户重启 dsh 后实测回归 R1-R10（含确认 persona/identity/工具指引段在分层过滤下原样保留）；②写入入口插件（dsh-memory-write-entry，T7-T11）批次2
- 明细见 `docs/CHANGELOG.md` 2026-08-21「dsh-injection-manager 插件实施完成 / P4 提交完成」条目

### ✅ dsh-memory-manager 插件（2026-08-22）——P2 实施 + P3 质检修复 + P4 提交完成，等重启实测摘要注入链路

- **计划**：`projects/project-execution-system/docs/`（v16/v18 记忆文件规范+写入入口 / 线2 模块化定案）——职责面 A 记忆文件审核管线（六步）+ 职责面 B 历史对话每轮压缩；turn/end 后先压缩后审核；摘要段 dsh:conversation-summary 走注入管理器白名单
- **改动文件**：`packages/extensions/dsh-memory-manager/`（新包：17 源 + 15 测试 234 用例，perFile statements/branches/functions/lines 全 100% via v8 provider）、`apps/cli/package.json`、`tsconfig.host.json`、`pnpm-lock.yaml`（首提 `789ac1cf8f`，37 文件 +5439）
- **P3 质检 2 项修复**：①注入管理器 `SHORT_TERM_MEMORY_NAMES` 补第 7 项 `dsh:conversation-summary`（`dsh-injection-manager/src/config.ts`，摘要段不再被当 long-term 丢弃）②重建 dsh-memory-manager lib/index.js（tsdown 完整包名 filter）；修复后两包 266/266 全绿、tsc 0 错、oxlint 0
- **已 git commit**：`620a4bdd02`（fix(inject) 1 文件 +1，P3 修复提交）；lefthook pre-commit 全过；skill-router WIP 未混入；lib/ 未跟踪不提交（仓库约定一致）；未 push（pre-push typecheck 因 skill-router 既有 4 错会失败，按约定不处理）
- **最新状态（2026-08-22 17:45）**：①挂载已迁移到 host 层（cordis.patch.yml，agent preset 已删，修 scope filter 掐断事件主因）②fsImpl 已接线（createRealFs 修复写盘 no-op）③lib 重建 16:54 ④cs2 summary 已实测生成（17:27，压缩在跑）⑤新旧 typecheck 修复/skill-router 已提交；**待办**：再重启 dsh 加载 code2-agent（17:43 创建晚于 17:40 重启）+ 实测修复后压缩链路
- 明细见 `docs/CHANGELOG.md` 2026-08-22「dsh-memory-manager 实施后质检 2 项修复完成 / 质检修复 P4 提交完成」条目

### ✅ guard-main-agent 误拦修复（2026-08-21）——P2 实施 + P3 质检 + P4 提交完成，等重启实测 + 耗时观察

- **计划**：`projects/project-execution-system/docs/计划-guard误拦修复.md`（v2，11 条验收）
- **改动**：timeoutMs 默认 5s→10s；超时重试 1 次（retryCount 默认 1，新配置）；caller abort 硬终止（fetch 0 次不重试）；HTTP 4xx/5xx/网络错/解析失败 fatal 不重试仍 fail-close；classify 每次记录 duration_ms + 决策日志带 errorType；bash 归类保持 CODE_CLASS_TOOLS 不动
- **验证**：115/115 测试全绿（104 基线无回归 + 11 新增）；guard 包 tsc 0 错；oxlint 0；tsdown 产物更新；host tsc guard 0 错（全仓仅剩 untracked skill-router 4 错，既有）
- **已 git commit**：`eb0083676aa1462d46b0a17b2e0963ee6e9a693e`（fix(guard) 7 文件 +255/-25，P3 质检通过后提交）；lefthook pre-commit 全过；skill-router 相关变更（apps/cli/package.json、tsconfig.host.json、pnpm-lock.yaml）未混入，工作区保留 skill-router WIP；lib/ 未跟踪不提交（与 090ba7e532 一致）；未 push（pre-push typecheck 因 skill-router 既有 4 错会失败，按约定不处理）
- **待办**：①主 agent 重启 dsh（用户操作）后实测诊断 bash 不再误拦（T10 人工验收）；②重启后观察 classifier `duration_ms` 日志 1-2 天统计 P95/P99（>10s 再议）
- 明细见 `docs/CHANGELOG.md` 2026-08-21「guard-main-agent 误拦修复实施完成 / P4 提交完成」条目

### ✅ guard-main-agent 插件（2026-08-21）——P2 实施 + P3 质检 + P4 提交完成，等 T10 人工验收

- **改动文件**：`packages/extensions/guard-main-agent/`（7 源模块 + 7 测试/104 用例）、
  `tsconfig.host.json`（登记两 extension 引用）、`apps/cli/package.json`（加 workspace 依赖）、
  `~/.dsh/.agent-presets/full/agent.cordis.yml`（追加 guard-main-agent 行，filePolicyPath）。
- **验证**：guard 包 tsc 0 错、oxlint 0 错、104 测试全绿；tsdown 根构建出 lib/index.js；
  全仓 typecheck guard-main-agent 0 错（剩余 4 错全在未纳入本任务的 untracked skill-router 测试）。
- **待办（T10）**：重启 dsh 后 Web GUI 实测 12 场景（代码拦截派发/诊断放行/分类降级/任务切换缓存刷新/文件权限7场景）。
- **已 git commit**：`090ba7e5329a347e41c02a59788b67ccb60e05cb`（feature/lan-access，feat(guard) 23 文件 +2885），lefthook pre-commit 全过；skill-router 相关行未混入（工作区保留 skill-router WIP）
- 明细见 `docs/CHANGELOG.md` 2026-08-21 guard-main-agent 条目 + 项目文档 POC/TDD 报告。

### ✅ project-planner 项目规划师建立（2026-08-20 23:5x）——已完成并实测

- 五环闭环全通：project-planner(规划)→plan-reviewer(评审)→code-agent(实施)→check-agent(质检)→提交
- 新增 ~/.dsh/.agent-presets/project-planner/（agnes），full preset 挂载 call_project_planner，实测产出合格计划

### ✅ 阶段6 dsh rc.7 → rc.8 升级 —— **已完成并生效**（2026-08-20 15:59 验证）

- merge rc.8（lan-access 保留）+ pnpm install + typecheck/lint 全绿 + build:web 成功（含 web-react 陈旧 lib 修复）+ dump-config 通过
- **重启后验证**：服务 active、served 新 dist（index-DOdwmf2A.js）、启动日志无错误、auto-memory 插件正常；端到端视觉 vision_describe 实测读出测试图（router-9888→agnes/agnes-2.5-flash 免费链路 OK）
- **注意**：本次重启因改 unit 后未先 daemon-reload，未带 `--no-open`（rc.8 自动开了一次浏览器）；已 daemon-reload 注册，**下次重启自动生效**
- 明细见 `docs/CHANGELOG.md` 2026-08-20 15:3x 条目

### ✅ 阶段5 辅助模型省钱全景 + 插件生态安装 —— 已完成并生效（2026-08-19）

- **A2 会话标题 → agnes**：`~/.dsh/profiles/web/cordis.patch.yml` 的 `session-title-llm` 配
  router-9888 / agnes-2.5-flash（覆盖 host 默认）。
- **免费 web 搜索**：`dsh-free-search@0.4.7`（bundle 激活）——搜索不再依赖 DEEPSEEK key，
  默认免费 Bing + 多引擎回退；实测 6+ 免费引擎 OK（见 CHANGELOG 5.2）。
- **跨会话记忆**：`dsh-persona-memory@0.1.19`（bundle 激活）——MEMORY.md/USER.md + 后台自动学习
  （B1 记忆评审用现成插件落地，比自写插件优）。
- **dsh-restart 放弃**：pnpm 11.22 peer 解析 bug；有 `dsh-lan restart` + 监控面板重启按钮替代。
- **重启问题修复**：0.4.5 缺 keyed slot `key` → 升级 0.4.7 官方修复版根治（Hermes 协作，见 CHANGELOG 5.5）。
- 明细见 `docs/CHANGELOG.md` 阶段5。

### ✅ 阶段4 压缩换 agnes 免费模型 —— 已完成并实测通过（2026-08-18 23:23）

- `~/.dsh/settings.yaml` 新增 `router-9888` provider（9888 软路由网关，`agnes-2.5-flash` 免费）。
- `~/.dsh/.agent-presets/full/agent.cordis.yml` 的 `compaction-basic` 配
  `summarizationProvider: router-9888` + `summarizationModel: agnes-2.5-flash` + `maxTokens: 8192`。
- 实测：`/compact` 触发压缩 → 9888 记账日志 `agnes/agnes-2.5-flash in=180648 out=1814 200`（23:23:18），
  压缩 100% 走免费 agnes，不再消耗主模型。明细见 `docs/CHANGELOG.md` 阶段4。

### ✅ 阶段2 工具备齐 —— 已完成并验证（2026-08-18 20:19 重启）

- 宿主配置 + full 预设 5 工具**已生效**。
- 修复过程见 `docs/CHANGELOG.md` 2.1b（依赖安装 + 补 `lsp`/`terminal` 服务插件）
  和 2.1c（删普通 `tool-bash`，解决 bash 同名工具冲突/不能选模型）。
- 重启后验证通过：`lsp`、`terminals`、`sessionQuery` 服务均挂载；会话列表只剩当前会话。
- 回滚预案（备用）：恢复 `~/.dsh/profiles/web/cordis.patch.yml` 为 `[]`，
  并按需从 `~/.dsh/.agent-presets/full/agent.cordis.yml` 去掉新增的 5 行。

## 下一步（阶段5 续）

1. **B2 技能养护**（curator）：定期用 agnes 扫描技能标记 stale/archived——是否值得做、用插件还是简单脚本，待评估。
2. **B3 检索改写**：用 agnes 改写 sessionQuery 查询——纯 FTS 已零成本，价值较低，可暂缓。
3. **免费搜索引擎微调**：searxng 某实例 429 可换实例；付费引擎可配 key 提升额度（非必须）。
4. **主目标仍为**：软路由 Hermes 接入 + 局域网统一管理平台（见 WORKSPACE.md 四）。

## 阻塞点 / 待用户提供

1. **软路由 Hermes（10.10.10.2:9119）接入方式**：
   - 需要登录凭据（dashboard username/password 或 SSH/ttyd 的 root 凭据），
   - 或用户告知接入细节。**这是"三方平台"能否成立的关键。**
2. **不同 agent 平台的接入协议**是否统一（ACP 等）——尚待讨论。
3. **Web 界面形态**偏好——尚待定。

4. **router-9888 软路由 400**（项目执行系统）：已修复（SSH 实锤，补丁生效，JSON 解析层正常）；gpt-oss-20b 子代理回归遇 groq 大请求限流 429（非软路由问题），plan-reviewer 保持 agnes-2.5-flash。

## 已确认的事实（备忘，避免重复探查）

- 局域网：本机 `10.10.10.9`，网关/软路由 `10.10.10.2`，Tailscale `100.67.219.105`。
- 软路由 .2 端口：22(SSH dropbear,免密不通)、80(LuCI)、7000/18080(面板)、
  7681(ttyd)、8081(目录)、5244(Alist)、8888(BasicAuth)、9119(**Hermes dashboard**，uvicorn，需登录)。
- 本机 Hermes：`~/.hermes/`，`hermes chat -q` 已验证可用（默认 deepseek-v4-flash/opencode-go）。
- 本机 Hermes dashboard：`127.0.0.1:9119`（同款 uvicorn+登录）。
- dsh 已于 2026-08-18 20:19 重启（工具备齐改动已生效，见 CHANGELOG 2.1b）；
  旧进程曾占 3080 端口导致重启报 `EADDRINUSE`，现已解决。

## 2026-08-22 dsh-memory-manager 修复（A/B/C）待重启验证

- 已完成：挂载迁移（host 层）+ poll 改活动会话 cwd + 生产真实 fs 接线 + 观测日志 + 包内 242 测试全绿（perFile 100%）+ lib 重建
- 关键：**生产 fs 接线是实施中发现的新根因**——不接线则压缩/审核写盘全静默 no-op，LLM 白烧钱
- **待用户手动重启 dsh** 后验证：turn/end 触发压缩、摘要落 workspace/.dsh-memory/、日志可见
- 未 commit（待 check-agent 质检）; 备份名 `.bak-mv-memory-manager-20260822-160515`
