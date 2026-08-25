# AI 网关配置 Web 界面（T1 后端 + T2 前端 + T4 首启向导）

Node 原生 http 实现（无框架），零构建：后端 `server.js` 提供全部 `/api/*` 接口 + Token 认证 + 静态托管前端；
前端为原生三件套 `index.html` + `app.js` + `style.css`（单页，深色主题，移动端可用）。

## 启动

```bash
cd projects/ai-gateway/config-ui
CONFIG_DIR=/path/to/dsh-home \     # 默认 ~/.dsh（settings.yaml / dsh.env / .config-ui-token 所在）
PRESETS_DIR=/path/to/agent-presets \  # 默认 $CONFIG_DIR/.agent-presets
PORT=3083 \                        # 默认 3083（dsh 308x 段：3080=受限对外面，3081=dsh 完整主入口，3083=配置界面）
HOST=127.0.0.1 \                   # 默认 127.0.0.1；LAN/手机访问用 0.0.0.0
DSH_PORT=3080 \                    # status 探测的 dsh web 端口，默认 3080
DSH_TRUSTED_HOSTS="10.10.10.0/24 127.0.0.1" \
node server.js
```

启动后浏览器打开 `http://127.0.0.1:3083/`。

**测试指向骨架（本机开发，绝不写真实 ~/.dsh）**：

```bash
CONFIG_DIR=/home/dingx/DSF-work/.temp/config-ui-test \
PRESETS_DIR=/home/dingx/DSF-work/.temp/config-ui-test/.agent-presets \
PORT=8091 node server.js
```

### 证书/令牌流程（首启 + 登录）

1. **首次访问**：后端自动生成随机 token 写入 `${CONFIG_DIR}/.config-ui-token`（600）。
2. **登录页**：`GET /api/boot` 仅在本次运行创建后的第一次访问回显明文 token 一次——
   页面显示"首次启动"面板（含复制按钮）并引导进入**三步首启向导**：
   ① 确认模型路由网关地址（默认 9888）→ ② 填 Provider 名称 + API Key（环境变量名自动生成）→
   ③ 完成检测（写密钥 + 读状态）→ 进入主视图。此后 `/api/boot` 恒为 `{"initialized":true}`，不再回显。
3. **再次访问**（token 已存在 / 换浏览器）：显示登录框，粘贴 token 即可（token 存于
   `sessionStorage`，浏览器会话内免重复登录；关闭标签页后需重新输入）。

## 界面功能区（T2）

| 标签     | 功能                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider | 列表 + 新增/编辑/删除（名称/显示名/endpoint/apiKeyEnv/API 风格/模型多行文本）；整体 PUT 替换 `llm-pi-ai.providers` 段，段外内容与注释保留                                                                                                        |
| 子代理   | 扫描 PRESETS_DIR 各 `agent.cordis.yml`：展示 id/名称/生效模型（`agentOptions.model` > `agent-default-model`）；model 下拉可手输（datalist），reasoningEffort 下拉 off/low/high/max；保存时只改目标字段（行级替换，保留注释），保存后自动回读校验 |
| 密钥     | 列表显示掩码（`sk-****abcd`），新增/覆盖 `{name, value}` 写入 dsh.env（600），保存后回显掩码，值输入框即清空                                                                                                                                     |
| 状态     | 运行状态（探针 dshPort）/dshPort/DSH_TRUSTED_HOSTS/配置目录后缀/配置服务端口                                                                                                                                                                     |
| 回滚     | 只读审计面：harness HEAD/备份计数/可用备份明细（cordis·凭据·记忆·git refs），对应 `rollback.sh`；**不执行回滚**，实际回滚走人工 CLI `bash ~/bin/rollback.sh`（每步二次确认）                                                                     |

安全约定：密钥**永不回显完整值**（API 掩码 + 页面不落明文 + 输入后即清空）；
除 `/api/boot` 外所有 API 要求 `Authorization: Bearer <token>`。

