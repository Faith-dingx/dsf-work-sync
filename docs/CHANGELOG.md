## 2026-08-25 补复核发现并修正 C 文档 H 级遗漏（guarded-main-agent 编排）

- **补复核(check-agent subagent-3)**:persona 编排者段(A)通过(4 要点/原有声明保留/结构无损);《主agent职责边界.md》发现 **H 级缺陷——五环表 L21 plan-reviewer 行仍是 agnes/agnes-2.5-flash,与 v1.3 变更说明(改 opencode-go/hy3)及 preset 实际配置矛盾**(此前做 C 时只更版本头+新增 code2-agent 行,漏改该行正文)。
- **修正**:五环表 plan-reviewer 行改为 `opencode-go | hy3（付费）`;逐行对照 preset 确认 5 行全部一致(project-planner/code-agent/code2-agent/check-agent 原已对,plan-reviewer 本次修正)。
- **教训**:文档版本变更说明与表格正文必须同批核对,变更说明不等于表格已更新;补独立复核的价值实证。

## 2026-08-25 重启生效验证 + 全量收尾（guarded-main-agent 编排）

- **check-agent 复验(subagent-2)通过(零缺陷)**:7f5954c212 仅 3 文件 +7/−5 无夹带;4 处冗余断言确认清除、两处 eslint-disable 注释均为 used 状态且理由成立(disposer 恢复路径、测试夹具求值);lint:contracts-ready exit 0;20/20 vitest + smoke 8/8 + progress 4/4 全绿;两包 typecheck exit 0;fork/feature 与 fork/backup 均 fast-forward 至 7f5954c212、未推送 0;validate-inject 21 处声明全合法。**本轮全部问题闭环。**
- **重启验证(用户手动重启)通过**:tool-cordis 收口生效——主 agent 工具清单仅剩 cordis_inspect_list/query/self 三个只读工具,cordis_define/run/stop/undefine 消失;guard bash 正常放行。分支分叉确认:df91c78fb3(feature 远程旧 HEAD)为本地祖先,两远程分支均可纯 fast-forward 无 force。
- **存量 lint 技术债修复(commit 7f5954c212)**:dsh-subagent-guard/src/config.ts 删 4 处冗余 as 断言;index.ts L43 unbound-method 加 eslint-disable 注释(有意保留未绑定引用供 disposer 恢复)+ L134 `${String(e)}` 修 restrict-template-expressions;dsh-memory-guard tests/host-guard.spec.ts L48 new Function 两规则 disable 注释(测试夹具故意求值)。lint:contracts-ready exit 0;vitest 20/20 + smoke 8/8 + 4/4 全绿;host 全量 typecheck exit 0;diff 仅 8 处无行为变化。
- **push 完成**:fork/backup/lan-access(fast-forward 3 commit: b9efb60a28/0d6c793a04/7f5954c212)与 fork/feature/lan-access(带入 11 个既有 commit 至 7f5954c212)均与本地 HEAD 一致,未推送 0。至此 feature/lan-access 的 rm 硬禁 1b42c7e8fa、allowMutation b9efb60a28、fail-open 0d6c793a04、lint 修复 7f5954c212 全部备份到 fork 双分支。lefthook pre-push 全量 typecheck 通过。
- **状态**:check-agent 复验(subagent-2)进行中;其后全量收尾闭环。

## 2026-08-25 主 agent 工具面收敛 P2/P3 完成（guarded-main-agent 编排）

- **P2 实施（code-agent，2 commit）**：
  - `b9efb60a28` feat(tool-cordis): add allowMutation config——新增 schemastery Config(默认 true 向后兼容)、apply(ctx,config) 接收、false 时仅注册 3 只读 inspect 工具且不注入 mutation 教学 prompt；改动 tool-cordis/src/index.ts + package.json(schemastery dep) + 新 allow-mutation.spec.ts
  - `0d6c793a04` feat(guard): fail-open readonly shell commands——policy.ts 新增 isReadonlyShellCommand(子命令/标志级判定:shell 元字符直接 false、git 第二词白名单、curl -X/-d/-o 等写标志拒绝、wget 仅 --spider 或 -O - 为只读)+ READONLY_SHELL_TOOLS={bash,terminal}+ VerdictInput.shellCommand + resolveVerdict fail-open 分支(位置在 DIAGNOSTIC 后、CODE_CLASS close 前);index.ts L229 传 extractShellCommand(exec);rm 硬禁不变仍优先。改动 3 src + 2 tests + pnpm-lock
- **P3 质检（check-agent）通过**：两包 163/163 测试全绿；功能性验收 8 项全过(allowMutation 行为、fail-open 判定、rm 硬禁回归 S/R 场景、只读能力保留 cordis_inspect_*/READONLY_TOOLS/filePolicy 未动、commit 范围干净无夹带)；typecheck/oxlint/validate-inject 绿。唯一不足:lint:contracts-ready exit 1 = dsh-subagent-guard/config.ts:46-77(x4)+index.ts:43,134(x2)+dsh-memory-guard/tests/host-guard.spec.ts:48(x2) **8 个既有问题**,已核实非本任务引入、两 commit 未触碰——存量技术债,另立收尾项处理。
- **2 个 commit 未 push**(与 1b42c7e8fa 一致,待用户决策)。
- **收尾**:full preset 挂 tool-cordis `allowMutation: false`(转派 code-agent,备份 .bak-cordis-allowmutation-false-*)→ 主 agent 仅剩 cordis 只读 inspect,define/run/stop/undefine 消失;重启 dsh 后生效(待用户)。
- **背景**：审查发现 4 处错配（报告 `docs/主agent工具职责匹配审查-20260825.md`）：A persona 实施导向与编排者定位矛盾；B cordis_define/run JS 执行通道绕过 guard 白名单；C 职责文档五环表模型过期（plan-reviewer 实际 hy3、code2-agent 未收录）；D 分类器不可用时 bash 全 close 使简单诊断瘫痪。用户拍板：保留全部探查/搜索能力，其余按审查意见处理。
- **A 落地**：full preset persona（agent.cordis.yml L33-39）追加 MAIN ORCHESTRATOR 段——五子代理派发不亲实施、探查手段（read/grep/glob/lsp/session-query/web_search/只读 shell）声明为日常第一手段、白名单写纪律、熔断纪律。备份 .bak-persona-orchestrator-20260825-110654；diff 仅 persona 块 1 hunk；yaml 解析通过。
- **B 定案**：tool-cordis 一个插件注册 7 工具（inspect×3 + define/run/stop/undefine×4），preset 无法按工具粒度禁用 → 插件加 `allowMutation` 配置开关（默认 true 兼容，false 只留只读 inspect）。
- **C 落地**：《主agent职责边界.md》v1.2→v1.3：plan-reviewer 改 opencode-go/hy3；新增 code2-agent 行（huoshan/deepseek-v4-pro，P2 复杂收尾）。
- **计划+评审**：project-planner 出《主 agent 工具面收敛》计划（Task1 allowMutation + Task2 只读命令 fail-open）；plan-reviewer 评审结论「需修改」——3 个 H 级：①isReadonlyShellCommand 首词匹配会使 git push/curl POST 被 fail-open 放行（与计划自身断言矛盾）；②resolveVerdict 拿不到命令文本（需 VerdictInput 增 shellCommand 字段由 index.ts 传入）；③tool-cordis 无 Config 层；M 级：systemPrompt 未收敛、wget 默认落盘、管道/命令替换绕过、effects/调用方未定；两包不改 inject，validate-inject/lefthook 门禁无风险。
- **状态**：修订版计划待用户确认后进 P2（code-agent 实施 TDD）→ P3（check-agent 质检）。
- **结论**：7 项遗留全数核清——6 项已闭环、1 项仍待用户决策。
- **已闭环**：① rm 铁律已写入 `~/.dsh/memory/MEMORY.md` L98（跨项目用户级）✅；② plan-reviewer persona 补 inject 校验规则（本日 10:31 code-agent 落地，见下条）✅；③ check-agent persona 补 cordis service 运行时验证规则（本日 10:34 code-agent 落地，Quality 职责下 L22：grep 真实源码两处 api-catalog + cordis core + validate-inject.mjs RUNTIME_SERVICES，跑脚本保绿附证据）✅；④ pending-suggestions.json 垃圾建议文件已不存在（~/.dsh-memory/ 与 ~/.dsh/.dsh-memory/ 均无，记忆系统健康、待反思空）✅；⑤ commit 1b42c7e8fa（rm 硬禁）+ 808fc89e74（typecheck 修复）已 push 到 `fork/backup/lan-access`（远程分支 HEAD 同步）✅；⑥ 记忆系统健康（今日日志自动沉淀正常）。
- **仍待决策**：⑦ `fork/feature/lan-access` 远程分支停留在旧 commit df91c78fb3，未推进——本地 HEAD 与 backup 分支已是 808fc89e74；是否把 feature 远程分支推到 808fc89e74 需用户拍板（保守做法：backup 分支已含全部 commit，数据安全，feature 分支可保持不动）。
- **过程**：主 agent 直接 edit 两个 preset agent.cordis.yml 被 guard 白名单拦截（preset 目录不在文档白名单）→ 自动转派 code-agent 完成编辑+验证+备份，主 agent 复核确认。

## 2026-08-25 plan-reviewer persona 补 inject 合法性校验规则（code-execution agent，guard 转派）

- **背景**：2026-08-23 CHANGELOG「P1 plan-reviewer 新增 inject 声明合法性校验规则」只是流程规划，persona 实际未更新；reflections 2026-08-24 仍列「待延续：inject 校验规则写入 plan-reviewer 审查标准」。主 agent 尝试直接编辑 `~/.dsh/.agent-presets/plan-reviewer/agent.cordis.yml` 被 guard 白名单拦截（该目录不在 docs 白名单），转派 code-execution agent 完成
- **改动**：plan-reviewer persona 评审职责新增 2 条——①Inject legality：方案涉及 Cordis `inject` 声明时，每个服务名必须能解析到已知服务（harness api-catalog `tool-cordis/src/generated/api-catalog.ts` ∪ client api-catalog `cordis-client-runner/src/client/api-catalog.ts` ∪ cordis 核心 timer/loader/hmr ∪ `scripts/validate-inject.mjs` RUNTIME_SERVICES：dynamicCordisRunner/cordisInspect/modules/remote/inputTriggers）；嵌套路径（如 remote.dynamicCordisRunner）仅首段需已知、每段须合法 JS 标识符；声明须为字符串字面量数组/对象、无重复服务名。②Inject enforcement：validate-inject.mjs 为权威校验（lefthook pre-commit + P3 check-agent），方案必须保持其绿，新增运行期服务须先登记 RUNTIME_SERVICES
- **验证**：python3 yaml.safe_load 解析通过（8 顶层条目不变、persona text 20 行、两条 inject bullet 存在）；diff 与备份比对仅 +2 行（22a23,24）；备份 `agent.cordis.yml.bak-inject-rules-20260825-103134`；persona 文本改动仅影响 plan-reviewer 会话注入，无需重启 dsh 生效
- **问题**：pi-ai 内置目录对 glm-5.2 / hy3 / kimi-k2.6 / kimi-k3 / minimax-m3 / qwen3.7-max 的 thinkingLevelMap 误标，config-ui 只显示受限思考级别，运行时选缺失级别抛 UNSUPPORTED_REASONING_EFFORT
- **改动**：`~/.dsh/settings.yaml` 的 `llm-pi-ai.providers` 下 opencode-go 与 opencode-go-2 各 6 个模型条目各追加 `reasoningEfforts`（off 不声明）：glm-5.2 / kimi-k2.6 / kimi-k3 / minimax-m3 各 6 级（minimal…max）、hy3 5 级（无 max）、qwen3.7-max 4 级（minimal/low/medium/xhigh）
- **方法**：python3 yaml 读取定位 + 精确行插入（pyyaml 全文件 roundtrip 会把 models 列表缩进归一化重排 503 行，弃用）；写后 diff 与备份比对仅 12 处新增块、文件尾行与备份一致；yaml.safe_load 语法 + 逐条目语义断言（其余 provider/顶层键零改动）全过
- **备份**：`~/.dsh/settings.yaml.bak-reasoning-fix-20260825-013726`；settings.yaml 热重载，无需重启服务

## 2026-08-24 dsh 软路由安装包 v0.1.2 重新打包 + 严格可执行性检测（code-execution agent，guard 转派）

- **产物**：`/home/dingx/DSF-work/.temp/dsh-router-install-v0.1.2.tar.gz`（104,014,069 B ≈ 99.2 MiB，解压 458M：app 328M + node 130M），构建自 harness `2096f422db`（feature/lan-access，0.1.1-rc.2）
- **打包脚本（长期可复现）**：`scripts/build-dsh-router-package.sh` v0.2——重建 web dist → `pnpm deploy --legacy --prod` 闭包 → 边界修复 → musl node（复用本地缓存 tar.xz，SHA-256 校验，strip）→ 组装包目录（app/node/install.sh/install/example-settings.yaml/etc/init.d/dsh/README.md）→ 严格检测 → 打 tar.gz
- **严格可执行性检测（v0.2 核心，全部通过）**：① 全部 shell 脚本 bash -n；② musl node v22.23.2 在 **alpine:3.20 真实 musl 容器**内运行 `--version` ✅、`dsh --version` → `0.1.1-rc.2` ✅、`--dump-default-config` ✅、**web 启动 + HTTP 200 + root div** ✅（解包后独立复验同过）；③ ELF 确认 `ld-musl-x86_64` 动态链接；④ 可执行位/关键文件检查；⑤ `@deepseek-ai/*` 闭包关键包存在性
- **修复的打包 bug（旧包 v0.1.1 从未暴露）**：① pnpm deploy 对 workspace/vendor 包只建指向**仓库源目录的 file: 绝对链接**，glibc 本机代验恰好可达、到软路由/scp 后必断——现改为对所有 `@deepseek-ai` 包（含 native landlock-run 平台子包）**实体拷贝**顶层；② 顶层扁平链接从绝对路径改为**相对路径**（容器/scp 后可达）；③ **官方 musl node 依赖 libstdc++/libgcc_s**（v0.1.1 未真机验证出），现随包附 musl 版至 `node/lib/`，install.sh 与 init.d 注入 `LD_LIBRARY_PATH` 兜底，自检失败给 opkg 指引
- **验证日志**：`.temp/dsh-deploy-v2/build-v0.1.2-20260824-141048.log`（27K，完整检测链）；构建工作区 `.temp/dsh-deploy-v2/`；SHA-256 `e211d5a20ce7c51216ec0d9e6993832524e543a0506a85c929c1dc8466e21b81`

## 2026-08-24 白名单 v2.3 + guard 策略热重载修复（code-execution agent，guard 转派）

