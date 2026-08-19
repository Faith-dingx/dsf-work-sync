# DSF-work 工作区总览（记忆中枢）

> 本文件是**新会话的入口文档**。任何新开 / 恢复的 dsh 会话，先读这个文件。
> 维护约定：每完成一件事或改变目标，都同步更新本文件及相关文档。

## ⭐ 记忆文件维护规则（铁律，所有记忆文档一律遵守）

**只存三类，零细节、精简易懂白话：**
1. **① 关键规则** —— 必须记住的约定/规矩（如本规则、用户偏好）。
2. **② 关键文件指针** —— 指向具体文件/路径，不复制内容。
3. **③ 流水账指针/规则** —— 指向详细记录存放处（如 CHANGELOG/PROGRESS），不照抄明细。

**不存**：过程细节、长解释、可随时从代码/会话查回的流水账。记忆要"够用、一眼懂"。

## 一、这是哪里

- **工作目录**：`/home/dingx/DSF-work`（软路由所在局域网 10.10.10.0/24 的主控机）。
- **机器角色**：服务器A / 大脑 —— `10.10.10.9`（本机，运行 dsh + 本机 Hermes）。
- **软路由**：`10.10.10.2`（OpenWrt，LuCI :80；面板 :7000/:18080；ttyd :7681；目录 :8081；Alist :5244；**Hermes dashboard :9119**）。
- **主导项目**：把 dsh 打造成"局域网多设备统一管理 + 多方协作"的中枢，长期稳定承载用户工作。

## 二、已完成的事（详见 docs/CHANGELOG.md）

1. **局域网访问改造**（deepseek-harness 源码，`feature/lan-access` 分支，e03033c0ba）：
   Web 可绑定 0.0.0.0、受信局域网主机可访问特权方法、非 HTTPS UI 正常。
2. **`full`（全能模式）预设**：基于 cordis，默认预设，全工具 + 全放开 + 自主执行。
3. **settings.yaml**：默认 preset=full，permission=danger-full-access。
4. **`dsh-lan` 启动脚本**（~/bin/dsh-lan）：跨设备统一入口。
5. **工具备齐（本轮新增）**：
   - 宿主开启跨会话全文检索索引（FTS）；
   - 宿主挂 LSP 后端（lsp-stdio/tsserver）+ PTY 终端后端（terminal-bash）；
   - full 预设新增 5 个工具：tool-session-query / tool-lsp / tool-terminal /
     tool-bash-persistent / tool-str-replace-editor。
6. **辅助模型省钱全景（2026-08-19，详见 docs/CHANGELOG.md 阶段5）**：
   - A1 压缩 → agnes-2.5-flash（免费，9888 记账实锤）；
   - A2 会话标题 → agnes（profile patch `session-title-llm`）；
   - B0 web 搜索 → `dsh-free-search`（免费 Bing 多引擎，不再依赖 DeepSeek key）；
   - B1 记忆 → `dsh-persona-memory`（MEMORY.md/USER.md + 后台自动学习）。
   - dsh 已由 Hermes 建 `dsh-web.service`（systemd 开机自启，3080）+ 监控面板重启按钮。

## 三、正在做的事

- 工具备齐已完成并通过重启验证（lsp/terminals/sessionQuery 均已挂载，见 docs/CHANGELOG.md 2.1b）。
- 下一步：软路由 Hermes 接入 + 局域网统一管理平台（见"四"）。

## 四、接下来要做的（项目目标，详见 docs/PROJECT.md）

1. **局域网统一管理 / 多方协作平台**：建立一个"会话中枢 + Web 界面"，让
   本机 dsh、软路由 Hermes（及未来每台设备的 agent）、用户 三方都能在同一组会话里对话。
2. **软路由 Hermes 接入**：接入方式待定（需登录凭据/细节）。
3. **多设备可复用**：把工具集 & 中枢做成可复制到局域网内其他设备的机制。

## 五、文档索引

| 文档 | 内容 |
|---|---|
| `docs/CHANGELOG.md` | 已完成的全部改动明细（含待办/生效状态） |
| `docs/PROJECT.md` | 项目目标、需求、架构、路线图 |
| `docs/DSH-改造部署指南.md` | 局域网多设备部署的复现步骤 |
| `patches/` | 可移植源码补丁 |
| `docs/PROGRESS.md` | 当前进行中的步骤与阻塞点 |
| `docs/hermes-能力参考文献.md` | **Hermes 完整探查 + 可借鉴功能总表（S/A/B/C）+ 分批路线（加功能先查这里）** |
| `docs/dsh-vs-hermes-对比.md` | Hermes 对比简版摘要 |

## 六、会话与记忆备忘

- dsh 会话存档：`~/.dsh/sessions/<workspace>/session-*.jsonl(.zstd)`，每会话独立。
- 跨会话检索已可用（tool-session-query，重启后生效）。
- 本机 Hermes 在 `~/.hermes/`（`hermes chat`/`send`/`acp` 可用）；软路由 Hermes 在 `10.10.10.2:9119`。
