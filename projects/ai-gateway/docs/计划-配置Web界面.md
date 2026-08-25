# 计划：AI 网关配置 Web 界面（v0.1）

> 目标：本机形态实现可视化配置管理页 → 调试成熟后转软路由 LuCI 插件（用户定调）。只规划。

## §1 定位与形态

- **独立轻量 Web 应用**：后端 Node http 服务（不引 koa/express 等依赖，用 Node 原生 http 模块 + 少量手写路由即可）+ 前端单页 HTML/CSS/JS（原生实现，无构建步骤）。**无重型框架优先**；若确需框架，选体积小的（如 Preact，核心 ~4KB gzip，整包含 htm 约 6-8KB），需说明体积开销并控制在单页内可加载（< 50KB gzip）。v0.1 定为纯原生实现，不引入任何前端框架。
- **本机调试端口建议 :8093**：与 dsh web :3080 不冲突，也与模型路由 :9888、监控 :8081 均不冲突；端口可通过环境变量覆盖。（说明：本机 8090 被 hermes `system_monitor_web.py` 占用，故默认 8093；8092 保留为测试端口。）
- **读写对象**：
  - `/srv/dsh/home/settings.yaml`：配置主体，读 `llm-pi-ai` providers 等（name/endpoint/model 列表）；写入时保留文件其余无关段（backup + 原子写：先写临时文件再 rename）。
  - `/srv/dsh/home/dsh.env`：密钥存放（如 `OPENAI_API_KEY=...`），**文件权限 600**，API/前端均不回显完整值（仅掩码，如 `sk-****abcd`）。

## §2 功能清单 v0.1（最小集，标必需/可选）

1. **模型 Provider 管理**【必需】：新增/编辑/删除 Provider，字段含 name / endpoint / apiKeyEnv（关联的环境变量名）/ model 列表（多行文本或逗号分隔）。密钥输入只写 `dsh.env`（按 apiKeyEnv 变量名写入），读取一律掩码。
2. **服务开关**【必需】：dsh 服务 start / stop / status 操作（本机形态调用 init 脚本或等价控制命令，软路由形态为 `/etc/init.d/dsh`），页面显示运行端口 :3080、显示 `DSH_TRUSTED_HOSTS` 当前值。
3. **首次使用向导**【必需】：三步流程——①配置模型路由 9888（填写/确认模型路由服务地址与默认模型）→ ②填写至少一个 Provider key → ③完成检测（调用一次模型路由或 Provider 连通性检查）并跳转到主页面。
4. **状态卡片**【可选 v0.2】：服务运行状态、端口、配额显示占位——软路由模型路由可为 `/api/models` 配额留接口位（当前 API 未暴露 GO 剩余额度，v0.2 先做占位卡片，接口就绪后填充）。
5. **子代理管理**【必需，用户痛点】：列出全部子代理（`~/.dsh/.agent-presets/*/agent.cordis.yml` 解析 id/模型/思考级别等字段）；单个子代理可改 model/思考级别等标注字段（只改指定字段，保留文件其余与注释不动）；写入目标路径可配（本机=`~/.dsh/.agent-presets`，软路由=`/srv/dsh/home/.agent-presets`）。字段语义对齐 dsh 真实机制：`agentOptions.provider/model` 覆盖子代理模型（工具行 config 内），未覆盖时回退 `settings.yaml` 的 `agent-default-model`；思考级别对应 `reasoningEffort`/`effort` 标注。

## §3 安全

- **页面 Token 认证**：首启时后端生成随机 token（`crypto.randomBytes(32).toString('hex')`），**只在首启页面显示一次**（此后可从 `dsh.env`/独立 token 文件中删除或标记已消费，不再回显）；后续访问需在登录页输入 token，会话内以 Authorization header 携带。
- **dsh.env 写时 chmod 600**；**never 回显完整密钥**（仅掩码；编辑场景不回填原值，留空表示"不变"）。
- **仅允许本机/LAN 访问**：绑定 `0.0.0.0` 并强制 Token 认证（默认），或绑定 `127.0.0.1` 由面板（LuCI/nginx）反向代理（阶段 C 方案）。两方案在代码里做成可配置项，默认本机调试用 `127.0.0.1` + Token 双保险。

## §4 转 LuCI 路径（分阶段）

- **阶段A（本版）**：独立 Web 应用，后端 API 直读直写 `settings.yaml` + `dsh.env`。验收：本机 `:8093` 可完整增删改查 Provider 与服务开关，密钥不回显。
- **阶段B**：API 层抽象为"配置读写接口"（`getProvider/setProvider/upsertKey/...`），映射到 UCI（config dsh 段：provider/model/key env），供 LuCI 后端调用。验收：同一套前端业务逻辑，后端切换为 UCI 读写实现后功能不回归。
- **阶段C**：LuCI 插件（lua controller + view 页面），前端 JS 复用/改造，嵌入 LuCI 布局，与 luci 用户认证整合。验收：软路由 LuCI 内可完成 Provider 配置与服务管理，无需独立 token 页。
- 每阶段验收一句话（如上），阶段间以"前端行为不变、后端实现可替换"为迁移主线。

## §5 任务分解（bite-sized，各带绿/红验收）

- **T1 后端 API**：GET/PUT `/api/providers`、POST `/api/keys`（写 dsh.env 掩码回读）、GET `/api/status`、GET/PUT `/api/subagents`、`GET /api/boot`（token 首启单次）。验收：绿——curl 实测读写 settings.yaml/dsh.env 正确且 dsh.env 权限为 600；子代理 PUT 后仅目标字段变（diff 验证注释与其余内容保留、真实 preset 零改动）；红——写入不生效、权限非 600 或掩码回显完整密钥。
- **T2 前端单页**：Provider 列表 / 编辑表单 / 删除。验收：绿——浏览器可增删改，密钥输入框不回显完整值；红——操作后列表与服务端不一致，或密钥明文出现在页面/网络包。
- **T3 服务开关页**：调用 init 脚本 start/stop/status。验收：绿——端口 :3080 起停实测（status 与 curl 一致）；红——状态显示与实际进程不符或开关操作无效。
- **T4 首启向导**：三步流程 + token 认证。验收：绿——全新 DSH_HOME 目录（空 settings.yaml + 空 dsh.env）走通全流程并跳转主页面，token 唯一一次显示；红——token 二次回显或向导卡在某一步。
- **T5 本机端到端调试**：模拟软路由目录布局（`/srv/dsh/home` 骨架）跑通全部功能。验收：绿——截图/命令留痕（curl 输出 + 页面截图）；红——任一功能在骨架布局下失败。
- **T6（预留）LuCI 转制说明文档**：UCI 映射表 + 嵌入方案。验收：绿——文档产出，映射表覆盖 provider/model/key env、嵌入方案含 controller/view 结构；红——缺映射项或方案不可落地（本任务不实施，仅设计文档）。
- **周期预估**：T1-T5 约 1-2 天；T6 设计约 0.5 天。

## §6 实施分段

- **现在可自主推进**：T1-T5（本机，不依赖软路由凭据）——本机调试形态，读写本机 `settings.yaml`/`dsh.env`（测试用临时 DSH_HOME 骨架），无需软路由 SSH/LuCI 凭据。
- **等解锁**：T6 及软路由 LuCI 安装测试（需软路由登录凭据/授权）——涉及软路由实际部署、UCI 映射落地与 LuCI 集成，须在取得软路由访问凭据与用户授权后实施。