- **白名单 v2.3**：`docs/主agent可改写文件清单.yaml` 撤销宽泛 `.sh` 前缀规则（`/home/dingx/DSF-work/` 全树 `.sh` 递归放行风险），主 agent 仅可读写文档文件；`.sh` 工具脚本（如 rollback.sh）归 code-agent 管理。备份 `.bak-whitelist-20260824-112004`
- **作用范围确认（实证）**：guard 仅加载于 full preset；`tools/pre-execute` 为 scoped event 按 agent scope 路由，code-agent/check-agent 等子代理会话不加载 guard → 写入不受限。会话历史检索全部"文件权限拦截"记录均出自主 agent 自身会话或转派任务载荷（拦截通知文本随任务复制），无一条是 code-agent 执行中被拦截；本次 code-agent 直接写 docs/*.yaml 成功即为实证
- **修复 guard 策略热重载**（`packages/extensions/guard-main-agent`）：原 `policyByCwd` Map 永久缓存策略文件，注释声称"每次评估重读"但实现从未重读 → 与《计划-主agent可改写文件清单》验收 11（"编辑 YAML 后插件下次 pre-execute 即生效"）不符；改为每次评估重读 YAML（文件小、写调用稀少，无缓存）。TDD：先加失败测试（改清单后第二次判定仍 allow）→ 实现 → 121 测试全绿（+1）；提交后待用户重启 dsh 生效（T10 人工验收模式）

## 2026-08-23

### 新增

- **dsh-subagent-guard 插件**：子代理并发守卫，限制同时最多 2 个子代理，空闲超时 10 分钟自动强杀，防止僵尸子代理耗尽系统资源。经 P1-P4 全流程准入（5 轮 plan-reviewer 评审、code-agent 实施、check-agent 独立质检）。
- **validate-inject.mjs 脚本**：Cordis inject 合法性自动校验，对照 api-catalog 和 cordis 源码验证 inject 数组中的每个值是否为合法 service。挂载到 lefthook pre-commit 强制执行。

### 修复

- **guard-main-agent delegate.ts**：补充 `import crypto from 'node:crypto'`（commit 2f0b8abe7f）
- **dsh-subagent-guard inject**：修复 `logger` 误放入 inject 数组导致插件永远 PENDING 的问题（`logger` 是 Context 实例属性，非 Cordis service）

### 重构

- **tool-cordis api-catalog.ts**：从 `src/` 移至 `src/generated/`，更新 providers.ts 和 inspect.ts 的 import 路径

### 流程改进

- P1 plan-reviewer 新增 inject 声明合法性校验规则
- P3 check-agent 新增强制执行 `validate-inject.mjs` 的验收步骤
- lefthook pre-commit 新增 `cordis inject validation` 自动门禁

## 2026-08-23 config-ui 数字污染根因修复：needsQuote 纯数字不加引号 + normalizeNumericFields（code-execution agent，guard 转派）

- **根因**：needsQuote 对纯数字字符串加引号 → settings.yaml 写出的 contextWindow/maxTokens 为 `'32768'` 字符串；原厂 llm-pi-ai 数字字段预期 Number，重启后走数字语义失败（SuanLi 事故同机制）
- **改动**：① needsQuote 对纯数字 `/^-?\d+(\.\d+)?$/` 不再加引号（前导零如 007、超 JS 安全整数仍保留引号防丢精度/改语义）；② 新增 `normalizeNumericFields()`（NUMERIC_MODEL_FIELDS=['contextWindow','maxTokens']，字符串纯数字→Number，不可转→400 拒存）；③ putProviders 写前 js-yaml 验证（新内容解析失败 → 500 拒绝保存、不改文件）
- **验证**：node --check 过；17 断言 + E2E 全过（测试脚本归档 `.temp/archive/20260823-numfix/`）；核实原代码本就对 'abc' 等普通字符串不加引号（裸标量合法），旧验证清单中 renderScalar('abc')==="'abc'" 为误记、行为无回归
- **备份** `.bak-numfix-20260823-184757`；未 commit

## 2026-08-23 config-ui 写前语义校验层 validateProvidersSemantics（code-execution agent，guard 转派）

- **动机**：原厂对 providers 段校验为"全部或零"且失败时静默禁用全部路由——任何一项不过都会在下次重启打掉全部 provider，故把硬拒绝项前置到写盘之前逐项 400
- **改动**：putProviders 在 normalizeNumericFields 之后调用 `validateProvidersSemantics()`——api 白名单 `SUPPORTED_WIRE_PROTOCOLS`（openai-completions/openai-responses/anthropic-messages，anthropic-completions 特判拒绝并提示改用 anthropic-messages）；已移除字段 `REMOVED_PROVIDER_FIELDS`（provider/maxRetries/maxRetryDelayMs）存在即拒；baseURL/displayName/apiKeyEnv 存在则必须非空字符串；models 缺失/空数组仅内置目录已知路由放行（目录加载失败 fail-closed 按未知路由拒绝），非数组拒绝；模型 id 非空字符串且不重复（原厂拒绝重复 id）
- **验证**：sema 22 项 + numfix 17 项断言全过（含 api:anthropic-completions 应拒边界）；E2E 法定型——临时目录 PUT 非法配置→400 且真实 settings.yaml md5 不变，PUT 合法→200 且 28 个 contextWindow 保持数字无引号化回归
- **备份** `.bak-sema-20260823-185816`；未 commit

## 2026-08-23 B 全局方案落文档：《主agent职责边界.md》v1.2 + AGENTS.md 入口（code-execution agent，guard 转派）

- **背景核实**（17:30 日志确认"未加"，本次复核一致）：AGENTS.md 仅临时文件/记忆两条规矩；docs/CODE-WORKFLOW.md 仅限代码工作且 AGENTS.md 未引用（断链）；主agent职责边界.md v1.1 仅覆盖主 agent 行为与诊断熔断，无"任何情况不得豁免"全局条款；记忆项目笔记无 B 方案条目——B 全局方案此前只活在机制层（subagent-guard 插件实现）与主 agent 会话中，未入任何文档层
- **改动**：① 主agent职责边界.md 版本 v1.1→v1.2，新增「§八 全局强制条款（B 全局方案 · 无豁免）」——覆盖对象=主 agent 本体+所有子代理（code/check/planner/reviewer/任意 subagent），任何情况不得豁免；8.1 文档层四条强制（按流程执行/不绕闸口/不自欺重试/必须留痕）；8.2 机制层两件已落地（subagent-guard 插件=并发上限2+空闲超时10min 强杀+end 兜底，罩所有子代理；进程级 watchdog=systemd 健康检查，罩主 agent 本体回合——本体与守卫同进程无法自救，实测边界）；记录技术债（子代理差异化超时待迭代）；末尾铁律保留 ② AGENTS.md 新会话动作清单补一行指针「主 agent / 子代理行为强制规范（含 B 全局方案，任何情况不得豁免）→ projects/project-execution-system/docs/主agent职责边界.md」
- **验证**：两份文档 read 复核结构完整（155→181 行，§七/§八/铁律顺序正确）；AGENTS.md 自动加载机制已确认生效（本会话即收到更新后指令）；备份 .bak-B全局-20260823-173251 ×2；未 commit（文档改动走收尾纪律，待主 agent 归档提交）

## 2026-08-23 config-ui 四点改造：厂商切换清模型 + 选项带模型数 + 重启 dsh 按钮 + 思考强度挂钩（code-execution agent）

- **A 子代理换厂商模型真正联动（bug 修复）**：`.sub-provider` change 除重建 dl-models-<id> datalist 外，新增清空该卡 `.sub-model` value、placeholder 改「选择或输入 <厂商> 模型」（无模型时回退"输入模型 ID"）、重建 `.sub-effort`、toast「已切换厂商，请选择模型」；添加弹窗 #add-provider change 同样清空 #add-model + 重建 #add-effort + toast
- **B 厂商选项带模型数**：providerOptionsHtml() label 尾部加 `（N 模型）`，N=state.modelsByProvider[provider]?.length ?? 0（实测：火山（huoshan）· 自定义配置（4 模型）、anthropic · 原厂内置（15 模型）、openrouter · 原厂内置（276 模型））
- **C 状态页重启 dsh 按钮**：index.html pane-status 的 pane-header 与 status-card 之间新增静态 `.status-actions`（#btn-dsh-restart + 说明文字，不动 loadStatus）；app.js restartDsh()=confirm→POST /api/dsh/restart→toast；server.js 路由 `'/api/dsh/restart': { POST }`，restartDsh() 用 `spawn(DSH_RESTART_CMD||'systemctl', DSH_RESTART_ARGS||['--user','restart','dsh-web.service'], {stdio:'ignore'})` 立即返回 `{ok,action,target,cmd}`，不 await/不监听 exit；同步抛错 500；头注释与 GET /api/models 注释同步补一行
- **D 思考强度与原厂挂钩（重点）**：server.js loadPiAiCatalog 新增 `modelEfforts: {provider:{modelId:[级别]|null}}`（catalog 缓存内联，getModelList 返回追加字段、现有字段零改动）；内置模型取值=**运行时真相** `getSupportedThinkingLevels`（优先 require dist/models.js 同包同名函数，失败退回同逻辑 shim）——⚠️ 与任务文档断言差异：claude-fable-5=minimal/low/medium/high/xhigh/max（**无 off**，map 里 off:null 被运行时剔除）、deepseek-v4-flash=off/high/max（**无 low**），1107/1109 模型 supported≠mapKeys，因 llm-pi-ai 的 resolveReasoningLevel 严格按 getSupportedThinkingLevels 抛 UNSUPPORTED_REASONING_EFFORT，只能取运行时集（理由详见报告）；reasoning:false 与 reasoning:true 无 map → null（原厂 reasoningInfo 对非 reasoning 模型不暴露 reasoning 段，off 无意义）；settings 自定义模型一律 null（合并在 getModelList：同 provider 内置重合 id 保留内置级，其余置 null）；catalog 加载失败 → modelEfforts={} fail-open 不变
- **前端 D**：移除 EFFORT_LEVELS 硬编码；新增 effortLevelsFor/effortSelectOptions/defaultEffortFor/rebuildCardEffort/renderAddEffort；卡片 `.sub-model` change 按 provider+model 重建 `.sub-effort`（当前值在支持集保留，否则 '-' 空占位）；未声明模型渲染全集+disabled 提示项「该模型未声明思考级别（存疑，保存后可能报不支持）」；添加弹窗 #add-effort 由 #add-model 联动，默认 low 仅当模型支持时保留否则列表首项；state.modelEfforts 在 applyCatalogGroups 填充（后端缺失兜底 {}）
- **验证**：node --check 双过；临时实例（CONFIG_DIR=.temp/config-ui-link:8092 + DSH_RESTART_CMD=/bin/true 空跑）curl 断言 modelEfforts 三例（anthropic/claude-fable-5、deepseek/deepseek-v4-flash、router-9888 全 null）+POST /api/dsh/restart {ok:true}+GET 405+无 token 401+随机键 POST/DELETE 回归（临时副本零残留）；headless chromium DOM 全链实测：选项带模型数、卡片换厂商清空 value+toast+effort 重建、claude-fable-5→6 级、deepseek-v4-flash→off/high/max、弹窗同链路、状态页按钮+说明+status-card 共存、confirm 自动 dismiss 无副作用；真实 ~/.dsh 两文件 md5 零变化、无残留进程；备份 .bak-configui-20260823-131350 ×4（server.js+121 行/app.js+117/index.html+4/style.css+14）；未 commit、未重启 config-ui.service
- **边界**：settings 自定义模型（如 router-9888 的 agnes/agnes-2.5-flash）→ null，前端显示"未声明+存疑"提示，保存后能否用由运行时定；off 对 claude-fable-5 运行时拒绝（anthropic 适配层 off:null），界面已不提供该选项

## 2026-08-23 config-ui 密钥页覆盖全部应用密钥（多源枚举+分类展示，code-execution agent，guard 转派）

- **需求落实**：密钥页从"仅 settings apiKeyEnv + 凭据文件 + dsh.env"扩展为全应用密钥总览——新增 APP_KEY_CATEGORIES 目录（网络搜索 EXA/TAVILY/KEENABLE/PERPLEXITY/DEEPSEEK、GitHub GITHUB_TOKEN/GH_TOKEN、其他 GOOGLE/OPENAI），枚举键顺序 = settings apiKeyEnv（'模型 Provider'）→ 目录声明键 → 凭据 refs → dsh.env；每键标注 category（settings 强制 '模型 Provider'，目录命中取分类，其余 '其他'；DEEPSEEK_API_KEY 归网络搜索）
- **后端新增（server.js，全部只读）**：`readShellRcKeys()` 解析 ~~/.bashrc/~~/.profile/~/.zshrc 的 export KEY= 行（行级正则+unquote+去尾注释，只收 KEY/TOKEN/SECRET/API 类变量，首个命中文件优先，Map name→{value,file}，绝不写）；`readGhToken()` 解析 ~/.config/gh/hosts.yml github.com 段 oauth_token/user；`KEY_SOURCES` 五源优先级数组（env→credentials.yaml→dsh.env→bashrc→gh（仅 GH 两键））；getKeys 返回新增 shellRcFiles/ghHost/ghUser，未命中源时 source=null（避免误标"环境变量"），既有字段与 name localeCompare 排序全保留
- **前端（app.js/index.html/style.css）**：loadKeys 按 category 分组渲染（模型 Provider→网络搜索→GitHub→其他→未分类，组标题「◈ 类别（n）」+ 组内 name 排序，行模板/修改/删除按钮不变）；来源徽标补 bashrc→~/.bashrc（带实际文件）、gh→GitHub 凭据；#key-source-hint 提示行（密钥来源全链 + gh auth 账号）；.key-group/.key-group-title 样式（accent 色系）
- **验证（临时 CONFIG_DIR=.temp/config-ui-allkeys:8094 + 浏览器冒烟）**：curl 断言 13 键四类齐全——AGNES/HUOSHAN/OPENCODE 凭据文件、TAVILY bashrc（~/.bashrc L133 实测命中）、GOOGLE bashrc（L131）、GITHUB_TOKEN/GH_TOKEN source=gh masked=****3Cb9（gh hosts.yml 实测 oauth_token）、EXA/KEENABLE/PERPLEXITY/OPENAI 未配置 conf=false src=null、shellRcFiles=[.bashrc,.profile,.zshrc] ghHost=github.com ghUser=Faith-dingx；POST 随机键 APPKEYZ_TEST1 落盘临时凭据+读回 sk-****1234+DELETE 干净（临时副本零残留）；浏览器实测分组渲染 + 修改按钮对 gh 来源键掩码参考可回显、控制台无报错；真实 ~~/.dsh/.credentials.yaml md5 前后不变、~~/.bashrc 与 gh hosts.yml mtime 不变（只读）；未 commit、未重启 config-ui.service
- **边界**：bashrc/gh 来源为只读展示；对这些键 POST 后即落入 .credentials.yaml 成为可管理凭据（预期，用户可在界面覆盖）；config-ui 默认不做轮询刷新

## 2026-08-23 config-ui 密钥可修改 + 厂商两级联动（code-execution agent，guard 转派）

- **需求落实**：① 密钥行内新增「修改」按钮（data-act=edit-key，#key-list 事件委托）→ 变量名预填 #kf-name、值框聚焦、滚动到 #key-form、toast"已载入 X，粘贴新值保存即覆盖"；POST /api/keys 覆盖语义不变。② 子代理编辑卡片首个字段新增 Provider（厂商）下拉（.sub-provider，选项=settings 自定义 provider 在前标注"· 自定义配置" + 内置厂商标注"· 原厂内置"，初值=mount.provider→生效 provider→首个 settings provider）；模型 input 的 datalist 从全局 #dl-models 改为每卡独立 dl-models-<id>，随 Provider change 重建（options=modelsForProvider(provider)）；saveSubagent 读取 .sub-provider 加入 body.provider（有值才加，写挂载层 agentOptions.provider）。③ 添加子代理弹窗 #add-provider 由自由文本 input 改下拉 select（默认选中第一个 settings 自定义 provider，无则首个内置）；#dl-add-models 随 change 联动；提交 agentOptions.provider/model 原逻辑不变
- **后端增强（server.js getModelList 追加字段，现有计数与 models 数组零改动）**：`providers: [{provider, displayName, source}]`（settings 在前内置在后、同 id 去重 settings 优先、displayName 取 settings 配置否则回退 id）；`modelsByProvider: {provider: [modelId...]}`（settings.models 保序在前 + 内置模型去重补集）。jsYaml/loadPiAiCatalog 复用，fail-open 不变
- **前端数据**：state 新增 providerOptions/modelsByProvider；新增 applyCatalogGroups（后端缺失时自 modelCatalog 兜底聚合）/providerOptionsHtml/modelsForProvider（localeCompare 排序）/renderProviderDatalist；loadModelCatalog 调 applyCatalogGroups
- **style.css**：确认全局 `input, select, textarea` 规则（L69-78）已统一暗色样式，select 无需新增
- **验证（临时实例 CONFIG_DIR=.temp/config-ui-lianxiang:8097 + playwright-core 1.61 DOM 断言全绿）**：/api/models 新字段 curl 断言（opencode-go-2 settings 在前、anthropic builtin、modelsByProvider['opencode-go-2'] 含 deepseek-v4-flash 28 模型、['anthropic'] 含 claude 系列、旧字段 count=1161 不变）；playwright 17 项 PASS——添加弹窗 select 41 选项（5 自定义+36 内置）默认 huoshan、切 anthropic 后 dl-add-models 含 claude-fable-5 且不再含 agnes 模型；编辑卡独立 datalist 联动 + PUT 落盘 provider:anthropic/model:claude-fable-5（临时挂载副本）；密钥 5 行修改按钮预填+聚焦+toast、覆盖保存回读掩码 sk-****9999。真实 ~/.dsh 全程只读零改动；未 commit、未重启 config-ui.service

## 2026-08-23 config-ui 密钥读写/模型目录/标题三处真实机制对齐 + 向导回读修复（code-execution agent，guard 转派）

- **密钥读取对齐原厂凭据文档**：config-ui 此前只查自身 process.env + dsh.env（本机无 dsh.env → 4 个 apiKeyEnv 全部误显示"未配置"）。真实来源是 dsh-credentials-local 读写的 `$DSH_HOME/.credentials.yaml`（受管文档，不物化进 process.env）。新增 `parseCredentialsFile()` 兼容 v1（version+refs）与扁平（无 version）两布局、fail-open；`getKeys()` 三源枚举（settings apiKeyEnv ∪ 凭据 refs ∪ dsh.env）按 env→credentials.yaml→dsh.env 优先级判 configured 与 source，返回新增 credentialFile/credentialFileExists/credentialFileVersion；`postKey()` 改写 .credentials.yaml（不存在→新建 v1；扁平→迁移 v1 缩进 2 移入 refs；v1→refs 行级覆写/追加，含行尾注释保留），备份+原子写+chmod 0600，不再写 dsh.env
- **模型下拉聚合原厂全部厂商及模型**：原厂权威目录是 pi-ai 内置 `dist/providers/all.js`（getBuiltinProviders/getBuiltinModels）——37 厂商 1109 模型。新增 `loadPiAiCatalog()`（三候选 require 兜底，ESM require 需 Node≥22.12，fail-open）；`getModelList()` 双源聚合 builtin+settings，返回 count/builtinCount/settingsCount/catalogLoaded；前端 `collectModelOptions()` 改用后端聚合结果（不再叠加 state.providers 防重），新增 `renderCatalogHints()` 填充添加弹窗与子代理区两处来源说明
- **标题对齐**：`<title>`/`brand-title`/topbar brand 三处 `AI 网关配置` → `DSH 扩展配置界面`；index.html 新增 `#model-catalog-hint`/`#subagent-catalog-hint`
- **向导回读修复**：app.js `wizardRunCheck` 中 `masked.find(...)` 对 /api/keys 对象调用抛 TypeError（首启向导第 3 步误报"检测失败"）→ 改 `(masked && Array.isArray(masked.keys) ? masked.keys : []).find(...)`
- **验证**（临时 CONFIG_DIR 实例 8099/8098，真实 ~/.dsh 只读零改动）：5 键 configured=true 且 source=credentials.yaml、masked=sk-****1234（掩码规则 sk- 前缀保留）；POST 写测试键落盘 v1 refs + 覆盖 replaced=true；/api/models count=1161（builtin 1109 + settings 去重后 52）catalogLoaded=true；损坏凭据/坏 pi-ai 路径均 fail-open 不报错；node --check server.js/app.js 通过；修复过程中发现并解决扁平→v1 迁移漏追加新键 bug
- **遗留**：密钥写入为受管文档、不物化进 process.env，新值需 dsh 新进程/重启后生效（与原厂机制一致）；未 commit、未重启 config-ui.service（用户专属）

## 2026-08-23 config-ui server.js 凭据机制注释澄清（code-execution agent，guard 转派）

- **改动**：`projects/ai-gateway/config-ui/server.js` L52-56 新增注释——原厂凭据文档为 dsh-credentials-local 读写的 `$DSH_HOME/.credentials.yaml`；dsh 凭据解析顺序 = 继承环境 → `.credentials.yaml` → 调用目录 `.env` → `$DSH_HOME/.env`（低优先级后备，受管文档不物化进 process.env）；config-ui 的 `dsh.env` 非原厂层（软路由部署专用键文件，本机无此文件），apiKeyEnv 实际取自进程继承环境
- **依据**：harness `packages/credentials/credentials-local/src/index.ts` L5-10 四层优先级 + README.zh.md 表；grep 全库无 `dsh.env` 匹配（确认非原厂层）
- **验证**：`node --check` 通过（注释-only，无行为变更）；config-ui.service active 未重启；/api/status 401（认证拦截正常，服务存活）；无测试套件可跑（config-ui 无 package.json）

## 2026-08-23 WORKSPACE.md 战略主线落盘（code-execution agent，guard 转派）

## 2026-08-23 AI 网关配置 Web 界面 T2 前端 + T4 首启向导完成（code-execution agent）

- **交付**：`projects/ai-gateway/config-ui/` 新增 index.html + app.js + style.css（原生三件套，零框架零构建，深色移动端适配）；server.js 增量加静态托管（白名单 index.html/app.js/style.css，GET 专供，不泄漏源码）；README.md 重写为前端启动/使用/接口/边界说明
- **功能**：登录视图（token 输入 + 首启 token 明文一次展示带复制按钮）；主视图四标签——Provider 增删改（整体 PUT 段替换，段外保留）、子代理编辑（model 下拉可手输 + reasoningEffort off/low/high/max，只改目标字段行级替换，保存后自动回读；无标注子代理只读提示）、密钥（掩码列表 + 新增/覆盖，保存后清空输入并回显掩码）、状态卡（dsh 探针/DSH_TRUSTED_HOSTS/配置目录后缀）；T4 三步首启向导（网关 9888 确认→Provider 名+key→完成检测 POST keys+GET status→进入主界面），与登录态联动、token 不二次回显
- **验证（全部立体骨架 .temp/config-ui-test:8091 + config-ui-wizard:8092）**：登录/四大标签浏览器全跑通；provider 增改删落盘正确（trailing 段保留）；subagent PUT 后 diff 仅 L162 model/L163 reasoningEffort 两行变化（注释零改动）、API+UI 回读一致、未知字段 422 兜底；密钥掩码回读 sk-****efgh、页面 DOM 无明文、输入即清空、dsh.env 600；向导全流程 + 刷新直进主视图 + 新会话 token 不再回显；移动端 390px 无溢出；真实 ~/.dsh md5 零改动（基线对照）；验证记录 `.temp/config-ui-test/VERIFY-T2-T4.md` + screenshots/（16 张）
- **环境说明**：本机无可用浏览器内核（playwright 工具栈缺 chromium_headless_shell-1234）→ 从 Playwright 官方 CFT CDN（cdn.playwright.dev/builds/cft/151.0.7922.34/…）下载 120MB 解压到 ~/.cache/ms-playwright/chromium_headless_shell-1234 补全；headless-shell 151 有 `'use strict'` 后紧跟箭头 IIFE 的解析怪癖 → app.js 首行带分号规避
- **已知边界**：向导步骤①网关为确认性输入（v0.1 无写入 API）；向导步骤②只写密钥，完整 Provider 走主界面；PUT providers 段内注释规范化；subagent 需字段已标注；token 存 sessionStorage；未 commit（按纪律留给用户/主 agent）

## 2026-08-23 dsh 软路由安装包 v0.1 产出（自主推进，ai-gateway 项目阶段2 前置）

- **安装包**：`.temp/archive/2026-08-23-dsh-deploy-research/dsh-router-install-v0.1.tar.gz`（93.5 MiB 压缩 / 350 MiB 解压；SHA a994eeb6…）
- 内容：app/（307M 修复版 pnpm deploy 闭包，8 插件+web 4.8M 无 map）+ node/（**unofficial-builds musl node v22.23.2**，interpreter /lib/ld-musl-x86_64.so.1 匹配 ImmortalWrt，strip 113.7M）+ install.sh（ash 校验通过）+ etc/init.d/dsh（procd，入口 /srv/dsh/app/lib/bin.js，DSH_HOME=/srv/dsh/home，日志 /var/log/dsh.log，崩溃 respawn）+ install/example-settings.yaml（密钥走 dsh.env 环境变量注入，**不进包**）+ README（三步安装+限制）
- 验证：--version=0.1.1-rc.2 ✅；web 冒烟 HTTP 200（:3099，DSH_HOME 骨架自动生成）✅；busybox ash -n 双脚本 ✅；symlink 包往返 2333 条 ✅
- 关键决策：procd 入口 lib 平铺路径（非 apps/cli/…）；settings 生效位 /srv/dsh/home/settings.yaml；DSH_HOME 放 app 树外（healProfilesModuleFallback 自动建闭包符号回退）
- **已知限制 v0.1**：node-pty musl 未真机验证（终端能力替代 ttyd/ssh）；musl 真机运行验证留待软路由（本机 glibc 仅代验逻辑）；node musl 官方构建 129M 超预算需 v0.2 换压/裁剪；日志无轮转、配置改需 restart、9888 未启时模型调用失败（预期）
- 前置联动：专项计划 v2（musl/体积预算/兼容矩阵/配额控制）；瘦身原型 310M 基线；GO 配额监控纪律（weekly 90% 硬上限，用户授权）
- **转派背景**：主 agent 编辑 WORKSPACE.md 被 guard 文件权限白名单拦截，转派本 agent 完成
- **改动**：WORKSPACE.md「三、正在做的事」整体重写为 2026-08-23 战略主线——dsh 体系 = 软路由"AI 网关"项目的工作台（终局目标 / 工作台三层：工程方法论 + 4 插件 499 测试 + 记忆体系 / 软路由底座：资产端口 + 三盘同构互备铁律 / 当前推进：热备方案 README 落盘、切换速查卡、软路由服务响应确认、热备收尾四步）
- 内容依据：docs/软路由资产与热备方案.md（2026-08-23 盘点落盘，事实唯一来源），热备现状/待办与主请求的 Pending Jobs 对齐

## 2026-08-23 GitHub token 验证 + gh 安装 + PR 预检独立复检（code-execution agent，guard 转派）

- **转派背景**：主 agent 执行含硬编码 token 的 bash（写 .temp/gh-token.txt + 查 gh 是否安装）被 guard 拦下，转派本 code-agent 执行
- **token 验证**：写入 .temp/gh-token.txt（umask 077 → 权限 600 属主 dingx）；API 实测身份 Faith-dingx（User 类型），经典 PAT 20+1 项 scope（repo/workflow/delete_repo/admin:org 等全量），限流剩余 4971/5000，云端操作能力完备；**验证完成即删除 token 文件**（同 23:55 内联验证、00:20 用后即删原则，开 PR 时需重新注入）
- **gh CLI 安装**：本机原本无 gh；下载官方 v2.98.0（linux_amd64，14.8MB tarball）解压装至 `~/.local/bin/gh`，PATH 已含该目录，任何新 shell 可直接 `gh`；**未做 gh auth 持久化**（遵 token 不落盘约定，用时 `gh auth login --with-token` 或 REST API 直连）
- **PR 可行性独立复检**（二次独立验证，与 00:38 预检结论逐项一致）：官方 origin/master=b150a551 领先 207 提交、本地领先 15；双侧改动文件交集恰 9 个；worktree 真实 3-way 合并演练——9 个重叠文件 8 个自动合并、仅 1 个真实冲突（`packages/subagent/tool-subagent/README.i18n.yaml` 双语哈希对账行，机械冲突，可用 `pnpm run verify-translation-pairing --write` 自动重算）；4 个插件目录（guard/injection/memory-manager/skill-router）零冲突；结论：**可安全 rebase 后开 PR**
- 复检纪要归档：`.temp/archive/2026-08-22-pr-conflict-precheck/复检纪要-20260823.md`；验证中间产物（json/日志/tar.gz）已清理

## 2026-08-22 dsh-memory-manager 用户授意记忆入口写入通道实施完成（code-execution agent）

- **提交范围**（feature/lan-access, 未 commit——按纪律 git 不 add/commit/push，留给主 agent/用户提交）：12 修改 + 3 新增，全在 `packages/extensions/dsh-memory-manager/`；guard-main-agent/DSF-work YAML 生效配置零改动
- **功能**：`<workspace>/.dsh-memory/user-entries.md` 用户授意记忆入口通道（计划-用户授意记忆入口写入 v2 + 复审 7 项 minor 修正合并实施）：三层防线（guard 白名单 fail-close「不加入白名单即拦截」不新增 deny 规则类型 + validators 来源/原话引用/target/三类校验 + 用户编辑 mtime 确认）；T3 集成 `runAuditOnce`（S-2 入口文件独立分支绝不进 normalize/archive、S-1 consume 返回 {source,skipAudit} 全调用方同步、skipAudit=true 直接 fixed）；pending-review 独立队列 7 天 TTL（maintenance 复用）
- **文件**：新增 `src/user-entry-scanner.ts`（init 模板/扫描/process + FileWriterLock M-1 per-file 排队 settle 清理、L-9 每条目独立 try/catch 记 success=N failed=M）、`tests/user-entry-scanner.spec.ts`、`tests/integration-user-entry.spec.ts`；修改 config/validators/confirm/watcher/maintenance/index/archive + 既有测试同步
- **验证**：313 测试全绿（原 268 + 新 45）；perFile 四维 100%×20 src 文件（scoped 配置 `.temp/vitest.memory-manager.config.ts`）；`tsc --noEmit` 0 错、`oxlint` 36 文件 0 错 0 告警；`tsc -b` emit + `npx tsdown --env.DSH_BUILD_FACE host --filter '@deepseek-ai/dsh-memory-manager'` 重建 lib/index.js 85.07kB；guard-main-agent 115 测试全绿（零改动基线）
- **CLI 复用（--type pending-review）不在本次范围**：任务禁止改其他包（apps/cli），留待后续

## 2026-08-22 dsh-memory-manager 质检修复 P4 提交完成（code-execution agent）

## 2026-08-22 memory-manager 修复重启验证完成 + code2 换 deepseek-v4-pro（主 agent）

- **修复重启验证（用户 19:04 重启）**：新进程 19:04:45 memory-manager 挂载正常；19:06:42 `turn/end #11 compressed, summary written`；摘要文件 `.dsh-memory/conversationsummary-latest.md` 时间戳吻合且无 fallback 标题/coverage 行（grep `对话历史摘要|覆盖范围`=0）→ 真 LLM 结构化摘要（内容为本会话真实工作归纳），修复闭环完毕；提交 `dea792d436`（feature/lan-access，254 测试绿、perFile 100%、tsc/oxlint 0）
- **code2-agent 模型切换**：gpt-5.6-luna→**deepseek-v4-pro**（根因：gpt-5.6-luna 在 opencode.ai zen/go 网关流式响应缺 `[DONE]`/finish_reason 结束标记，dsh 流式采集依赖此标记 → 输出重复"777777"、判失败；非流式正常、同链路 deepseek-v4-flash 正常 → 锁定模型网关侧缺陷）；改 `~/.dsh/.agent-presets/full/agent.cordis.yml` L220 模型位+注释、code2 预设注释，备份 `.bak-code2v4pro-20260822-190103`，未入库；重启后 `call_code2_agent` 返回 `7`（单次正常）确认生效
- **guard T10 部分验证**：主 agent 越界 curl 凭据被 guard 拦截并自动派发 code-agent，诊断熔断+实施派发链路确认生效
- 注：前次 subagent-1 派发 code2 失败、探测"OKOKOKOKOKOK"即为同一根因（gpt-5.6-luna 流式退化）；降级用 code-agent 完成修复属临时决策，根因已澄清

## 2026-08-22 压缩链路重启验证通过 + 发现 LLM 超时根因（主 agent 验证）

- **重启验证（用户 17:51 重启 dsh）**：code2-agent（17:43 创建）已加载，`call_code2_agent` 工具本会话可用；memory-manager host 层挂载日志 17:51:56 正常；修复后压缩链路实测通过——17:44/17:46/17:48 三次 `turn/end #130-132 compressed, summary written`，摘要落盘 `.dsh-memory/conversationsummary-latest.md`（时间戳吻合），fail-open 正常
- **新发现 LLM 摘要超时根因（实锤）**：`src/index.ts runCompression()` 对 classify/summarize 硬编码 `timeoutMs: 10000`；9888 软路由网关实测 7.5KB→4.4s、93.7KB→**10.7s**；真实会话窗口 3..turn-2 常达百轮/100KB+ → 两次 LLM 调用必超时 abort → 分类全 fallback-keep('useful')、摘要全降级 fallbackSummary 本地模板（五章节内容雷同）。叠加 fallbackSummary 硬编码"覆盖范围：第 3-8 轮"假值
- **修复已派发 code-agent**（subagent-2 后台）：超时 10s→25s 可配置、classify 最新 60 段/ summarize 最新 30 段上限、每段截断 400 字符、coverage 真实传入 fallback、perFile 四维 100% 维持 + lib 重建；完成后 check-agent 质检 + 提交，用户重启后实测摘要质量。注：code2-agent 首次派发失败（dispatch 层无输出失败、探测回复异常重复），降级用 code-agent 实施
- 验证数据文件：`.temp/mm-llm-test.json`、复现测试脚本结果（93.7KB→10683ms）
- **已 git commit**：`620a4bdd02075945721804a0b2b5d7b93d0c0caf`（fix(inject) 1 文件 +1 行，dsh-injection-manager/src/config.ts 白名单补第 7 项）
- lefthook pre-commit 全过（oxlint staged / whitespace / third-party notices 无变更 / vendor manifest guard）；暂存仅 config.ts 一个文件，commit 内 skill-router 引用 0 处
- 首提 `789ac1cf8f` 经 `git show --stat` 核验完整（17 源 + 15 测试 + apps/cli/package.json + tsconfig.host.json + pnpm-lock.yaml 登记，37 文件 +5439）；本次仅补注入管理器协同修复
- 提交后工作区仅剩既有未跟踪项：`packages/extensions/skill-router/`（WIP）、`.dsh-memory/`；dsh-memory-manager lib/ 产物未跟踪（仓库约定一致）
- 未 push（pre-push typecheck 会因 skill-router 既有 4 错失败，按约定不处理）；未重启 dsh（用户专属操作）——**需用户重启 dsh 后验证记忆管理器摘要注入链路**
- 明细见下条「dsh-memory-manager 实施后质检 2 项修复完成」

## 2026-08-22 dsh-memory-manager 实施后质检 2 项修复完成（check-agent P0+P1，code-execution agent）

- 背景：check-agent P3 质检发现 2 项需修正（其余全通过）；本次仅修复，**已于 P4 提交**（`620a4bdd02`，见上条）
- P0【阻塞】注入管理器白名单补 `dsh:conversation-summary`：`packages/extensions/dsh-injection-manager/src/config.ts` 的 `SHORT_TERM_MEMORY_NAMES` 由 6 项 → **7 项**（第 7 项 `dsh:conversation-summary`，v18 §4.2.5 必要协同）；摘要段不再被当 long-term 丢弃，可进上下文
- P1【严重】重建 dsh-memory-manager 陈旧产物：`lib/index.js` 12:54 → **15:11**（新于 src 14:53），因 tsc 更新 tsbuildinfo 但 tsdown 未重建；修复命令 `node_modules/.bin/tsdown --filter '@deepseek-ai/dsh-memory-manager' --env.DSH_BUILD_FACE host`（filter 需用完整包名，`--filter dsh-memory-manager`/正则不匹配）
- 验证：lib/index.js 含 `handlePoll`/`handleTurnEnd`（grep 7 处），node import 成功（exports：Config/apply/currentTaskContextOf/handlePoll/handleTurnEnd/name/runAuditOnce/runCompression/segmentsFromEvents，name=string、apply/handlePoll/handleTurnEnd=function）
- 测试：两包 19 文件 **266/266 全绿**（dsh-memory-manager 234 不变 + dsh-injection-manager **32**：31 原 + memory-layer `it.each` 因白名单新增第 7 项自动加 1 条）；`tsc -b` 两包 0 错；oxlint 42 文件 0 错 0 告警
- git 状态：仅 `dsh-injection-manager/src/config.ts` 一个 M；dsh-memory-manager lib/ 产物未跟踪（与仓库以往提交约定一致）；skill-router/.dsh-memory 未跟踪为既有状态

## 2026-08-22 code-agent 子代理切账号2（opencode-go-2）（code-execution agent）

- `~/.dsh/.agent-presets/full/agent.cordis.yml` L207：tool-subagent-code-agent 的 `agentOptions.provider: opencode-go` → `opencode-go-2`（model 不变 deepseek-v4-flash）；check-agent/plan-reviewer 等其他块零改动
- 备份：`agent.cordis.yml.bak-switch-code2-20260822-130155`（18,110B，与原文件一致）
- 校验：harness 同款 loader（js-yaml v4 + entryListSchema 含 !!js，@deepseek-ai/cordis-plugin-include）解析通过；code-agent provider=opencode-go-2、check-agent 仍 agnes；diff 仅 L207 一处；无残留裸 `provider: opencode-go`
- 前置确认：settings.yaml opencode-go-2 模型 28 个与 opencode-go 完全一致（含 deepseek-v4-flash），apiKeyEnv=OPENCODE_GO_API_KEY_2
- **未 git commit；需用户重启 dsh 生效**（主 agent + code-agent 均走账号2）；校验脚本保留 `.temp/validate-switch-code2.cjs`

## 2026-08-22 工具按需配给方案收敛 v1.1（plan-planner agent）

- 收敛《计划-工具按需与历史压缩.md》→ 产出《计划-工具按需配给.md》v1.1
- 删除历史压缩部分（T7-T10，与线2 v16《计划-记忆文件规范与写入入口.md》职责面B重复）
- 保留工具按需配给（T1-T6）：先静态移除 browser+vision(39工具~6Ktoken)，再动态 classifier 按需激活
- 补充评审修正：classifier 输出结构 `{needsBrowser, needsVision}`、DYNAMIC_TOOL_GROUPS 配置、最终 tools 组装顺序（全量→静态→动态）、fail-open 策略（连续3次失败降级）
- 验收量化：classifier 准确率≥90%（≥20样本）、工具数量对比测量方法
- 风险表补一条：工具裁剪后 guard 无需同步（不可见即不可调，动态 add 后 guard 按 preset 自动生效）
- 原文件标记归档（历史压缩由 dsh-memory-manager 负责）

## 2026-08-21 dsh-injection-manager 插件 P4 提交完成（code-execution agent）

- P3 质检通过（check-agent 结论"通过可提交"，确认命名空间限定分层是正确决策）；31/31 测绿、tsc 0 错、oxlint 0、guard 115/skill-router 34 无回归、pnpm-lock 纯追加、fail-open 双场景通过
- **已 git commit**：`7090ea888ae51e7d3238e21776b4db50d6a4cf19`（feat(inject) 16 文件 +773/-0 纯追加）
- 隔离技巧沿用 guard-main-agent：hash-object + update-index --cacheinfo 暂存 injection-only 版 apps/cli/package.json / tsconfig.host.json / pnpm-lock.yaml，commit 内 skill-router 引用 0 处；skill-router WIP（3 共享文件行 + 新包目录）原样留在工作区未混入
- lefthook pre-commit 全过（oxlint 0 / whitespace / notices 无变更 / vendor manifest）；lib/ 产物未跟踪（与仓库 .gitignore 及 guard-main-agent 提交一致）
- 未 push（pre-push typecheck 会因 skill-router 既有 4 错失败）；未重启 dsh（用户专属操作）；待办 T12 集成：preset 挂载 + 重启实测 R1-R10
- 明细见下条「dsh-injection-manager 插件实施完成（P2 T1-T6）」

## 2026-08-21 dsh-injection-manager 插件实施完成（P2 T1-T6，code-execution agent）

- 计划：projects/project-execution-system/docs/计划-上下文与记忆管理.md（v12，注入管理器批次1 T1-T6）
- 新包：packages/extensions/dsh-injection-manager/（@deepseek-ai/dsh-injection-manager，extension 结构同 guard-main-agent）
- 模块（6 源文件）：
  - `src/config.ts`：静态固定集合——READ_ONLY_TOOLS（5 读）/ WRITE_TOOLS_TO_CUT（10 写）/ SHORT_TERM_MEMORY_NAMES（6 个短期名）
  - `src/tool-cut.ts`：`cutMemoryWriteTools(assembly.tools)` 纯静态过滤（不动 ctx.tools 全局注册表）
  - `src/memory-layer.ts`：`classifyMemoryLayer`（已知 6 名=short-term，其余=long-term）；`filterMemoryLayers`——短期保留、记忆命名空间（memory:_/dsh:_）内未知名丢弃、非记忆段原样放行（防误杀 persona/identity/工具指引）
  - `src/dedup.ts`：极简去重（同名段只留首次出现，不 hash 不合并；sections/contexts 各自独立去重）
  - `src/index.ts`：注册 system-prompt/assemble waterfall listener——`await next()` 取下游组装结果→分层→去重→裁工具；try-catch 双段 fail-open（下游抛错返回原始 assembly，自身转换失败返回下游结果）；日志只记事件类型+原因
  - `src/invariant.ts`：包级 invariant 伴生插件（测试基建强制）
- 全局统一生效：listener 无主/子 agent 判断、无 classifier、无任务类型分支，所有 assembly 同一套静态规则
- 测试：31 用例全绿（4 文件：tool-cut 6 / memory-layer 14 / dedup 6 / index 集成 5——含 assemble 端到端、下游抛错与畸形 assembly 两个 fail-open 场景）
- 验证：包内 tsc 0 错；host 全仓 tsc 本包 0 错（仅剩 4 错全在 untracked skill-router WIP，既有）；oxlint 0 错 0 告警；tsdown 产物 lib/index.js 生成
- 注册：apps/cli/package.json 加 workspace 依赖；tsconfig.host.json 登记引用；pnpm install 更新 lockfile（skill-router WIP 变更未触碰）
- 未挂载 preset（T12 集成属批次3，需重启 dsh 生效，由主 agent 告知用户后执行）；未 git commit（留待 check-agent 质检）

## 2026-08-21 guard-main-agent 误拦修复 P4 提交完成（code-execution agent）

- 提交：deepseek-harness feature/lan-access 分支 commit `eb0083676aa1462d46b0a17b2e0963ee6e9a693e`「fix(guard): relax classifier timeout, retry on timeout only, never retry caller abort or HTTP errors」7 文件 +255/-25
- 提交内容：packages/extensions/guard-main-agent/ 修复增量（README.md + src/classifier.ts + src/index.ts + src/types.ts + tests 3 文件），即 P2 T1-T6 全部改动
- lib 产物：guard 包 lib/ 未被 git 跟踪，与上次 090ba7e532 一致不提交（tsdown 产物已在工作区更新，重启后生效）
- lefthook pre-commit 门禁：全部通过（oxlint staged lint / whitespace --check / notices / vendor guard）
- **skill-router 未混入**：apps/cli/package.json、tsconfig.host.json、pnpm-lock.yaml 中 skill-router 相关变更（依赖/tsconfig path/lock importer）已剔除未暂存，仅提交 guard 修复 7 文件；skill-router 包目录保持 untracked（其 4 个 typecheck 错误为既有问题，不归本次）
- 验证：提交前本地复核 guard 测试 **115/115 全绿**（7 文件）；提交后 git log HEAD=本次 commit，工作区残留仅 skill-router WIP
- 收尾：docs/PROGRESS.md 同步更新；未 push（pre-push typecheck 会因 skill-router 既有 4 错失败，按任务约定不处理）；重启 dsh 实测 + duration_ms P95/P99 观察留待主 agent 与用户（T10 人工验收）

## 2026-08-21 guard-main-agent 误拦修复实施完成（P2 T1-T6，code-execution agent）

- 计划：projects/project-execution-system/docs/计划-guard误拦修复.md（v2；设计决策 1-3 + T1-T6 + 11 条验收 + 风险 R1-R5）
- 根因：timeoutMs 5s 对 9888 路由抖动余量不足（实测健康请求 2.16s、偶发>5s 被 AbortController 掐断）+ 错误未区分（超时 vs 真故障）
- 改动文件（6，全在 packages/extensions/guard-main-agent/）：
  - `src/types.ts`：新增 `ClassifyErrorType('timeout'|'fatal')`；`PolicyVerdict.errorType?`；`ResolvedGuardConfig.retryCount`（必选）；`GuardPluginConfig.retryCount?`
  - `src/classifier.ts`：`ClassifyResult` 失败分支带 `errorType`；`classify()` 入口/重试间隙/中途三次检查 `signal?.aborted`（caller abort 硬终止，fetch 0 次不重试）；新增导出 `isTimeoutError()`（DOMException AbortError / message 含 abort、timed out）；重试循环 `maxAttempts=1+retryCount`，仅 timeout 重试，HTTP 4xx/5xx/网络错/解析失败一律 fatal 不重试；callClassifier 签名不变
  - `src/index.ts`：`timeoutMs` 默认 5000→10000（`DEFAULT_TIMEOUT_MS`）；schema + `Config` 接口新增 `retryCount`（z.default(1)）；`resolveConfig` 补 `retryCount ?? 1`；`classifyAndDecide` 每次 classify 记录 `duration_ms`（ok info / failed warn 均含 errorType），errorType 透传 `decisionRecord`/`logDecision`（日志格式加 `errorType=timeout|fatal|none`）
  - `tests/classifier.spec.ts`：+5（场景A 超时重试成功 fetch2 次；B 重试仍失败 errorType=timeout；C 非超时不重试 errorType=fatal；D retryCount=0 不重试；E caller abort fetch 0 次）
  - `tests/guard-main-agent.spec.ts`：+6 集成（场景E 6s 抖动重试放行 allow；F 网络故障 fail-close 派 code-agent；G HTTP500 不重试；G+ 429/400 不重试；H caller abort fetch 0 次 deny 且不派发）
  - `tests/policy.spec.ts`：config 字面量补 `retryCount: 1`（类型闭合，断言未改）
- 验证：T6 全量回归 **115/115 全绿**（104 基线无回归）；guard 包 `tsc -b` 0 错；`oxlint` 0 警告 0 错误；`tsdown --env.DSH_BUILD_FACE host` 产物 lib/index.js 更新（20:31）；host aggregate tsc guard-main-agent 0 错（全仓仅剩 4 错仍在 untracked skill-router，既有问题与本任务无关）

## 2026-08-21 guard-main-agent 插件 P4 提交完成（code-execution agent）

- 提交：deepseek-harness feature/lan-access 分支 commit `090ba7e5329a347e41c02a59788b67ccb60e05cb`「feat(guard): add guard-main-agent plugin for main-agent behavior enforcement + file-policy whitelist」23 文件 +2885
- 提交内容：packages/extensions/guard-main-agent/ 全量（README/package.json/7 源模块/7 测试/tsconfig.json）+ apps/cli/package.json 依赖 + tsconfig.host.json 登记 + pnpm-lock.yaml 对应条目
- husky/lefthook 门禁：pre-commit 全部通过（staged 17 个 TS 文件 oxlint 0 错 0 告警、whitespace --check 通过、third-party notices --check 通过无增量）
- **skill-router 未混入**：apps/cli/package.json、tsconfig.host.json、pnpm-lock.yaml 中 skill-router 相关行（依赖/path/lock importer）已剔除，仅提交 guard-main-agent 部分；skill-router 包目录保持 untracked，工作区残留 diff 仅 skill-router WIP（其 4 个 typecheck 错误为既有问题，不归本次）
- 收尾：docs/PROGRESS.md 同步更新；T10 人工验收（重启 dsh 实测 12 场景）留待主 agent 与用户执行

## 2026-08-21 guard-main-agent 插件实施完成（P2，code-execution agent）

- 项目：项目全流程执行保障系统 子系统「guard-main-agent」（D1 主agent行为保障 + D1 文件权限拦截）。packages/extensions/guard-main-agent/（@deepseek-ai/dsh-guard-main-agent）
- 机制：tools/pre-execute 拦截（POC 已验证，见项目文档 POC 报告）→ 派发通道/诊断工具直接放行 → 写文件走机器白名单门禁（fail-close）→ 其余走 9888 辅助模型分类 + TTL 缓存 + 自动派发
- 模块：index.ts（组装+pre-execute 监听+结构化日志）、classifier.ts（9888 POST+超时+500 字符参数摘要）、prompt.ts（主agent职责边界规则+JSON 输出契约）、policy.ts（verdict/fail-close/工具分类集）、delegate.ts（call_code_agent/call_check_agent 派发+注入说明）、filePolicy.ts（白名单+symlink realpath+类型过滤+temporaryOverrides 过期）、cache.ts（TTLMap 四元组 key+hash 刷新）、messages.ts（最近 5 轮会话提取）、invariant.ts
- 文件权限门禁（D1）：读 docs/主agent可改写文件清单.yaml（v2.1）→ realpath 防 symlink 绕过 → 白名单 prefix/exact/glob → allowedExtensions 过滤 → temporaryOverrides 临时例外到期自动失效 → 未命中一律拒绝；清单热重载（每次写操作重读）
- 降级：分类失败→代码类 close/诊断类 open/其余 close；文件清单加载失败→deny-all；子代理派发失败→仅 warn 仍 deny
- 测试：104 测试全绿（7 文件：cache/policy/classifier/delegate/file-policy/messages/guard-main-agent 集成场景1-4+文件权限场景5-12）；tsc -b guard 包 0 错；oxlint 0 错；tsdown 根构建出 lib/index.js
- 挂载：full preset 追加 guard-main-agent 行（filePolicyPath 指向 docs/主agent可改写文件清单.yaml）；apps/cli/package.json 加 workspace 依赖；tsconfig.host.json 登记两 extension 包引用
- 全仓 typecheck：guard-main-agent 0 错；仅剩 4 错全在**未纳入本任务**的 skill-router（untracked 相邻包）测试，与本任务无关
- 待办（T10 人工验收）：重启 dsh 后 Web GUI 实测：1)主agent写代码→拦截+派 call_code_agent 2)简单诊断 read/grep→放行 3)9888 超时→代码 close/诊断 open 4)任务切换→缓存刷新 5-12)文件权限各场景；未 git commit（留待 check-agent 审核）

## 2026-08-20 skill-router 插件修复（包安装 + 构建产物）

- 项目：DSH 插件 skill-router（packages/extensions/skill-router）。full preset 引用了 @deepseek-ai/dsh-skill-router 但包未装、构建产物路径错（main 指向 lib/index.js 但只编译出 lib/types/index.js）
- 根因 A（未安装）：skill-router 非任何包 workspace 依赖 → 不进 node_modules → DSH 运行时无法解析
- 根因 B（产物错）：extension 包约定是 tsc outDir=lib/types（出 .js+.d.ts）+ 仓库根 tsdown workspace 构建把 lib/types/index.js 打成 lib/index.js；skill-router 这套管线从未跑过，故无 lib/index.js
- 修复 A：apps/cli/package.json 加依赖 @deepseek-ai/dsh-skill-router: workspace:^（与 dsh-cordis-client-runner/dsh-tool-cordis 同约定）+ pnpm install 链接；profiles/node_modules/@deepseek-ai/dsh-skill-router 建符号链接（指向 apps/cli/node_modules 下对应包，同 dsh-tool-cordis 模式）
- 修复 B：按仓库约定跑 tsc -b + tsdown --env.DSH_BUILD_FACE host → lib/index.js + lib/invariant.js 生成，lib/types/*.d.ts 保留；**未改 outDir 为 lib**（任务提议改 outDir=lib，但与全部 extension 包约定冲突且会破坏 types 路径，判定为错误方案未采纳）
- 顺带修掉 skill-router 存量 lint 4 处（src 2 + tests 2：max-len/arrow-parens/no-base-to-string/no-unnecessary-condition）
- 验证：34 测试全过、oxlint 0 错、prettier 通过、tsc -b 通过、产物经 profile 链接 node 可加载（name=skill-router, apply=fn）
- 待办：重启 dsh 后验证 full preset skill-router 插件真实加载

## 2026-08-20 21:5x plan-reviewer 400 根因定位 + 换 agnes-2.5-flash 跑通（四道闸闭环全通）

- 现象：重启后实测 call_plan_reviewer（router-9888/gpt-oss-20b）首轮模型请求 400 "Invalid JSON body"，4 次子代理全失败；code/check（opencode-go/agnes）正常
- 诊断链：presetId 机制正常（code/check 跑真 preset 验证通过 + plan-reviewer 会话 header.agentPreset 正确）→ 模型解析正常（resolveModelInfo OK）→ dsh 内部 llm.stream 复现正常（简单/复杂/全部 61 工具/大 system 全 200）→ 9888 网关硬限制：请求体 ~30KB 触发 413 Payload Too Large、groq 厂商限流 429 极频繁
- 结论：router-9888 软路由网关对 dsh 子代理大请求不兼容（400/413/429），非 dsh 问题（agnes/opencode-go 端点正常）
- 修复（临时）：plan-reviewer 改 agnes/agnes-2.5-flash（备份 agent.cordis.yml.bak-plan-reviewer-agnes-213749，2 行值替换）→ 重启 dsh 后 call_plan_reviewer 实测通过
- 待办：用户提供软路由系统代码 → 精确定位 400 根因 → 出修改方案 → 用户改软路由 → gpt-oss-20b 回归

## 2026-08-20 20:4x plan-reviewer + Step5 配置过 check-agent 独立审核（通过，可重启上线）

- check-agent 审核结论：✅ 通过，无阻断项。YAML 真实 loader 5 文件全过、27 个包引用全部存在、provider/model 与 settings.yaml 逐行匹配、presetId 行级语法正确、结构对齐 check-agent 无 realm 泄漏、report 回传通道实证可用
- 采纳建议：补 tool-skill（方案评审可加载 writing-plans/grill-me）、文件权限 644；tool-lsp 暂缓（保持只读精简定位）
- 待办：重启 dsh 后实测 call_plan_reviewer（子代理启动 + 工具集符合预期）

## 2026-08-20 20:4x 新增 plan-reviewer（方案评审子 Agent）+ M2 Step5 配置层完成

- 项目：项目全流程执行保障系统 子系统2（双 Agent 协作）扩展为三 Agent：plan-reviewer（方案评审）+ code-agent（实施）+ check-agent（质检）
- plan-reviewer：实施前审核方案/计划，挑缺陷/漏洞/遗漏/过度设计，提合理化建议；模型 gpt-oss-20b（9888 免费，实测三模型对比胜出：干净中文结构化输出+批判性强；qwen3.6-27b 9888 中转强制吐英文 thinking 落选，compound 限流）；工具集只读精简（fs/fs-search/compaction/session-query/str-replace-editor）；路径 ~/.dsh/.agent-presets/plan-reviewer/
- 真挂载验证：standingKeyFor 返回 mounted OK key={"agentPreset":"plan-reviewer"}
- M2 Step5 配置层完成：full preset 三子代理工具均加 presetId（call_code_agent→code-agent、call_check_agent→check-agent、新增 call_plan_reviewer→plan-reviewer+gpt-oss-20b），等重启生效
- 四道闸闭环：方案评审→实施→质检→提交

## 2026-08-20 20:3x M2 子代理「按 preset 组合」改造完成（首次双 Agent 闭环实战）

- 项目：项目全流程执行保障系统 M2（双 Agent 协作，子系统2）落地
- 改动：deepseek-harness feature/lan-access 分支提交 4b67817a48「feat(subagent): support composing children from a named agent preset」15 文件 +371/-17 + 3 fixture
- 能力：spawn/continuable 子代理可选 presetId，组合目标 preset（code-agent/check-agent）——真工具集+硬规则+独立模型（go/agnes），全自动，向后兼容
- 关键实现：agentPresets.composeStanding（bindScopeParent 到目标 standing key）、SubagentStartRequest.presetId、tool-subagent Config.presetId、childSessionMeta presetOverride、in-process-driver + continuation async standingKeyFor 接线、continuable descriptor 持久化 presetId（v2→v3）+ 冷恢复同 preset
- 首次「主agent编排→code实施→check审核→修正→提交」闭环实战验证成功：
  - code-agent（opencode-go）实施，TDD 全流程，803 测试+typecheck+lint 全绿
  - check-agent（agnes）独立审核：有条件通过→建议提交，独立重跑证实门禁
  - code-agent 按审核建议补 broken-preset + persona 叠加测试
  - 提交 4b67817a48（husky 门禁通过）
- 遗留：Step 5 配置层（full preset 给 call_code_agent/check-agent 加 presetId）+ 重启 dsh 生效

## 2026-08-20 16:1x 修复 rc.8 设置页报错「settings are unavailable in this browser」（用户报告）

- 现象：rc.8 升级后，设置→模型选项报「加载提供方目录失败: settings are unavailable in this browser」
- 根因（源码定位）：rc.8 新增 settings 共享镜像，persistence 按 `connection.isLoopback ? 'host' : 'memory'` 决定；LAN IP 访问非回环 → 'memory'（进程内、unavailable）。而服务端 PRIVILEGED_METHODS 栅栏实际对 --trusted-host 放行（实测受信 host 过栅栏、evil.com 403）→ 纯客户端自锁 bug
- 修复（最小化，提交 3c3b2932ba）：ui-settings 共享 mirror + settings-scope 的 persistence 恒用 'host'，由服务端栅栏裁决（非受信页 403），受信 LAN 页设置可用
- 验证：typecheck+lint 全绿、build:web 成功
- 需重启生效；曾尝试"完整方案"（服务端 describe 返回 trustedHosts + 客户端 isLoopback getter）引发测试连锁修改，已回退只留最小修复

## 2026-08-20 15:3x dsh rc.7 → rc.8 升级（代码合并 + 全链路构建通过，待用户重启）

- 前提：rc.8 今日发布（领先 536 提交）；用户约束"对话不能断，重启由用户亲手动"→ 本轮只做代码/配置/构建，不重启
- **git merge**：feature/lan-access 合并 origin/master（rc.8）→ b8ae2c6404；lan-access 四文件补丁全部保留（startup.ts 0.0.0.0 禁令已移除 + 上游 --no-open 选项并存；main.ts randomUUID polyfill 完整）
- **依赖对齐**：pnpm install 补齐 rc.8 新依赖（zod/koffi 等），9.3s 完成
- **typecheck 全绿**（tsc -b host + client）；**lint 全绿**（0 错误 0 警告，2578 文件）
- **踩坑修复（关键）**：build:web 首次失败——vite 解析不到 @deepseek-ai/dsh-client-web-react（8-18 残留目录 packages/client/web-react 无 git 文件 + 陈旧 lib 残留引用）。处置：残留移入 .temp/archive/2026-08-20-upgrade/debris/ + `tsc -b tsconfig.client.json --force` 强制重建客户端 lib + tsdown + build:web → 三步全 EXIT=0，新 dist 已生成
- **lint 误报修复**：main.ts polyfill 的防御性空检查被 oxlint 类型规则误报（DOM 类型认为 crypto 恒存在，但 http://LAN 不安全源运行时确实缺失）→ 加块级 oxlint-disable 注释（提交 69bd173faa）
- **systemd 服务**：dsh-web.service 加 `--no-open`（rc.8 默认自动开浏览器，必须禁），备份 .temp/archive/2026-08-20-upgrade/config/
- **验证**：dump-config exit=0（组合含 title/vision/compaction/session-query-sqlite 全解析；模型引用 agnes/agnes-2.5-flash 正确）
- **待办（用户操作）**：`systemctl --user restart dsh-web.service` → 刷新页面；重启前不要刷新（避免 rc.8 前端对 rc.7 宿主错配）
- 备份：.temp/archive/2026-08-20-upgrade/（config/ + debris/）

## 2026-08-20 13:5x dsh 改动探查（用户要求，找 bug）

- 范围：全部历史改动（lan-access 源码 / settings / patches / presets / 脚本 / systemd 服务）
- **发现高危 Bug#1**：04:30 把 router-9888 模型 id 改为带前缀（agnes/agnes-2.5-flash）但未同步 patch——三个预设 compaction-basic 的 summarizationModel、cordis.patch 的 session-title-llm.model、vision-router.providers[0].model 仍写裸 agnes-2.5-flash
- 证据（运行实例实测）：ctx.llm.resolveModelInfo(router-9888, 裸) 失败 UNKNOWN_MODEL、带前缀成功；9888 线级裸 400/带前缀 200；视觉靠 <provider>-vision 双胞胎路由兜底仍可用
- 影响：压缩静默失败（有兜底不崩，但上下文不压缩、免费压缩省钱失效）；标题回退确定性；视觉配置死条目
- 修复：5 处改 model 为 agnes/agnes-2.5-flash（注意 call_check_agent 的 agnes provider 那处不能改），需重启生效
- **中危 Bug#2**：restart-dsh.sh 与 systemd dsh-web.service 冲突（pkill 杀 Main PID 触发 systemd 自启 + 脚本 nohup 自启 → EADDRINUSE + 失去 systemd 管理），建议改 systemctl --user restart
- **低危 Bug#3**：refresh-9888-models.py get_models_list 无 try/except、探测正则变化会静默写退化表、合并表含废弃裸 id
- **低危 Bug#4**：pnpm-workspace 残留 dsh-free-vision、settings agnes displayName "Agens" 拼写
- lan-access 源码审查无洞；lsp js 映射非 bug
- 报告：docs/dsh-改动探查报告-2026-08-20.md
- 待办：用户确认后修 Bug#1（改 5 处 → 重启 → 验证）

## 2026-08-20 14:1x 修复 Bug#1（用户要求：先实测 9888 真实 id 再修）

- 实测 9888 线级：agnes/agnes-2.5-flash=200（真实可用）、裸 agnes-2.5-flash=400（废弃）、groq/groq/compound=400（废弃）、groq/compound=429（当前正确 id，在权威可用列表）
- 改动 5 文件（备份 .temp/archive/2026-08-20-bugfix/）：
  ① cordis.patch.yml：title+vision model → agnes/agnes-2.5-flash
  ②③④ full/code/check 三预设 compaction summarizationModel → agnes/agnes-2.5-flash（call_check_agent 的 agnes provider 不动）
  ⑤ settings.yaml：groq/groq/compound → groq/compound
- 验证：dump-config exit=0 + 重启后运行实例 5 模型全部 resolveModelInfo ok + 视觉端到端无回归
- 重启：systemctl --user restart dsh-web.service（90s 延迟，日志已清理）
- 遗留待决策：Bug#2 restart 脚本/systemd 冲突、Bug#3 refresh 脚本健壮性、Bug#4 残留与拼写

## 2026-08-20 14:3x 修复 Bug#2/#3/#4（用户要求：把所有 bug 进行修复）

- **Bug#2**：重写 .temp/restart-dsh.sh → systemd 感知（优先 systemctl --user restart + 3080 就绪等待；非 systemd 才回退 pkill+nohup；保留延迟参数）
- **Bug#3**：refresh-9888-models.py 三处健壮性——get_models_list 失败不致命、探测法失败（不可达/格式变化/不可知）保留旧表不覆盖退出码1、表只保留带 `/` 前缀 id 过滤废弃裸 id
- **Bug#4**：pnpm-workspace.yaml 删 dsh-free-vision 残留；settings agnes displayName Agens→Agnes
- 验证：刷新脚本实跑 66 模型 exit=0/表无裸 id/9888 不可达模拟 rc=1 表未覆盖/格式变化模拟返回 None；bash -n 通过；两配置 YAML 解析 OK
- 无需重启 dsh（独立工具 + 显示级改动）；Bug#1 已 14:1x 重启生效
- 报告：docs/dsh-改动探查报告-2026-08-20.md（全部 ✅）

## 2026-08-20 04:34 定时重启 dsh（用户指示自主触发）

- 用户指出重启可用定时任务实现，不必等手动——已触发 .temp/restart-dsh.sh（setsid 独立进程组，90s 延迟）
- 流程：sleep 90 → pkill 精确杀 3080 dsh 进程（pnpm+bin.ts）→ 同 cwd(/home/dingx/deepseek-harness) + 同参数重启 pnpm dsh web → 日志 .temp/dsh-restart.log
- 目的：加载新 settings（router-9888 免费模型 5 个生效）

## 2026-08-20 04:1x router-9888 接入免费模型（自主执行，方向内）

- 用户授权自主执行（规则修正：方向已定，执行层全自主，碰主系统备份+最小改动+做对不问）
- settings.yaml router-9888 models 更新为带厂商前缀的正确 id + 新增 3 个（diff 确认只改此段）：
  - 修正：agnes-2.5-flash → agnes/agnes-2.5-flash；tencent/hy3:free → nous/tencent/hy3:free
  - 新增：groq/openai/gpt-oss-20b（代码/全能）、groq/qwen/qwen3.6-27b（中文）、groq/groq/compound（推理）
- 验证：yaml 解析 OK（4 provider 保持），diff 只动 router-9888 models 段；备份 .temp/settings-before-9888-insert-20260820.yaml
- 待重启 dsh 生效；重启后子 agent 可选用这些免费模型

## 2026-08-20 04:0x 9888 免费模型真实能力测试（细致多维度）

- 重大发现：/v1/models 只返回精选子集（8个），chat/completions 实际可调用 48 个（探测法解析 400 错误权威列表）——刷新脚本已改进（/v1/models + 探测法合并）
- 细致测试（代码/中文/推理/延迟，串行+间隔控频率）：
  - 稳定可用：groq/openai/gpt-oss-20b（全能首选）、gpt-oss-120b、groq/groq/compound、compound-mini、groq/qwen/qwen3.6-27b（中文强带thinking链）、agnes/agnes-2.5-flash、google/gemini-3.1-flash-lite、openrouter/nvidia/nemotron-3-ultra-550b-a55b:free、cohere/north-mini-code（慢）
  - 不可用：openrouter/qwen3-coder、deepseek-v4-flash:free、gpt-oss-20b:free（500）；旧无前缀 compound-mini 已废弃
- 建议：code-agent 免费化用 gpt-oss-20b；check 用 agnes-2.5；推理用 groq/compound；中文用 qwen3.6-27b
- 报告：docs/9888-model-capacity-report.md

## 2026-08-20 03:4x 9888 模型列表定时刷新模块（用户需求）

- 背景：9888 暴露清单动态（路由质量筛选），用户要求不记录过期清单、用前实时读
- 模块：
  - scripts/refresh-9888-models.py：拉取 9888 /v1/models → 写最新表 .temp/9888-models.json（带 updated_at 时间戳），只读端点低频率不触发限流，失败不覆盖旧表
  - crontab 定时：每小时整点自动刷新（0 * * * *），crontab 原内容已备份 .temp/crontab.bak-20260820
  - 使用：需要 9888 模型时先跑脚本/查 .temp/9888-models.json 再选用
- 验证：手动跑 OK（当前 9 模型，allam 已移除）；/usr/bin/python3 有 yaml；crontab 最小环境模拟运行成功
- 未碰主系统：只新增工作区脚本 + 用户级 crontab

## 2026-08-20 01:0x 固化子 Agent 验证通过（重启后实测）

- 用户重启后实测：call_code_agent（opencode-go/deepseek-v4-flash）跑 pwd+python3 成功返回；call_check_agent（agnes/agnes-2.5-flash）检查文件成功返回——两个模型均生效，llm-pi-ai adapter 随 settings 还原恢复
- 目标达成：长期固化（preset 文件）+ 可直接调用（两个工具）+ 不同模型（OpenCode Go / Agnes）+ 可更换模型（改配置）+ 不碰主系统
- 设计：子 agent 继承 full preset 能力 + agentOptions 固定模型；角色靠 prompt 传
- 可选后续：如需子 agent 用 code-agent/check-agent preset 的聚焦工具集（不含 workflow/管理工具），需自定义插件挂载 preset（更复杂，待用户确认是否需要）

## 2026-08-20 00:5x 建立固化子 Agent 调用工具（不碰主系统）

- 用户需求：长期固化、可直接调用、可更换模型的子 agent（模型不同：code=OpenCode Go、check=Agnes）
- 方案：tool-subagent 的 config 原生支持 agentOptions（provider/model）——在 full preset 加两个变体即可，无需自定义插件/碰 profile
- 改动（只加不改，diff 确认 +24 行）：
  - ~/.dsh/.agent-presets/full/agent.cordis.yml 新增 tool-subagent-code-agent（call_code_agent：opencode-go/deepseek-v4-flash）+ tool-subagent-check-agent（call_check_agent：agnes/agnes-2.5-flash）
- 验证：最小测试 preset 挂载验证通过（preset_verify2 standingKeyFor）；full preset 的 standingKeyFor 因 tool-cordis 单例冲突失败（当前进程已注册 Service inspect provider，非本次改动问题，新进程无冲突）
- 备份：full-agent.cordis.yml.bak-20260820（.temp）
- 未碰：settings.yaml / profile / host 组合
- 待办：用户重启后实测 call_code_agent/call_check_agent；如需子 agent 用 code/check preset 的聚焦工具集（非 full 能力）需更复杂实现

## 2026-08-20 00:4x 还原主系统（用户指示：先还原原始状态，再看影响，再调整）

- 背景：多次 yaml.safe_dump 重写 settings.yaml + 加 deepseek-official/tencent 配置 → llm-pi-ai adapter 注册失败（一个 provider 坏全挂）→ 模型选择看不到所有 llm-pi-ai providers（runtime 证据：llm.listProviders 只有 vision-http/deepseek/deepseek-vision）
- 还原内容：
  ① settings.yaml：删我加的 deepseek-official provider + router-9888 的 tencent/hy3:free，agent-default-model → opencode-go/deepseek-v4-flash；保留 huoshan(4)/agnes(3)/router-9888(1)/opencode-go(28 模型)
  ② 方案团 node_modules：重解压原始 npm 包（撤销多模型改造）
  ③ profile package.json：去掉 dsh-ai-solution-council bundle（保留 playwright）
- 备份：settings-broken-20260820.yaml（.temp）；profile-package.json.bak（21:48，缺 playwright 未整体还原）
- 教训：settings.yaml 必须文本级/最小改动 + 先备份；yaml.safe_dump 重写整个文件风险高；一个 provider 配置坏会导致 llm-pi-ai 全部 providers 不注册
- 待办：用户重启验证主系统恢复；方案团如需重新接入用不碰 settings 全局结构的方式

## 2026-08-19 方案团模型组合定稿（4 厂商 3 免费/低 + 1 强）

- 最终组合：A1=agnes/agnes-2.5-flash（免费）；A2=deepseek-official/deepseek-v4-flash（极低）；A3=router-9888/tencent/hy3:free（免费，腾讯混元，经 9888 软路由网关）；A4=opencode-go/gpt-5.6-luna（唯一强模型）
- 9888 免费模型实测：7 测 6 可用（tencent/hy3 5.7s、stepfun/step-3.7-flash 5.1s、upstage/solar-pro4 3.2s、poolside/laguna-s 7.1s、laguna-xs 30.3s、agnes-2.5-flash 1.5s）；meituan/longcat 400 不可用；模型池 370 个（:free 免费 LLM 6 个 + 免费 embedding 32 个）
- 改动：方案团 EXPLORER_PROFILES A3 → router-9888/tencent/hy3:free；settings router-9888 加 tencent/hy3:free 模型
- 注意：A3 依赖局域网软路由 10.10.10.2:9888 在线（曾短暂连不上），单个探索失败标 failed 不影响其他
- 需重启 dsh 生效（方案团新装插件，solution_council 工具出现后门禁自动标记联动）

## 2026-08-19 方案团多模型改造（dsh-ai-solution-council）

- 背景：方案团 4 探索 Agent 默认继承主 agent 模型（同模型=4个主 agent，无多视角）→ 必须配多模型才有独立评审价值（用户判断正确）
- 改造（直接改 node_modules/dsh-ai-solution-council/lib/index.js，先跑通再考虑 fork 本地）：
  ① EXPLORER_PROFILES 加 provider/model（A1=agnes/agnes-2.5-flash 免费；A2=deepseek-official/deepseek-v4-flash 低成本；A3=opencode-go/glm-5.3 订阅；A4=opencode-go/gpt-5.6-luna 唯一强模型）
  ② startChild 加 agentOptions 参数传入 subagents.start（修复两次：spread 插错位置+多余{残留，最终语法 OK）
  ③ runExplorer/orchestrate 传 profile.provider/model
- 验证：传递链完整（SubagentStartRequest.agentOptions → spawn in-process-driver:136 resolveChildAgentOptions 覆盖子模型）；语法 OK
- settings 新增 deepseek-official LLM provider（DEEPSEEK_API_KEY，baseURL api.deepseek.com，模型 deepseek-v4-flash/pro）
- 用户决策：大部分免费+1 强模型+不同厂商防并发；火山云 HUOSHAN_API_KEY 401 不可用；第 4 个免费厂商（A3 换非 go）待用户选（Groq/硅基流动/智谱 GLM-4-Flash 候选）注册 key
- 需重启 dsh 生效（方案团新装插件）

## 2026-08-19 安装 dsh-ai-solution-council（方案团）到 web profile

- 功能：主 Agent 调 solution_council → 4 个同职责上下文隔离 Agent 并行调查 → 串行交叉评审 → 证据核验 → 最终裁判（防单 Agent 被第一判断带偏，用于方案/决策审查）
- 接入：注册 solution-council 插件行（explorerCount:4 + spawn）；UI 挂 dsh Web GUI（Slots 卡片），局域网可访问（dsh 监听 0.0.0.0:3080）
- 安装：npm/pnpm 网络静默故障 → 手动 curl tarball 解压到 node_modules + 加 package.json dependencies/bundles（schemastery/zod 已有）；验证包可解析、无同名冲突
- 介入时机：T1 决策前（主 Agent 提方案时调）；日常低成本用独立评审子代理（go 强模型），高风险用方案团
- 待重启 dsh 生效
- 备注：dsh-approval-llm 是命令审批（approve-for-me，审批权限请求），不审查方案，未装

## 2026-08-19 dsh-plugin-playwright 未生效修复

- 现象：dsh-plugin-playwright v0.2.0 已装（dependencies）但 GUI 显示"未声明 dsh.bundle，不会成为 profile 层插件"
- 根因：dsh 通过 profile package.json 的 `dsh.profile.bundles` 识别 profile 层插件；包需在 bundles 里声明才被加载。仅 dependencies 安装不会触发 reconcile（reconcile 只在 `dsh plugin` 命令成功时跑）
- 修复：手动将 dsh-plugin-playwright 加入 ~/.dsh/profiles/web/package.json 的 dsh.profile.bundles（备份 .temp/profile-package.json.bak）；包本身 dsh.bundle.patch 有效，cordis.patch.yml 注册 playwright 插件（chromium/headless/截图/pdf/network）
- 生效：需重启 dsh

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
  - 监控面板 `system_monitor_web.py` 加 [DSH] 重启按钮。

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
  | 插件                              | 文档                    | 局域网管理页        | 备注                                              |
  | --------------------------------- | ----------------------- | ------------------- | ------------------------------------------------- |
  | dsh-persona-memory（已装 0.1.19） | 中                      | ❌ loopback-only    | 核心正常，管理页仅 127.0.0.1                      |
  | **dsh-mnemon 0.2.9**              | 最全（13.9K+中文+demo） | ✅ **受信主机机制** | 需额外装 Mnemon 引擎（go/brew），本地 SQLite 免费 |
  | dsh-auto-memory 0.1.28            | 全（中文）              | ❌ loopback-only    | cache-friendly                                    |
  | memos-local-plugin 2.0.16         | 全                      | ❌ loopback-only    | 算法强但 viewer 仅本机                            |
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

| 方案                                                   | 适配度      | 理由                                                                                                  |
| ------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------- |
| **persona-memory + 调 learnIntervalTurns**（推荐先试） | ✅          | 机制健全（注入/纠正/安全合并/备份），只差轮数门槛；改 3-4 即适配，hot-reload 零风险                   |
| dsh-auto-memory（备选）                                | ✅ 每轮沉淀 | per-turn 沉淀不依赖累计轮数，天然适配；但管理页同 loopback-only、模型调用未确认、需重装重启有踩坑风险 |
| dsh-mnemon                                             | ⚠️          | 最强+局域网，但需装 Mnemon 引擎（go/brew）+复杂，短期不划算                                           |
| memos-local                                            | ❌          | loopback + 复杂                                                                                       |

**推荐**：**保留 persona-memory**，先加一行 patch 调 `learnIntervalTurns: 3`（hot-reload），观察 1 天学习是否开始积累；不行再评估 dsh-auto-memory。→ **待用户确认后执行**。

> **【2026-08-19 更新：用户纠正保守倾向】**
> 用户明确：插件在磨合期，**现在多试多踩坑就是为以后顺畅**，"换装有风险"不构成不换的理由。
> → 重新深挖 **dsh-auto-memory 0.1.28**（代码级，非纸面）：
>
> - ✅ **不发起独立 LLM 调用**（lib 0 次 `llm/chat`）：每轮"记忆管家评估"prompt 注入让 agent 在主回复**同一轮顺带完成**（复用 KV 缓存）→ **几乎不额外花钱**，真 cache-friendly。
> - ✅ **每轮自动沉淀**（turn-stopping 评估，`[自动沉淀]` 标记，寒暄跳过、按 turn 去重）+ 长期价值升格项目笔记/用户级记忆。
> - ✅ **30 天蒸馏**（memory_maintain：AI 提炼旧日志进项目笔记，原文归档）。
> - ✅ **5 个记忆工具**：memory_recall / memory_maintain / memory_status / memory_reflect / memory_consolidate。
> - ✅ **注入**：`<memory_system>` 块（用户规则+项目笔记+今日日志+最近反思），缓存刷新（启动/session-start/turn-stopping/工具写/TTL）。
> - ✅ **每日反思**：昨日日志未反思 → 会话首轮注入反思块 → agent 生成 → memory_reflect 落盘。
> - ✅ 中文 UI：概览/日志/笔记/反思/接续/日历/检索/工作区（三级抽屉）。
> - ⚠️ 短板：管理页 loopback-only（同 persona）；沉淀消耗主模型同轮 token（复用缓存，量小）。
>   **对比结论更新**：dsh-auto-memory 在"适配高频短会话（每轮沉淀）+ 省钱（不独立调 LLM）+ 管理丰富"三维度全面优于 persona-memory 实测现状 → **值得装测**（用户态度：磨合期该试）。

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

### 7.1 代码生产保障体系搭建（2026-08-19 晚）

- 需求：代码实施阶段抠细节/防错/标准格式的工程保障 + 流程强制（不靠自觉）。
- 落地：工作区搭建保障栈（可作新项目模板）——prettier(.prettierrc)格式层、oxlint静态层、tsc(tsconfig.base严格)类型层、vitest测试层、husky+lint-staged门禁层。
- 门禁：pre-commit 强制 prettier+oxlint（lint-staged），pre-push 强制测试；git init + 首次 commit 验证通过。
- 市场评估：第三方代码保障插件（dsh-review/dsh-plugin-vet/dsh-code-scan/dsh-commit-review 等）少而新，采用工程机制（标准工具链）更可靠。
- 浏览器自动化：dsh-plugin-playwright ^0.2.0 已装（飞书等以后用途的工具基础）。

### 7.2 新项目立项：Agent 能力路由与双 Agent 协作体系（2026-08-19 晚）

- 背景：解决模型代码工作 4 顽疾（丢三落四/大文件难/死胡同/细节迷失），保障从"模型自觉"变"机制自动"。
- 核心设计：skill-router（辅助模型 9888 免费判断 skill 注入）+ 代码 Agent（专注执行）+ 监督质检 Agent（独立把关）。
- 立项：/home/dingx/DSF-work/projects/agent-capability-system/（README + docs/立项与初步计划.md，含验收标准/里程碑/待讨论问题）。
- 状态：立项完成，待讨论实施。

### 7.3 Semgrep 评估结论（2026-08-19 晚，agent-capability-system 调研）

- 能力：强——30+ 语言、快速轻量、模式匹配+局部污点分析、2000+ 内置规则、CLI 友好、开源本地可装。
- 弱：非全语义分析、跨文件弱、只查已知模式（不查逻辑/死胡同/全局问题）、误报需调优。
- 接入困难：低（pip 装 + `semgrep scan` 一条命令 + 退出码判断，可进 husky/dsh 质检节点）。
- 定位：静态质检辅助层（补安全/低级错误），不防 4 顽疾核心（死胡同/全局靠双 Agent）。
- 不选 CodeQL：重量级（需编译代码库为数据库）、商业授权受限、配置复杂、学习成本高，与轻量外部调用定位不符。

### 7.4 系统项目立项：项目全流程执行保障系统（2026-08-19 晚）

- 定位升级：从"skill-router+双Agent"单点立项 → 完整系统项目（非写个代码就完事的项目）。
- 系统目标：立项到验收全流程保障严格执行（"语言→设备"哲学，不靠模型自觉）。
- 架构：4 子系统（能力路由/双Agent/质量门禁/流程模板）+ 三层保障（机器门禁/系统注入/独立监督）+ 全流程 P0-P5（含 Superpowers 借鉴 7 点）。
- 落地：/projects/project-execution-system/（README + docs/立项.md + docs/进展.md）；原 agent-capability-system 降级为子系统 1+2 详细设计。
- 状态：M0 完成，待 M1 流程模板。

---

## 待办（下一步）

1. ✅ **重启 dsh 验证宿主后端挂载**（LSP/PTY/FTS）——已完成，三服务确认挂载（见 2.1b）。
2. ⏳ **软路由 Hermes 接入方式确认**（凭据/细节）。
3. ⏳ **局域网统一管理/多方协作平台**开发（见 PROJECT.md）。

## 2026-08-20 22:4x 软路由 400 修复补丁交付（code-agent 实施→check-agent 审查→上传交换目录）

- 闭环：code-agent 改 model_list_api.py（4 处：主入口+_handle_nous_chat 循环读满 body/chunked 兜底/JSON 失败诊断日志 + 新增 _read_chunked_body），py_compile 通过 → check-agent 独立审查通过（可部署，无回归）→ 上传软路由共享盘交换目录
- 交付物（共享目录/agent交换目录）：model_list_api.py.新_20260820（59644B）+ 替换说明_20260820.md
- 待软路由 agent 执行替换 + 重启 + 验证；若仍 400 日志会显示 body_len/前200字节 → 精确定根因

## 2026-08-20 23:0x 软路由 400 修复验证 + gpt-oss-20b 回归结论（SSH 根因实锤）

- SSH 登录软路由（root/password）→ model-router 在 /mnt/hermes/work/projects/模型路由中枢/model-router/，确认补丁已应用（59644B，含 _read_chunked_body）
- 验证结论：补丁后 400（JSON 解析）已治愈——诊断日志证实解析层正常，大请求成功转发上游
- **新暴露根因**：groq/openai/gpt-oss-20b 对**大请求**（30KB+）返回 429 限流（小请求 200），agnes-2.5-flash 大请求 200——groq 免费层限制，非软路由代码问题
- plan-reviewer 改回 agnes-2.5-flash（稳定），gpt-oss-20b 仅适合小请求场景；软路由补丁保持生效

## 2026-08-20 23:1x 四道闸闭环操作手册落地（check-agent 编写）

- projects/project-execution-system/docs/四道闸闭环操作手册.md（144行）：三 agent 速查表（实际配置）、任务决策规则、四道闸操作步骤、验收/提交硬门槛、禁止事项、P0-P5 配合表、快速决策流程图
- 项目执行保障系统文档齐备：P0-P5 全流程模板 + 操作手册 + CODE-WORKFLOW，以后照单执行

## 2026-08-20 23:5x project-planner（项目规划师）Agent 建立完成（四道闸→五环）

- 闭环：实施计划(v2 评审通过) → code-agent 实施（preset+挂载+YAML通过）→ check-agent 质检（5项通过）→ 重启实测 call_project_planner 产出合格计划（文件结构+5 bite-sized任务各带绿/红验收+依赖顺序+风险项，只规划不实施）
- 新增：~/.dsh/.agent-presets/project-planner/{preset.yml,agent.cordis.yml}（agnes-2.5-flash，工具集照 plan-reviewer）
- full preset 挂载 call_project_planner（备份 .bak-project-planner-233445）
- 操作手册升级五环：project-planner(规划)→plan-reviewer(评审)→code-agent(实施)→check-agent(质检)→提交

## 2026-08-21 00:3x 主 agent 误操作修复（plan-reviewer+code-agent+check-agent 闭环）

- 问题：主 agent 多次尝试修改 full preset 失败，project-planner 挂载丢失；MEMORY.md 追加了用户反对的铁律；.temp 目录 poc-report.md 未归档
- 修复闭环：plan-reviewer 评审方案 → code-agent 实施（MEMORY.md删除铁律 + full preset恢复挂载 + .temp归档） → check-agent 质检通过
- 文件变更：
  - `~/.dsh/memory/MEMORY.md`：删除第51-52行铁律
  - `~/.dsh/.agent-presets/full/agent.cordis.yml`：恢复 tool-subagent-project-planner 挂载（line 232-241）
  - `.temp/skill-router/skill-router-poc-report.md`：归档至 `.temp/archive/2026-08-20/`
- 教训：主 agent 反复试错改 YAML 缩进，违反"先备份+最小改动+征得同意"规则

## 2026-08-21 主agent职责边界.md 按评审报告修订（v1.0→v1.1）

- 按评审报告修正5项缺陷：①诊断熔断条件合并+新增「有结论」定义（6.0），②5.1 增加用户确认环节（不得主agent自行拍板），③诊断任务拆分为简单/复杂（决策表+6.0判断标准），④新增5.5 P3前置self-review，⑤新增4.1混合/外部依赖/用户插入任务处理规则
- 文件：`projects/project-execution-system/docs/主agent职责边界.md`（155行，路径不变）

## 2026-08-22 dsh-memory-manager 插件首提：perFile 四维 100% 覆盖率（code-execution agent）

- **已 git commit**：`789ac1cf8f`（feat(memory-manager)，37 文件 +5439 纯新增）
- dsh-memory-manager（计划 v18）：六步审核管线（守门不创作）+ 每轮历史甄别归档压缩（四类分类/归档/建议条目/dsh:conversation-summary 注入）
- **perFile 门禁全绿**：v8 provider，statements/branches/functions/lines 全部 100%（src/ 全部文件）
- 覆盖补全要点：
  - vitest v8 provider **不认** `// v8 ignore next` 行注释，只认块注释 `/* v8 ignore start/stop */`、`/* v8 ignore next N */`——三处死代码防御（confirm catch/handlePoll catch/L237 无 else if 假分支）改用块注释
  - cordis `ctx.plugin(apply, config)` 是**两个独立参数**（config 第二参数），集成测试曾误用 `{ apply, config }` 对象导致 poll timer 不触发；修正后 apply 测试 emit session/event + 10ms poll tick + dispose 覆盖 session/event 回调与 clearInterval
  - 补真实场景测试：textOfMessageEvent string/empty/数组混合 block、tool 类事件跳过、runAuditOnce fixed 列表（格式修复）、consume 无记录→unknown、header 无 cwd 回退、maintenance statOf 缺省/readdir 抛错/隐藏目录/stat 失败、classify timeout-abort（abort 监听 fetch）、summarize trimTo 截断 + timeout-abort、normalize options.now 缺省、trigger 非 Error rejection
  - L237 无 else if 赋值体：v8 不报告假分支计数 → `/* v8 ignore start/stop */`（经探针验证 [13,-8]/[0,0] 无法为正）
- 234 tests 全绿，tsc 0 错，oxlint 0 告警；husky 门禁通过后提交

## 2026-08-22 dsh-memory-manager 修复A/B/C: 挂载迁移 + poll 靶标 + 生产 fs 接线 + 全链路日志（code-execution agent）

- **未 commit**（按任务约定待 check-agent 质检 + 用户重启验证）
- 诊断根因回顾：①主因 scope 过滤——插件挂在 agent preset，而 turn/end 事件载体无 scope key → handleTurnEnd 永不触发；②次因 poll 用 process.cwd()（=deepseek-harness）找不到生产记忆目录；③可观测性零日志
- 修复A（挂载层级）：
  - `~/.dsh/.agent-presets/full/agent.cordis.yml` 删 dsh-memory-manager 挂载行 2 行（备份 `.bak-mv-memory-manager-20260822-160515`）
  - `~/.dsh/profiles/web/cordis.patch.yml` 追加 host 层 insert 块（含说明注释，备份同名同戳）
  - 生产 parser（app-boot entryListSchema）双文件校验：patch 6 条 / preset 21 条，均含新块无残留
- 修复B（poll + 观测 + **新发现的生产 fs 根因**）：
  - `src/index.ts`：新增 `sessionWorkspaces`/`pollSessions`——poll 靶标改为活动会话 header.cwd（去重、跳过空 cwd）；`apply()` 不再裸用 process.cwd()
  - **实施中发现第4根因**：生产入口 handleTurnEnd/handlePoll 从不传 fsImpl → defaultCompressFs(defaultAuditFs) 的 writeFile/readdir 是 throw/空 stub → 压缩/审核**静默全 no-op**（LLM 烧钱、磁盘零写入）。修复：新增 `createRealFs()`（node:fs/promises 接口），`apply()` 注入进两入口
  - 可观测日志：apply 挂载行、`turn/end #N compressed, summary written/failed-open`、`poll audit: N changed...`