## 接口

| Method | Path                    | 说明                                                                                                                                                                                                                                               |
| ------ | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/status`           | `{running(探测 dshPort), port, dshPort, DSH_TRUSTED_HOSTS, configDir, presetsDir}`                                                                                                                                                                 |
| GET    | `/api/boot`             | 首启 token 明文（仅一次），之后 `{initialized:true}`                                                                                                                                                                                               |
| GET    | `/api/providers`        | 读 settings.yaml `llm-pi-ai.providers`（保留段外一切）                                                                                                                                                                                             |
| PUT    | `/api/providers`        | 整体替换 providers 段；备份 + 原子写                                                                                                                                                                                                               |
| GET    | `/api/keys`             | dsh.env 全部 KEY，值一律掩码（`sk-****abcd`；非 sk- 前 4 位 `****`）                                                                                                                                                                               |
| POST   | `/api/keys`             | `{name, value}` 写 dsh.env（追加/覆盖），chmod 600                                                                                                                                                                                                 |
| GET    | `/api/subagents`        | 扫描各子代理标注字段（id/名称/model/provider/reasoningEffort 等，带行号）+ 生效模型                                                                                                                                                                |
| PUT    | `/api/subagents/:id`    | 只改指定字段：`model`/`provider`/`effort`/`reasoningEffort`/`reasoning`/`agentOptions.provider`/`agentOptions.model`；字段不存在 422、未知字段 422、不存在 404；备份 + 原子写                                                                      |
| GET    | `/api/rollback`         | 回滚状态（只读，对应 rollback.sh）：`{dshHome, harnessDir, harnessHead, backupCounts{cordis,credentials,memory}, recentCommits[], rollbackRefs[]}`；harness 仓库默认 `/home/dingx/deepseek-harness`（`ROLLBACK_HARNESS_DIR`/`HARNESS_DIR` 可覆盖） |
| GET    | `/api/rollback/backups` | 可用备份明细（只读）：`{cordis[], credentials[], memory{backupDir,files[]}, commits[], rollbackRefs[]}`；备份源 = `$CONFIG_DIR` 下 `.agent-presets/full/*.bak-*`、`.credentials.yaml.bak-*`、`memory-backup/latest/`（生产即 `~/.dsh`）            |

静态托管：`/`、`/index.html`、`/app.js`、`/style.css`（白名单，无法读取 server.js 等源码）。

## 设计要点与边界

- 写路径全部**行/段级替换**，不经过 YAML 序列化 → 文件其他内容与注释天然保留。
- PUT providers 重写整个 `providers:` 子树（段内注释会被规范化，段外一切不动）。
- PUT subagents 只改**已存在**的标注行：字段不存在报 422；前端按 GET 返回的字段路径
  自动归一化（去掉 `[n]` 列表下标与 `config.` 前缀，如 `[19].config.agentOptions.model` →
  `agentOptions.model`），未标注模型字段的子代理显示只读说明并禁用编辑。
- 密钥输入框保存后立即清空；页面/控制台不留密钥明文。
- 首启向导第 ① 步网关地址为确认性输入（v0.1 无对应写入 API，仅提示 + 校验格式）；
  软路由部署形态地址建议 `http://10.10.10.2:9888`。
- 依赖：js-yaml 从本地仓库绝对路径 require（读解析用），不可用自动回退；写路径零依赖。
- 默认绑定 127.0.0.1 + Token 双保险；`HOST=0.0.0.0` 可切 LAN（手机浏览器直接访问）。
- 默认端口 3083（dsh 308x 段规划：3080=受限对外面，3081=dsh 完整主入口，3083=配置界面，避让 3081）；`PORT` 可覆盖。
  旧默认 8093 来历：本机 8090 被 hermes `system_monitor_web.py` 占用；8092 曾保留为测试端口（本机测试仍可用 `PORT=8091/8092` 覆盖，不受影响）。
