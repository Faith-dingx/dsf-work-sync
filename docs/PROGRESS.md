# 当前进度与阻塞点（PROGRESS）

> 每次进入实施或承接新会话时，从这里看"现在卡在哪一步、下一步做什么"。

## 当前进行中的步骤

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

## 已确认的事实（备忘，避免重复探查）

- 局域网：本机 `10.10.10.9`，网关/软路由 `10.10.10.2`，Tailscale `100.67.219.105`。
- 软路由 .2 端口：22(SSH dropbear,免密不通)、80(LuCI)、7000/18080(面板)、
  7681(ttyd)、8081(目录)、5244(Alist)、8888(BasicAuth)、9119(**Hermes dashboard**，uvicorn，需登录)。
- 本机 Hermes：`~/.hermes/`，`hermes chat -q` 已验证可用（默认 deepseek-v4-flash/opencode-go）。
- 本机 Hermes dashboard：`127.0.0.1:9119`（同款 uvicorn+登录）。
- dsh 已于 2026-08-18 20:19 重启（工具备齐改动已生效，见 CHANGELOG 2.1b）；
  旧进程曾占 3080 端口导致重启报 `EADDRINUSE`，现已解决。