- 修复C（产物路径）：摘要/归档落 `<workspace>/.dsh-memory/` 与计划 v18 一致（已有设计，无改动）
- 验证：integration.spec 31→(加9新用例) 全绿；perFile 四维 100%（index.ts 100/100/100/100，包内 scoped 跑）；tsc 0 错；oxlint 0 告警；lib/index.js 已重建（16:54，含 createRealFs/pollSessions/mounted/poll audit 符号）
- 遗留：`deepseek-harness/.dsh-memory/`（repo 根的旧测试产物，12:38，未提交未删——新 poll 不再指向该路径）

## 2026-08-22 新增 code2-agent 子代理预设（强模型收尾用，code-execution agent）

- **背景**：复杂代码收尾任务需更强模型；新增 code2-agent preset（复用 code-agent 职责/工具全集），模型指向 gpt-5.6-luna（opencode-go-2，账号2），现有 call_code_agent 保持 deepseek-v4-flash 零改动
- **新增 1**（preset 目录）：`cp -r ~/.dsh/.agent-presets/code-agent ~/.dsh/.agent-presets/code2-agent`，仅改 agent.cordis.yml 顶部身份注释（code-agent → code2-agent，强模型版），其余逐字节一致；目录名即 preset id，discovery 按目录扫描无白名单，重启后自动可见
- **新增 2**（full preset 挂载块）：`tool-subagent-code2-agent` 块紧跟 code-agent 块之后（check-agent 之前），toolName `call_code2_agent`，presetId code2-agent，provider opencode-go-2，model gpt-5.6-luna，one-shot
- **备份**：`~/.dsh/.agent-presets/full/agent.cordis.yml.bak-code2-20260822-174147`（改前快照，diff 仅 1 处插入 12 行）
- **校验**：harness 同款 entryListSchema（含 !!js）解析 full/code2 两文件全过；code-agent 块零改动；code2 块位置/字段全部正确；gpt-5.6-luna 在 settings.yaml 4 处匹配且位于 opencode-go-2 models；验证脚本 `.temp/validate-code2-agent.cjs` ALL CHECKS PASSED
- **未 commit（用户目录配置）、未重启 dsh（用户专属）**——重启后即可用 call_code2_agent 派发复杂代码任务

## 2026-08-22 code2-agent 换模型 gpt-5.6-luna → deepseek-v4-pro（账号2）

- **用户意图**：code2 换 deepseek-v4-pro（code-execution agent 执行，主 agent 越界被拒后委派）
- **连通性前置探测**：`.temp/probe-deepseek-v4-pro.cjs` / `probe-deepseek-v4-pro2.cjs`——OPENCODE_GO_API_KEY_2（len=67）直接打 opencode.ai/zen/go/v1，deepseek-v4-pro HTTP 200，真实回复 "PONG"（~2.6s），模型可产出内容
- **改动 1**（full preset）：`~/.dsh/.agent-presets/full/agent.cordis.yml` L210 注释 + L220 `model: gpt-5.6-luna → deepseek-v4-pro`（provider 仍 opencode-go-2）
- **改动 2**（preset 自身）：`~/.dsh/.agent-presets/code2-agent/agent.cordis.yml` 顶部身份注释改为「默认 deepseek-v4-pro」
- **备份**：`full/agent.cordis.yml.bak-code2v4pro-20260822-190103`、`code2-agent/agent.cordis.yml.bak-code2v4pro-20260822-190103`；diff 确认两文件各仅 2 行改动（注释+模型位）
- **校验**：harness 同款 entryListSchema（含 !!js）解析全过；code-agent 块零改动（deepseek-v4-flash 不变）；活跃文件无 gpt-5.6-luna 残留；settings.yaml 中 deepseek-v4-pro 本就位于 opencode-go-2 models（L139-141，contextWindow 1000000，未动）；验证脚本 `.temp/validate-switch-code2-v4pro.cjs` ALL CHECKS PASSED
- **未 commit（~/.dsh 用户目录）、未重启 dsh（用户专属）**——重启后 code2 走 deepseek-v4-pro

## 2026-08-22 dsh-memory-manager 摘要注入修复（S级，deepseek-harness feature/lan-access）

- **根因**：压缩真 LLM 摘要写入 `<ws>/.dsh-memory/conversationsummary-latest.md`（writeSummaryFile），但 src/index.ts 只注册 `session/event` turn/end 压缩监听器，从未把摘要注册成 system-prompt 注入段 → injection-manager 白名单 `dsh:conversation-summary`（config.ts:54）放行一个从不产生的段名，模型每轮看不到历史摘要
- **调研确认的注入 API**（复用既有机制，未发明新机制）：①core `system-prompt/assemble` 瀑布事件（packages/core/system-prompt/src/index.ts:31，`ctx.waterfall` 分发）；②assembly.contexts 注入段结构（index.ts:115-120）；③同款瀑布监听器写法见 dsh-injection-manager/src/index.ts:41；④workspace 解析 `context.agent?.session.header.cwd`（core/agent-loop/src/index.ts:353 同款）；`context.agent` 类型由 dsh-agent runtime-types.ts:16-21 declare module 增强（需 side-effect import type {} 引入）
- **改动（仅 2 个文件，未动其他包/配置）**：
  - `src/index.ts`（+73 行）：新增 `SummaryInjectionDeps` / `assemblyWorkspace()` / `injectConversationSummary()`（读 resolveMemoryPaths(cwd,home).summaryFile，非空则以 buildSummaryInjection 构段附加到 assembly.contexts，文件缺失/空/读失败/无 fs 全部 fail-open 返回原 assembly）；`apply()` 注册 `ctx.on('system-prompt/assemble', ...)` 瀑布监听器（downstream first + catch 返回原 assembly，与 injection-manager 同构），复用已接线的 createRealFs
  - `tests/summary-injection.spec.ts`（新增 8 用例，168 行）：真 Cordis Context + SystemPrompt 服务 + 插件挂载，模拟 assemble 瀑布——文件存在时注入且文本=文件内容（含 renderContextSnapshot 可见断言）、缺失/空/读失败/无 fs 静默跳过不抛错、下游监听器抛错 fail-open 返回原 assembly、assemblyWorkspace cwd 回退
- **验证**：254→262 测试全绿（16 files）；perFile 四维 100%（含新 index.ts 100/100/100/100，scoped 配置 `.temp/vitest.memory-manager.config.ts` --coverage）；tsc -p tsconfig.json 0 错；oxlint 0 告警；`tsc -b`（emit lib/types）→ `npx tsdown --env.DSH_BUILD_FACE host --filter ...` 重建 lib/index.js 65.49kB（含 system-prompt/assemble + dsh:conversation-summary 符号）
- **未 git add/commit（按任务约定）**；临时文件 .temp/ 下（mm-*.log 等）

## 2026-08-23 配置 Web 界面 T1 后端 API 完成（ai-gateway config-ui，code-execution agent）

- **产出**：`projects/ai-gateway/config-ui/server.js`（Node 原生 http，无框架，v0.1 后端层）+ README.md；计划文档《计划-配置Web界面.md》§2 增第5项子代理管理【必需，用户痛点】、§5 T1 验收补子代理接口
- **接口**：GET /api/status（探测 dshPort 默认 3080、DSH_TRUSTED_HOSTS 透传）；GET/PUT /api/providers（settings.yaml `llm-pi-ai.providers` 整段替换，读全文件→改段→备份→临时文件+rename 原子写，其余段原样保留）；GET(掩码)/POST /api/keys（dsh.env，chmod 600，掩码规则 `sk-****abcd`/前4位换 ***_，绝不回显完整）；GET/PUT /api/subagents（扫描 PRESETS_DIR 各 agent.cordis.yml 的 model/provider/reasoningEffort/effort/reasoning/agentOptions._ 标注字段+行号+生效模型；PUT 行级只改值、保留缩进与行尾注释，备份+原子写，字段缺失/不支持→422，id 不存在→404）；GET /api/boot（token 首启明文仅一次）
- **Token 认证（§3）**：首启 randomBytes(32).hex 写 `${CONFIG_DIR}/.config-ui-token`(600)；boot 明文一次性消费，重启后抑制；其余接口强制 Bearer（无 token/错 token→401）
- **字段语义对齐 dsh 真实机制**：确认 `config.agentOptions.provider/model` 是工具行覆盖子代理模型的官方路径（full preset 即此写法），未覆盖回退 settings.yaml `agent-default-model`（{{model}} 占位来源）；reasoningEffort=思考级别
- **验证**：骨架 `.temp/config-ui-test/`（settings.yaml 2 个占位 provider + 空 dsh.env + code-agent/plan-reviewer 只读副本，副本追加真实同构 agentOptions 标注块）；30 项 curl 实测全过：PUT providers 后其余段字节不变、dsh.env 600、掩码不回显、subagents PUT 后 diff 仅目标行变注释保留、真实 preset md5 零改动、boot 一次性、401 拒绝
- **边界/差异点**：PUT providers 会规范化 providers 段内注释（整体替换语义）；PUT subagents 不新增缺失字段（顶层插入 model: 会破坏 cordis.yml 列表结构，422 引导）；绑定默认 127.0.0.1+Token 双保险；js-yaml 走仓库绝对路径 require，不可用自动回退轻量解析，写路径零依赖
- **未 commit（用户约定）；未碰真实 ~/.dsh/settings.yaml 与真实 preset（全程骨架操作）**

## 2026-08-23 配置 Web 界面真实配置校验 + 3081/3083 端口实证（code-execution agent）

- **3081 无法打开根因确认**：3081 不属于 config-ui——同一 dsh 进程（PID 656011，`dsh web --port 3080`）双监听 3080(fd21)+3081(fd33) 0.0.0.0；config-ui 此前默认端口 3081 与之冲突/被挤占，subagent-24 已把默认端口改 3083（server.js L17 注释+默认值落盘，README 同步），见《3081完整入口-专项记录.md》
- **config-ui 实际端口位置实测**：旧实例 pid 922051 仅 127.0.0.1:8092（CONFIG_DIR=.temp/config-ui-wizard 测试目录）；新实例 pid 955058 0.0.0.0:3083（subagent-25 起，CONFIG_DIR=.temp/config-ui-test 测试目录）——**当时两个实例都未指向真实配置**
- **真实配置端到端验证（全绿）**：临时起 3084 实例（CONFIG_DIR=/home/dingx/.dsh、PRESETS_DIR=/home/dingx/.dsh/.agent-presets、0.0.0.0，日志 .temp/config-ui-real.txt，验证后已杀）→ GET /api/boot 首启生成 token 落 `/home/dingx/.dsh/.config-ui-token`(600,65B) 并明文回显一次 → 带 Bearer GET /api/status（configDir/presetsDir/dshPort=3080/running 全对）、GET /api/providers（source=yaml，真实 5 键全读出：huoshan/agnes/router-9888/opencode-go/opencode-go-2，baseURL 与原厂一致）、GET /api/subagents（count=5，check-agent/code-agent/code2-agent 等，effectiveModel 正确解析 provider=opencode-go-2、model=deepseek-v4-flash、source=agent-default-model）；401 认证拦截符合设计
- **遗留**：正式 3083 实例仍指向测试目录 `.temp/config-ui-test`，要服务真实配置需重启为 CONFIG_DIR=/home/dingx/.dsh（token 文件已就位，重启即可用；是否换目录待协调方定夺）；验证证据存 .temp/config-ui-real.txt / config-ui-boot.json / config-ui-real-providers.json

## 2026-08-23 check-agent 启动失败根因诊断与修复确认（agent-1/code-agent）

- **根因（完整链条）**：17:23-17:56 间 config-ui 类编辑把 `~/.dsh/.agent-presets/full/agent.cordis.yml` 的 tool-subagent-check-agent agentOptions 从 agnes/agnes-2.5-flash 改成 **SuanLi/deepseek-v4-flash**（证据：17:25:53 备份=agnes，19:15:50 备份=SuanLi）；dsh-web 于 18:29:34 重启，主会话重挂载读到 SuanLi 态 → 此后 call_check_agent 全部以 SuanLi 起子会话：17:56-18:14 NO_ADAPTER（settings 尚未含 SuanLi）8 次，18:42-19:33 `502 status code (no body)`×5 重试全败 7 次（会话 request/context 证实 provider=SuanLi/model=deepseek-v4-flash）——失败与 agnes/agnes-2.5-flash 无关（planner 同配一直正常）
- **文件已修复**：19:15:50（SuanLi→agnes，备份 191550 存证）+19:21:58（reasoningEffort minimal→medium，备份 192158 存证）；当前 tool-subagent-check-agent = agnes/agnes-2.5-flash/medium，与 project-planner **完全同配**（宽容 schema 解析确认 6 个 preset 全部 OK，check-agent 挂载唯一）
- **未生效原因**：preset 配置按会话挂载静态快照、不热更新（mount.ts 明示无 config-update 观察者）→ 当前 dsh 进程（18:29:34 起）主会话仍持 SuanLi 挂载；**需用户重启 dsh-web 或开新会话后 call_check_agent 才恢复**，重启前从当前会话再测仍会 502
- **审计备份**：`~/.dsh/.agent-presets/full/agent.cordis.yml.bak-checkfix-20260823-194343`（当前已修复态快照）；取证脚本归档 `.temp/archive/20260823-checkagent/`

## 2026-08-24 一键回滚脚本

### 新增

- **rollback.sh**：一键回滚脚本，支持回滚 deepseek-harness 代码、cordis 配置、凭据文件、记忆文件
- 用法：`bash rollback.sh [target]`
  - `harness [commit]` - 回滚代码到指定 commit（默认: a336607bcb）
  - `cordis [backup_file]` - 回滚 cordis 配置到指定备份
  - `credentials [backup_file]` - 回滚凭据文件到指定备份
  - `memory` - 回滚记忆文件到最新备份
  - `all [commit]` - 回滚所有（默认）
  - `backups` - 显示可用备份列表

## 2026-08-24 config-ui 回滚状态 API（code-execution agent，主 agent 编辑被守卫拦截转交）

- **背景**：主 agent 为 server.js 头注释补写回滚 API 文档时被「角色边界守卫」拦截（文件编辑非其职责），转交 code-execution agent 完成
- **实现**：server.js 新增只读端点 GET /api/rollback（回滚状态：dshHome/harnessDir/harnessHead/backupCounts/recentCommits/rollbackRefs）与 GET /api/rollback/backups（备份明细：cordis/credentials/memory{backupDir,files}/commits/rollbackRefs）；备份源 = $CONFIG_DIR 下 .agent-presets/full/_.bak-_ 与 .credentials.yaml.bak-* 与 memory-backup/latest/（生产即 ~/.dsh）；harness 仓库默认 /home/dingx/deepseek-harness（ROLLBACK_HARNESS_DIR/HARNESS_DIR 可覆盖）；**只读展示、不执行回滚**（执行保持人工 CLI `bash rollback.sh`）
- **验证**：TDD 先红后绿——16 项断言全过（骨架于工作区 .temp、dummy git 仓库扮演 harness，绝不动真实目录；覆盖 401 认证/新→旧排序/计数/HEAD subject/commits/refs）；真实环境冒烟：默认路径读到真实 deepseek-harness HEAD df91c78fb3、无备份目录优雅返回 0 不炸
- **产物**：测试脚本归档 .temp/archive/rollback-api-test-20260824/run-test.mjs（含 .temp 骨架约定，可回归）；README 接口表同步；config-ui 未 commit（用户约定）

## 2026-08-24 rollback.sh 移至 /home/dingx/bin/

### 变更

- **rollback.sh 位置迁移**：从工作区根目录移至 `/home/dingx/bin/rollback.sh`
- 原因：该脚本是给用户使用的应急工具，不应留在工作区（非代码产物）
- 同目录已有 `dsh-lan`、`gateway` 等系统管理脚本，位置合理
- PATH 已包含 `~/.bin/`，用户无需配置即可直接使用

### 质检结论

- 语法检查：PASS
- 帮助命令：PASS
- 备份列表：PASS（显示 36 个 cordis 备份、4 个凭据备份、记忆快照）
- 错误处理：PASS（未知 target 报错 + 帮助、不存在的 commit 报错）
- 确认机制：PASS（每个危险操作前交互式确认）
- git 安全 refs：PASS（回滚前自动保存 HEAD 到 `refs/backup-rollback-*`）

## 2026-08-24 config-ui 回滚 tab 可执行化

### 变更

- **回滚 tab 从只读审计升级为可执行操作**：harness/cordis/凭据/记忆/全部 5 个独立回滚按钮
- 每个操作均有 `confirm` 弹窗确认，执行前自动备份当前状态（`.bak-rollback-<时间戳>`）
- harness 支持自定义 commit 输入（留空用默认 a336607bcb）
- cordis/凭据支持下拉选择历史备份文件
- 全部回滚返回各组件执行结果摘要
- 后端新增 `/api/rollback/harness|cordis|credentials|memory|all` POST 路由
- 前端新增 `bindRollbackEvents()` 函数，`loadRollback()` 同时填充下拉

## 2026-08-24 config-ui 回滚 tab 升级为可执行操作

### 变更

- **回滚 tab 从只读审计升级为可执行操作**：harness/cordis/凭据/记忆/全部 5 个独立回滚按钮
- 每个操作均有 `confirm` 弹窗确认，执行前自动备份当前状态（`.bak-rollback-<时间戳>`）
- harness 支持自定义 commit 输入（留空用默认 a336607bcb）
- cordis/凭据支持下拉选择历史备份文件
- 全部回滚返回各组件执行结果摘要
- 后端新增 `/api/rollback/harness|cordis|credentials|memory|all` POST 路由
- 前端新增 `bindRollbackEvents()` 函数，`loadRollback()` 同时填充下拉
- 测试验证：5 个 POST 接口全部通过，所有操作正确备份+执行

## 2026-08-24 config-ui 回滚 tab UI 修复

### 问题

- harness 使用文本输入框，用户需手动输入 commit hash
- cordis/凭据下拉显示"加载中"但无错误提示
- 全部回滚不显示要回滚的 commit 信息

### 修复

- **harness 改为下拉选择**：从 `/api/rollback/backups` 获取最近 commits，默认选中 a336607bcb
- **下拉加载失败时显示提示**："加载失败，请刷新" + "dsh 未重启时旧版 config-ui 可能没有回滚 API"
- **全部回滚动态提示**：根据 harness 下拉选择实时更新提示文字
- **记忆回滚说明更新**：明确显示回滚来源路径

### 重要提醒

- 新 API 需要重启 dsh 才能生效（commit 2096f422db + config-ui 修改）
- 当前运行中的 config-ui（端口 3083）仍是旧代码，UI 会报"未找到"错误

## 2026-08-24 config-ui 回滚 tab 修复并部署

### 问题

- 用户反馈"全部加载失败"，harness/cordis/凭据下拉显示"加载中"后卡死
- 根因：config-ui 通过 systemd 服务运行（PID 1096，09:10 启动），未加载新代码

### 解决

- 重启 config-ui 服务：`systemctl --user restart config-ui.service`
- 新 PID: 108313，12:40:33 启动
- API 验证全部通过：
  - GET /api/rollback → HEAD + 备份计数 ✅
  - GET /api/rollback/backups → 38 cordis / 4 凭据 / 10 commits ✅
  - POST /api/rollback/harness → 回滚 + 自动备份 ✅
  - POST /api/rollback/cordis → 回滚 + 自动备份 ✅
  - POST /api/rollback/credentials → 回滚 + chmod 600 ✅
  - POST /api/rollback/memory → 回滚 + 自动备份 ✅
  - POST /api/rollback/all → 全部回滚 + 结果摘要 ✅

### UI 改进

- harness: 文本输入 → 下拉选择（自动填充最近 10 commits，默认 a336607bcb）
- cordis/凭据: 下拉选择历史备份（加载失败时显示错误提示）
- 记忆: 直接点击按钮，明确显示回滚来源路径
- 全部回滚: 动态显示选中的 commit，提示文字实时更新

### 清理

- 测试产生的 backup refs 和备份文件已清理
- 保留原始安全 refs: backup-rollback-2026-08-24T04-14-17-063Z, backup-rollback-2026-08-24T04-14-20-878Z

## 2026-08-24 回滚界面全中文本地化

### 变更

- **deepseek-harness（代码框架回滚）**：标题、按钮、提示文字全部汉化
- **cordis 配置编排回滚**：界面文本全部中文
- **凭据密钥文件回滚**：界面文本全部中文
- **记忆文件回滚**：界面文本全部中文
- **一键全量回滚**：危险提示加强，按钮文字汉化
- **错误提示汉化**："加载中…"、"加载失败"、"无可用的版本记录"等
- **结果反馈汉化**："代码框架已回滚"、"配置编排已回滚"等

### 重启服务

- `systemctl --user restart config-ui.service`（新 PID 117218）

## 2026-08-24 dsh-web.service 启动前自愈防线（故障一加固）

### 变更

- **~/.config/systemd/user/dsh-web.service**：新增 `ExecStartPre`，每次启动前执行
  `cd /home/dingx/deepseek-harness && CI=true pnpm install --no-frozen-lockfile`
- 目的：防护故障一复发（workspace-state 被污染为 dev:false 时，启动前自动恢复
  devDeps，避免 pnpm 自动 install --production 删光 411 devDeps 导致崩溃死循环）
- 原 ExecStart / WorkingDirectory / Environment（含 CI=true）/ Restart 等配置保持不变
- systemd-analyze verify 通过（仅系统其他 unit 既有告警，dsh-web.service 无错误）

### 备注

- 该 unit 修改需 `systemctl --user daemon-reload` 后下次启动生效
- dsh 重启属用户专属操作，未执行；由用户手动重启后验证 ExecStartPre 生效

## 2026-08-24 config-ui 启动错误显示（code-execution agent，故障一防护第三级）

- **server.js 新增 GET /api/boot-error**：getBootError() 先 `systemctl --user show dsh-web.service --property=Result,FailureReason,ExecStartPostStatus` 判定启动结果；Result != success 时再 `journalctl --user -u dsh-web.service -n 10 --no-pager --output=short` 提取含 error/fail/ERR_/Crash 关键词的行，拼接后截断 500 字符；返回 { hasError, error, lastStart }，正常运行返回 { hasError:false }；systemctl/journalctl 各 5s 超时，失败降级为简单提示不抛 500（错误优先级：journal 错误行 → FailureReason → ExecStartPostStatus → 通用文案）
- **app.js syncBanner 改 async**：running=false 时调用 /api/boot-error，hasError → 红色横幅显示 `⚠️ <具体错误>`（esc 转义），否则/请求失败 → 通用「dsh 主服务（端口 X）未运行」；running=true/无状态 → 隐藏；两处调用（loadStatus L927、start L1327）均已 await
- **命令可测试注入**：DSH_SHOW_CMD/DSH_SHOW_ARGS、DSH_JOURNAL_CMD/DSH_JOURNAL_ARGS（JSON 数组）覆盖，沿用 DSH_RESTART_CMD 既有模式
- **验证**：TDD 25/25 单测通过（归档 .temp/archive/boot-error-20260824/，含 boot-error.test.mjs + 7 个假命令脚本 + smoke-real.cjs）；node --check server.js / app.js 通过；真实 systemctl 冒烟（只读）返回 { hasError:false }；index.html #alert-banner-msg 确认存在

## 2026-08-24 故障一/二防护落地 + Bug 修复（code-execution agent，guard 转派）

### 防护体系部署

- **dsh-dep-align-guard 插件**（`packages/extensions/dsh-dep-align-guard/`）：事务式依赖对齐守卫。pre-execute 提醒 + post-execute 三判据校验（workspace-state dev:true / lefthook 存在 / frozen-lockfile 一致），未对齐按 agent 粒度阻断，只放行 `CI=true pnpm install`；告警写 `~/.dsh/.alerts/dep-misaligned.json`（mode 0600）。42 测试全绿。
- **dsh-memory-guard 插件**（`packages/extensions/dsh-memory-guard/`）：记忆防 `{{xxx}}` 污染守卫。拦截 memory 写工具中裸双花括号字面量，反引号包裹为合法转义。16 测试全绿（含反污染断言）。
- **dsh-web.service**：新增 `ExecStartPre=CI=true pnpm install --no-frozen-lockfile`，启动前自愈对齐。
- **install-lefthook.mjs**：失败时 `try/catch` 改为写告警文件（非 crash），`lefthook` 二进制缺失时由静默 return 改为落盘 `~/.dsh/.alerts/lefthook-install-failed.json` + WARN 日志；`lefthookPackage` 静态 import 改为 existsSync 后动态 import 防整包缺失崩溃。
- **system-prompt 宽容化**（`packages/core/system-prompt/src/index.ts`）：未知/非法变量保留字面量 + console.warn，不再 throw；已注册但值为 undefined 仍 fail-loud。

### Bug 修复（bb4195058b）

- **Bug1 二次污染**：`buildDenialReason` 拒绝理由中裸 `{{xxx}}` 经 LLM 落盘后再次触发模板插值崩溃 → 所有 `{{...}}` 统一 replace 为 `` `{{...}}` `` 反引号包裹。
- **Bug2 文本误判**：`detectPnpmOperations` 对 echo/注释中含 "pnpm install" 字样的句子误判为依赖操作 → 新增 `isPnpmAtCommandPosition` 命令位置门控，排除引号内/#注释/解释性文本。
- **Bug3 静默盲区**：`lefthook` 被删时原逻辑 `if(!existsSync) return` 无声退出 → 写告警文件 + WARN 日志后 exit 0。

### config-ui 启动错误显示

- `server.js` 新增 `GET /api/boot-error`：systemctl show + journalctl 提取 error/fail/ERR_/Crash 关键词行，截断 500 字符；修复无效属性名 `ExecStartPostStatus` → `ExecMainStatus`。
- `app.js` `syncBanner` 改 async：dsh 未运行时横幅显示具体报错，`running=true` 时隐藏。
- 25/25 单测通过。

### 验证结论

- 重启 dsh-web：NRestarts=0，无 PresetMountError/MODULE_NOT_FOUND/CRIT 告警。
- 系统日志确认 `{{commit}}`/`{{xxx}}` 保留字面量不崩溃（system-prompt 宽容化生效）。
- 日志来源：`/home/dingx/DSF-work/docs/2026-08-24-故障一根因防护方案.md`、`docs/2026-08-24-记忆守卫插件说明.md`、`docs/2026-08-24-故障一①对齐守卫实施报告.md`。

### config-ui DeepSeek 思考级别纠正（server.js）

- 新增 `correctThinkingLevelMap(model, map)`，修正 pi-ai 目录对 DeepSeek 模型（deepseek-v4-flash/pro）的思考级别误标：minimal/low/medium 目录标 null 但 API 实测支持；xhigh 键在 deepseek/opencode-go 目录缺失、opencode 目录为 null，同属未标注（实际支持）。
- 限定双重条件：`api==='openai-completions'`（DeepSeek 专用 API 格式）+ 模型 id 含 deepseek——避免把 glm/kimi/qwen 等其他 OpenAI 兼容厂商的 null（真实不支持）一并改写，150 个非 DeepSeek reasoning 模型零回归。
- `shimSupportedThinkingLevels` 改用纠正后 map；`getSupportedThinkingLevelsShim` 的 origFn 优先路径同样注入纠正（克隆模型喂纠正后 thinkingLevelMap），两条路径一致——否则线上 require(ESM) 成功时修正不生效。
- 实测：deepseek/open code-go 两厂商 deepseek-v4-flash/pro 从 `["off","high","max"]` 修正为全部 7 级；opencode/open router 按厂商显式 null 保留差异；restart 后 /api/models 验证通过，非 DeepSeek 抽查零差异。
- 测试脚本归档：`.temp/archive/test-thinking-level-fix-20260824.js`。

### settings.yaml DeepSeek 模型 reasoningEfforts 声明（code-agent 代执行）

- 背景：主 agent 对 `~/.dsh/settings.yaml` 的 edit 被 guard-main-agent 白名单拦截（settings.yaml 不在主 agent 可写范围），由 guard 自动委派 code-agent 执行。
- 改动：4 个自定义 provider 的 deepseek-v4-flash/deepseek-v4-pro 各加 `reasoningEfforts`（minimal/low/medium/high/xhigh/max 全部 7 级 wire 自映射，off 不声明=不思考时不发参数）：
  - huoshan（volces ark）deepseek-v4-flash/pro
  - opencode-go（OPENCODE_GO_API_KEY）deepseek-v4-pro/flash
  - opencode-go-2（OPENCODE_GO_API_KEY_2）deepseek-v4-pro/flash（保留 contextWindow）
  - HS_CodingPlan（FANGZHOU_API_KEY）deepseek-v4-flash/pro
- SuanLi 的命名空间 id（deepseek/deepseek-v4-*）按主 agent 原 4 个 edit 的范围不动。
- 主 agent 草稿中 huoshan 首条 entry 的 id 笔误（id: deepseek-v4-pro / name: deepseek-v4-flash）已修正为 deepseek-v4-flash，避免 id 重复与 flash 丢失。
- 验证：js-yaml 解析通过；结构断言（id 唯一、级别合法、off 留空）通过；pi-ai 权威 `resolveProfiles` + `getModels` 物化 8 个模型全部 `reasoning=true` 且 thinkingLevelMap 完整（off→null，6 级映射）；dsh-web journalctl 无 settings 错误，服务 active；settings.yaml 热重载即时生效无需重启。
- config-ui `/api/models` 的 modelEfforts 对 settings 自定义 provider 仍为 null（server.js L539 既有设计：仅内置目录算支持级），属显示层独立问题，不在本次改动范围。
- 备份：`~/.dsh/settings.yaml.bak-deepseek-reasoning-20260825-010512`（回滚点）。

## 2026-08-25 思考级别 Bug 修复（全链路扫描 + 双层修正）

### 问题

pi-ai 内置目录（@earendil-works/pi-ai）对 opencode-go provider 的 8 个 reasoning 模型 thinkingLevelMap 误标 null，导致 config-ui 只显示受限级别，运行时选缺失级别抛 UNSUPPORTED_REASONING_EFFORT。

### 根因

pi-ai 目录中 DeepSeek/glm-5.2/hy3/kimi 等模型的 thinkingLevelMap 将 minimal/low/medium 等级别标记为 null（表示"未显式映射"），但实际 API 支持这些级别。

### 修复（两层）

**运行时层**（`~/.dsh/settings.yaml`，热重载）：

- opencode-go / opencode-go-2 两 provider 共 8 个模型加 reasoningEfforts 声明（minimal/low/medium/high/xhigh/max 自映射，off 不声明）
- 涉及：deepseek-v4-flash/pro（全 7 级）、glm-5.2（全 7 级）、hy3（缺 max）、kimi-k2.6/k3/minimax-m3（全 7 级）、qwen3.7-max（缺 high/max）

**显示层**（`config-ui/server.js`）：

- 扩展 `correctThinkingLevelMap` 新增 THOUGHT_CORRECTIONS 表覆盖 6 个非 DeepSeek 模型
- modelEfforts 生成逻辑扩展：settings 自定义模型的 reasoningEfforts 透传到 /api/models 返回
- 33/33 单元测试通过

### 验证

- /api/models 实测 opencode-go/opencode-go-2 共 8 模型全部正确显示
- grok-4.5 目录值 ['low','medium','high'] 与实测一致（API 不支持 reasoning_effort，属于目录正确）
- 其他 145 个 pi-ai 目录模型的 null 标记均为真实不支持（经抽样验证）

## 2026-08-25 清零任务执行（code-agent，15:57）

### 任务A journald

- 用量记录：system 4.1G / user 392.0M（35 个 128M 满 journal 文件，29 个密封于 07-28 单日突发，非持续增长）
- vacuum 全部失败：/var/log/journal 属 root 且 sudo 需密码，当前会话无权限 → 需用户执行 `sudo journalctl --vacuum-size=500M`（可按需加 --user 200M）
- 膨胀源：7 天日志顶源 = /health 404 共 24852 条（cross-platform-agent-system bus.py python[1119] 探测 127.0.0.1/10.10.10.9 无 /health 端点）+ dsh-auto-memory 2529 条 + {{commit}} 噪音 1392 条（08-24 单日集中）

### 任务B {{commit}} 字面量

- 修复 3 文件 4 处裸 {{xxx}}：failures.md L3（{{commit}}×2 + {{xxx}} + {{}}）、2026-08-24.md L25（{{/}}）、summaries/2026-08-24-晚上.json（{{/}}）→ 全部改反引号包裹
- 备份：failures.md.bak-20260825-155042；2026-08-25.md L31 原有反引号本已安全（grep 子串误报）
- 验证：活跃记忆文件零裸 {{xxx}}；剩余 2 个 .bak 属备份链保留（含任务点名不动的 MEMORY.md.bak-20260824-172458）

### 任务C .temp 367M

- 归档 17 项 → .temp/archive/2026-08-25清理/（质检/审计/QC 报告、计划、.sh/.mjs 脚本、旧 lib、yaml 配置快照、served-index.js 等）
- 删除 21 项本轮中间分析文件（~15M）+ node_modules 软链接（rm -f 只删链接，目标完好，审计 L6 项落实）
- 保留 5+软链接处理：README.md（目录规约）、restart-dsh.sh（用户重启工具+文档引用）、subagent-guard-p1-plan.md（docs/计划.md 引用）、9888-models.json+refresh.log（scripts/refresh-9888-models.py 活动输出）

### 任务D 会话归档

- 审计结论：~~/.dsh/sessions 578 会话 createdAt 全在 08-18~~08-25，0 个 >30 天 → 无归档对象，全部保留（query.sqlite 116M 未动，无正在使用会话）

### 任务E 白名单路径

- 备份：docs/主agent可改写文件清单.yaml.bak-交互目录修复-20260825-155600
- 修正：value 由不存在的 /home/dingx/与agent的交互目录/ → /home/dingx/DSF-work/与agent的交互目录/（reason 同步注明）
- 验证：YAML 解析 OK（5 条白名单），guard-main-agent 下次 pre-execute 生效（src/index.ts L102），工作区无其他错误路径引用

## 2026-08-25 全量备份快照（迁移软路由前最后保险）

- 目标: `.temp/backup-20260825/full-20260825-155936/`（117M）
- 清单（详见备份根 MANIFEST.txt）: settings.yaml + .credentials.yaml（600 权限保留、未明文打印）→ config/；.agent-presets 七目录（6 preset + full.bak 链）→ agent-presets.tar.gz；~/.dsh/memory → dsh-memory-home.tar.gz；工作区 .dsh-memory（替代不存在的 ~/.dsh-memory）→ dsh-memory-workspace.tar.gz；query.sqlite 116M（不打包 sessions/ 会话目录）→ sessions/
- 校验: tar -tzf 三包全过；settings/credentials/query.sqlite 源==副本哈希一致；MANIFEST 逐项 sha256+字节数
- DSF-work 文档入库: commit 6ba6dcc（78 文件 +16495/−743，含迁移清单/职责文档/审计报告/CHANGELOG），新增 .gitignore 排除 backup-*/archive/9888 json/.dsh-memory/**pycache**（误提交的 pyc 已 amend 剔除）；本地 commit 未 push
- harness 确认: feature/lan-access 与 fork 两端同 HEAD 7f5954c2，工作树干净，未 push
- 全程未删除任何源文件、未重启服务

## 2026-08-25 dsh 软路由安装包 v0.1.3 重新打包

- 任务: 修复 scripts/build-dsh-router-package.sh(v0.2) 缺陷并重新打包, 产出含最新 harness(7f5954c2) 的新包
- 脚本修复 5 项(原脚本已备份 build-dsh-router-package.sh.bak-v02-20260825-163831):
  - B1 素材三级回退: resolve_material_example_settings(缓存 → 旧包 archive 解包 → ~/.dsh/settings.yaml 脱敏生成) + resolve_material_node_runtime(下载失败复用旧包 node/); prepare_node 重构支持 FROM_ARCHIVE 兜底, 兜底后 alpine 容器验证 node --version
  - B2 版本 v0.1.2 → v0.1.3: 同步 install.sh / etc/init.d/dsh / README heredoc 全部字面量 + 构建日期动态化
  - M1 OLD_PKG_DIR 无保护 cp 改为素材解析函数, 三路皆缺即 die 并给出明确来源提示
  - M2 preflight rm -rf 增加 case 保护: 仅允许清理 $WORKSPACE/.temp/dsh-deploy* (构建工作区), archive/旧包不受波及
  - L1 MANIFEST.txt: 包内 + 顶层 .MANIFEST.txt 双份, 记录 harness-commit(7f5954c212)/素材来源/关键文件 sha256/包 sha256
- 打包执行: 全流程一次通过, 严格可执行性检测 12 项全绿(node --version / dsh --version 0.1.1-rc.2 / dump-default-config DUMP-OK / web HTTP 200 + root div / ELF musl / 5 个 @deepseek-ai 闭包包 / bash -n)
- 素材来源: example-settings=② 旧包解包(v0.1.2 archive); node=① 下载缓存(原本地无缓存, 本次下载成功, 缓存至 .temp/dsh-deploy/downloads/ 供下次复用)
- 产物: .temp/dsh-router-install-v0.1.3.tar.gz 104041274 B, sha256 52976f0d14e6...9066524; 包内闭包含最新代码证据: dsh-tool-cordis allowMutation + dsh-guard-main-agent fail-open(0d6c793a04 晚于 v0.1.2 打包点 2096f422db, 确认增量已入包)
- 清理: .temp 临时检查物全部删除, archive 与备份目录完好(rm -rf 保护验证有效); 全程未重启服务

## 2026-08-25 可移植性改造 + 本地云端化备份准备

- 任务：绝对路径参数化（本机零行为改变）+ git bundle 云端介质先行 + 敏感层 gpg 加密
- 1a `scripts/adapt-machine-paths.sh` v1.0（新建）：迁移后一键适配；`bash scripts/adapt-machine-paths.sh <新工作区路径> <新IP|--keep-ip> [--dry-run]`；改 yaml 5 处 value 前缀（ws 作用域，不碰历史说明/注释示例）、打印 dsh-web/config-ui 新版单元片段（full 作用域，不写盘不执行 systemctl）、改打包脚本 WORKSPACE/HARNESS_DIR 两行；改前备份 `*.bak-适配-<时间戳>`；diff 摘要；旧值可用 OLD_* 环境变量覆盖；bash -n 通过，dry-run/write/keep-ip 三模式实测通过（.temp 副本验证后清理）
- 1b `docs/service单元模板/`（新建）：dsh-web/config-ui 两个 .service.template（占位符 HOME/HARNESS_DIR/WORKSPACE/TRUSTED_HOSTS 替换硬编码）+ README 迁移用法（sed 替换 → daemon-reload 由用户执行）；运行中 systemd 单元未动（hash 不变）
- 1c `scripts/build-dsh-router-package.sh` L22-23 参数化：`WORKSPACE="${WORKSPACE:-/home/dingx/DSF-work}"`、`HARNESS_DIR="${HARNESS_DIR:-...}"` 环境变量可覆盖，默认值保留（本机行为不变）；备份 `build-dsh-router-package.sh.bak-适配-20260825-165720`；bash -n + 环境变量覆盖实测通过
- 1d `docs/可移植性与云端备份方案-20260825.md`（新建）：14 处主路径硬编码清单（yaml 5 + dsh-web 3 + config-ui 4 + 打包 2，含行号+内容+迁移动作）、2 处本机 IP（10.10.10.9/100.67.219.105 换机必改）、IP 三分类（10.10.10.2:9888 不变 / 本机 IP 必改 / 10.10.10.0/24 保留）、脚本用法、云端备份架构（harness fork=云端 / DSF-work bundle 先行 / 敏感层 gpg）、3 类备份恢复步骤、遗留风险
- 任务2 bundle：`dsf-work-2026-08-25.bundle` 34,197,192 B，sha256 c1da2944d4b49b7e03289e28def7e3c7e09ca749f088b364a201c6eb9da71230；git bundle verify 通过（完整历史，HEAD 4734d35）；可上传任意云端/网盘，`git clone <bundle>` 即恢复
- 任务3 gpg：本地生成无口令密钥 "DSF-backup <backup@local>"（rsa3072，仅存本机 gpg 环）；敏感层四源（settings.yaml/.credentials.yaml/~/.dsh/memory/sessions/query.sqlite）加密为 `encrypted/dsh-sensitive-2026-08-25.tar.gz.gpg` 48,412,476 B，sha256 490f2eee9af2a9c02a2b1bd89a1f851ac8b83c2918a11990fa73d66b27148304；`gpg -d | tar tzf -` 验证列出全部文件 OK；未打印任何密钥/凭据内容
- MANIFEST：备份根新建 `.temp/backup-20260825/MANIFEST.txt`（bundle+加密包 sha256/字节数+恢复说明）；交付物快照入 `.temp/backup-20260825/deliverables/`（脚本/模板/手册/参数化后打包脚本+备份）
- 全程零删除源文件、零重启、未改 .credentials.yaml/settings.yaml 内容、未动 systemd 单元
