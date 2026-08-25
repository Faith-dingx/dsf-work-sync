# 计划：dsh 打包部署软路由（v2）

> 专项日期：2026-08-23
> 执行者：project-planner（本计划仅规划，不实施）
> 前置：立项.md + 软路由资产盘点 + DSH 改造部署指南
> 状态：**待用户解锁凭据后启动**
> 版本：**v2**（评审 major 7 项 + 新调研事实并入：H1 musl 实锤 / H2 体积实锤 / 原生包 musl 兼容矩阵 / S1-S3 / M1-M2 / 配额成本控制 / 实施分段）

---

## 一、目标与范围

### 1.1 专项目标

把 dsh（含 8 插件与配置）**打包装入软路由并自启**，手机浏览器可访问 `http://10.10.10.2:3080`，作为 AI 网关"AI 大脑"部件；输出可复现部署流程（为出厂镜像阶段做准备）。

### 1.2 不在本专项范围

- 软路由系统盘热备（已有独立方案）
- Hermes 与 dsh 的协同设计（阶段 2 另议）
- 出厂镜像（阶段 3）
- 产品化发布（阶段 4+）

---

## 二、部署形态选型

### 2.1 候选方案对比

| #     | 方案                       | 描述                                                      | 优点                                       | 缺点                                                                 | 可行性                   |
| ----- | -------------------------- | --------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------- | ------------------------ |
| **A** | **procd init 直接跑 node** | 软路由上运行预编译 node 二进制 + dsh dist，procd 管理进程 | 无额外依赖；进程管理成熟；开机自启原生支持 | 需自备 node 运行时（ImmortalWrt 默认无 node）；U 盘 overlay 容量有限 | ✅ **推荐**              |
| **B** | opkg 自建包                | 打包为 opkg 格式，通过 opkg install 安装                  | 符合 OpenWrt 生态；版本管理清晰            | 打包复杂度高；依赖解析麻烦；N3150 架构支持需测试                     | ⚠️ 可选（阶段 3 后考虑） |
| **C** | 容器化（Docker/lxc）       | 软路由跑 Docker，dsh 进镜像                               | 隔离好；可移植                             | N3150 + U 盘启动资源紧张；OpenWrt 原生不支持 Docker                  | ❌ 不推荐（资源超配）    |
| **D** | SSH 远程挂载运行           | dsh 仍在本机，软路由仅做 SSH 跳板                         | 零部署风险                                 | 违背"软路由本地运行"目标；网络依赖性强                               | ❌ 不推荐（非目标）      |

### 2.2 推荐方案：A（procd init 直接跑 node）

**理由**：

- N3150 4C4T + 内存有限（需确认，预估 2-4GB），procd 直接跑 node 最轻量
- U 盘 overlay 容量约 1-2GB；实测部署基线 ~320M（含 prod node_modules + node musl，见 §3.2），留足余量
- procd 是 OpenWrt 原生进程管理器，与 LuCI 面板集成良好
- 不依赖 opkg 源，离线可部署

**关键假设（需核实）**：

- [已实锤] ImmortalWrt 24.10.5 x86/64 官方镜像仅 musl libc（SDK 文件名含 musl，buildinfo 无 CONFIG_USE_GLIBC），node 必须自备 musl 版（§3.1）
- [已实锤] 部署体积基线 ~320M（prod node_modules 267M 等实测，§3.2）
- [待核实] 软路由当前 node 运行时状态（是否已 opkg install node）
- [待核实] U 盘 overlay 可用容量（当前已用空间）
- [待核实] 软路由内存余量（当前服务占用）

---

## 三、资源与依赖清单

### 3.1 Node 运行时

| 项目      | 要求                                                                       | 获取方式                                                                                                                             |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Node 版本 | **22.19+**（musl 构建；dsh engines：`^22.19.0 \|\| >=24.0.0`）             | 自备 **musl node 二进制**：`unofficial-builds.nodejs.org` 的 `node-v22.x.x-linux-x64-musl.tar.xz` ≈45MB（**官方/npm 均无 musl 版**） |
| npm/pnpm  | 无需（dsh 已预构建）                                                       | —                                                                                                                                    |
| 依赖      | dsh dist 已静态化，无运行时 npm install（随包携带 prod node_modules 267M） | —                                                                                                                                    |

**运行环境实锤**：ImmortalWrt 24.10.5 x86/64 官方镜像仅 musl（SDK 文件名含 musl，buildinfo 无 CONFIG_USE_GLIBC）；glibc 版（nodejs.org 官方）在软路由不可用，必须用上述 musl 版。

### 3.2 体积预算（实测基线）

| 组件                 | 大小      | 说明                                       |
| -------------------- | --------- | ------------------------------------------ |
| prod node_modules    | 267M      | pnpm deploy --prod（1.4G 全量减 dev 依赖） |
| web dist（去 .map）  | 4.8M      | 11M − 6.2M sourcemap                       |
| cli lib              | 228K      | apps/cli/lib（入口 bin.js）                |
| 8 插件 lib           | 5.3M      | packages/extensions/*/lib                  |
| node musl 运行时     | ~45M      | node-v22.x.x-linux-x64-musl                |
| **总包预估（基线）** | **~320M** | 软路由 overlay 容量预算内                  |

**可再精简项（可选）**：node-pty 包内 ~26M 平台 prebuild 裁剪（但 musl 无 prebuild，见 §3.4）；LLM SDK 冗余依赖。

### 3.3 dsh 构建产物（实测见 §3.2）

| 文件/目录                    | 大小估算   | 说明                                                                                                                                                                 |
| ---------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli/lib/`              | 228K       | CLI 入口（bin.js）+ 配置/插件模块                                                                                                                                    |
| `apps/web/dist/`             | 4.8M       | Web GUI（去 .map 后）                                                                                                                                                |
| `packages/extensions/*/lib/` | 5.3M       | **8 插件产物**（cordis-client-runner / cordis-host-runner / dsh-injection-manager / dsh-memory-manager / guard-main-agent / skill-router / tool-cordis / ui-cordis） |
| **合计**                     | **~10.3M** | 不含 node_modules（prod 267M，§3.2）与 node 运行时                                                                                                                   |

### 3.4 原生模块 musl 兼容矩阵（x86/64 musl 环境）

| 原生包                     | 兼容性    | 说明                     |
| -------------------------- | --------- | ------------------------ |
| sharp                      | ✅        | npm 安装自动选 musl 变体 |
| @koromix/koffi             | ✅        | 自带 musl_x64 预编译     |
| node-addon-require-builtin | ⚠️ 待核实 | npm 仅见 gnu 变体        |
| **node-pty**               | ❌        | **无 musl prebuild**     |

**实施高风险项：node-pty**，两条解决路径：

1. 在 musl 环境（软路由/交叉工具链）源码编译 pty.node
2. 本机 glibc 预交叉编译 pty.node，随部署包打进 node_modules（需与 musl node ABI 对齐，安装前实测）

### 3.5 端口规划

| 服务            | 端口             | 说明                                                                |
| --------------- | ---------------- | ------------------------------------------------------------------- |
| dsh Web GUI     | **3080**（默认） | 手机浏览器访问入口                                                  |
| dsh API（内部） | 3080（复用）     | Web GUI 与 CLI 同一进程                                             |
| **冲突检查**    | —                | 软路由当前无 :3080 占用（已确认 :7000/:9888/:9119/:5244/:7681/:80） |

**端口建议**：保持 3080 不变，无需改配置。

### 3.6 存储占用估算

| 组件                                                                              | 占用                              |
| --------------------------------------------------------------------------------- | --------------------------------- |
| node musl 运行时（自备）                                                          | ~45MB                             |
| 部署包（prod node_modules 267M + cli lib 228K + web dist 4.8M + 8 插件 lib 5.3M） | ~277MB                            |
| settings.yaml + agent-presets + profiles                                          | < 1MB                             |
| 运行时日志（轮转）                                                                | ~50MB/月（可配置）                |
| **总计（基线）**                                                                  | **~320M**（日志另按 50MB/月增长） |

### 3.7 内存占用估算

| 组件                     | 内存估算                   |
| ------------------------ | -------------------------- |
| Node.js 进程（idle）     | ~80MB                      |
| Node.js 进程（活跃对话） | ~150-200MB（视上下文长度） |
| 8 插件内存开销           | ~40MB                      |
| **总计**                 | **~160-260MB**             |

**软路由内存约束**：N3150 平台通常 2-4GB 内存，当前服务（Hermes+AList+面板等）预估占用 300-500MB，余量充足。

---

## 四、配置迁移方案

### 4.1 需迁移的配置清单

**目录约定（全文档统一）**：用户数据 → `/srv/dsh/home/.dsh`；应用/运行时 → `/srv/dsh/app`；node 自备目录 → `/srv/dsh/node`（`$NODE_DIR`，见 §5.1）。

| 配置项                | 来源（本机）                  | 目标（软路由）                            | 密钥策略                                  |
| --------------------- | ----------------------------- | ----------------------------------------- | ----------------------------------------- |
| `settings.yaml`       | `~/.dsh/settings.yaml`        | `/srv/dsh/home/.dsh/settings.yaml`        | ⚠️ **本机部署可带 key；出厂镜像必须剥离** |
| `agent-presets/full/` | `~/.dsh/.agent-presets/full/` | `/srv/dsh/home/.dsh/.agent-presets/full/` | 无密钥，全量迁移                          |
| `profiles/`           | `~/.dsh/profiles/`            | `/srv/dsh/home/.dsh/profiles/`            | 无密钥，全量迁移                          |
| 8 插件 lib            | `packages/extensions/*/lib/`  | `/srv/dsh/app/packages/extensions/*/lib/` | 无密钥，全量迁移                          |

### 4.2 密钥策略

**本专项（本机实际部署）**：

- settings.yaml 中的 API key 可保留（软路由是用户自有设备）
- 但需在部署脚本中标注"此步骤包含敏感凭据，仅限本机部署"

**出厂镜像阶段（阶段 3）**：

- settings.yaml 剥离所有 API key，仅保留 provider/model 配置
- 首启向导交互式注入用户凭据
- 密钥文件权限 chmod 600，仅 root 可读

### 4.3 迁移命令（待实施时执行）

```bash
# 0. 目录约定：用户数据 /srv/dsh/home/.dsh，应用 /srv/dsh/app，node /srv/dsh/node（$NODE_DIR）
# 1. 在软路由创建目录
mkdir -p /srv/dsh/home/.dsh/{agent-presets/full,profiles}
mkdir -p /srv/dsh/app/{apps/cli/lib,apps/web/dist,packages/extensions,node_modules}

# 2. 传输文件（从本机到软路由；部署包 = 瘦身打包产物，见 §3.2）
scp -r ~/.dsh/settings.yaml root@10.10.10.2:/srv/dsh/home/.dsh/
scp -r ~/.dsh/.agent-presets/full root@10.10.10.2:/srv/dsh/home/.dsh/.agent-presets/
scp -r ~/.dsh/profiles root@10.10.10.2:/srv/dsh/home/.dsh/
scp -r <部署包>/* root@10.10.10.2:/srv/dsh/app/

# 3. 设置权限
ssh root@10.10.10.2 "chmod 600 /srv/dsh/home/.dsh/settings.yaml"
```

---

## 五、自启与运维方案

### 5.1 procd 服务脚本

位置：`/etc/init.d/dsh`
注意：**node 走自备目录 `$NODE_DIR/bin/node`，不写 `/usr/bin/node`**；**CLI 入口为 `apps/cli/lib/bin.js`（非 src/bin.ts）**。

```sh
#!/bin/sh /etc/rc.common
# /etc/init.d/dsh — dsh Web GUI 服务

NODE_DIR=/srv/dsh/node   # 与 §4.1 目录约定一致

START=90
STOP=10

start_service() {
    mkdir -p /var/log/dsh
    daemon_start -p /var/run/dsh.pid \
        $NODE_DIR/bin/node /srv/dsh/app/apps/cli/lib/bin.js web \
        --host 0.0.0.0 --trusted-host 10.10.10.0/24 \
        >> /var/log/dsh/output.log 2>&1
}

stop_service() {
    daemon_stop /var/run/dsh.pid
}

restart() {
    stop_service
    start_service
}
```

### 5.2 开机自启

```bash
# 在软路由执行
chmod +x /etc/init.d/dsh
/etc/init.d/dsh enable
/etc/init.d/dsh start
```

### 5.3 日志管理

| 日志路径                  | 内容                 | 轮转策略                      |
| ------------------------- | -------------------- | ----------------------------- |
| `/var/log/dsh/output.log` | stdout/stderr        | logrotate 每周轮转，保留 4 份 |
| `/var/log/dsh/error.log`  | 错误日志（可选分离） | 同上                          |

### 5.4 重启策略

- procd 默认行为：进程崩溃后自动重启（max_starts=5, start_delay=10s）
- 可配置 `/etc/config/dsh` 调整重启参数（如需）

### 5.5 监控接入面板

- 面板 :7000 已支持 iframe 嵌入
- 新增 dsh :3080 入口，侧边栏导航项"AI 工作台"
- 监控指标（可选）：进程存活、内存占用（通过 `/proc/[pid]/status` 读取）

---

## 六、验证与验收标准

### 6.1 验收清单

| #   | 验收项         | 绿（通过）                                                         | 红（不通过）       |
| --- | -------------- | ------------------------------------------------------------------ | ------------------ |
| V1  | 服务启动       | `curl http://10.10.10.2:3080` 返回 HTML                            | 连接拒绝或超时     |
| V2  | 手机浏览器接入 | 手机 WiFi 下访问 `http://10.10.10.2:3080` 正常加载 UI              | 白屏/报错          |
| V3  | LAN 多设备访问 | 任意 LAN 设备（PC/手机/平板）可访问                                | 仅本机可访问       |
| V4  | 插件加载       | dsh 启动日志显示 8 插件加载成功（grep 自动化检查，见 §6.2 命令 6） | 任一插件加载失败   |
| V5  | 配置生效       | settings.yaml 中 model/provider 配置生效                           | 模型调用失败       |
| V6  | 开机自启       | 重启软路由后 dsh 自动启动，无需人工干预                            | 需手动启动         |
| V7  | 日志可查       | `/var/log/dsh/output.log` 有启动日志                               | 日志为空或路径错误 |

### 6.2 验收命令

```bash
# 1. 服务状态
/etc/init.d/dsh status

# 2. 进程检查
pgrep -f "node.*dsh" && echo "运行中" || echo "未运行"

# 3. 端口监听
netstat -tlnp | grep 3080

# 4. 手机浏览器实测
# 用户操作：手机连 WiFi，打开 http://10.10.10.2:3080

# 5. 日志检查
tail -f /var/log/dsh/output.log

# 6. 插件加载自动化检查（8 插件逐一 grep，缺失即报）
for p in cordis-client-runner cordis-host-runner dsh-injection-manager dsh-memory-manager guard-main-agent skill-router tool-cordis ui-cordis; do
    grep -q "$p" /var/log/dsh/output.log || echo "MISSING PLUGIN: $p"
done
```

---

## 七、任务分解（ bite-sized，每任务 ≤ 30min）

### 阶段 1：环境准备（T1-T3）

| #   | 任务             | 描述                                                                                                                                         | 依赖                                | 预估  | 验收                                                                        |
| --- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----- | --------------------------------------------------------------------------- |
| T1  | 核实软路由资源   | SSH 登录软路由，执行 `free -m` + `df -h` + `opkg list                                                                                        | grep node`，确认内存/存储/node 状态 | 无    | 15min                                                                       | 绿：输出资源报告；红：无法 SSH 登录 |
| T2  | 准备 node 二进制 | 从 unofficial-builds.nodejs.org 下载 node-v22.x.x-linux-x64-musl（官方/npm 无 musl 版），上传至软路由 `/srv/dsh/node/`（$NODE_DIR）          | T1                                  | 20min | 绿：`/srv/dsh/node/bin/node --version` 输出 v22.19+；红：下载失败或版本不对 |
| T3  | 准备 dsh 部署物  | 本机瘦身打包：pnpm deploy --prod + 平台 prebuild 裁剪 + web dist 去 .map（§3.2），产物含 cli lib + web dist + 8 插件 lib + prod node_modules | 无                                  | 20min | 绿：部署包生成，总包 ~320M 基线（§3.2）；红：构建/打包失败                  |

### 阶段 2：部署实施（T4-T7）

| #   | 任务                | 描述                                                                     | 依赖  | 预估  | 验收                                             |
| --- | ------------------- | ------------------------------------------------------------------------ | ----- | ----- | ------------------------------------------------ |
| T4  | 传输文件到软路由    | scp 传输 node 二进制 + dsh dist + 配置文件                               | T2/T3 | 10min | 绿：软路由文件完整；红：传输中断或文件缺失       |
| T5  | 编写 procd 服务脚本 | 在软路由 `/etc/init.d/dsh` 写入服务脚本（BusyBox ash 语法，模板见 §5.1） | T4    | 15min | 绿：脚本 `ash -n` 校验通过；红：语法错误         |
| T6  | 注册自启并启动服务  | `/etc/init.d/dsh enable && /etc/init.d/dsh start`                        | T5    | 5min  | 绿：服务状态 active；红：启动失败                |
| T7  | 基础连通性验证      | `curl http://10.10.10.2:3080` + 检查日志                                 | T6    | 5min  | 绿：HTTP 200 + 日志正常；红：连接拒绝或 500 错误 |

### 阶段 3：验收测试（T8-T10）

| #   | 任务               | 描述                                                                    | 依赖 | 预估  | 验收                                             |
| --- | ------------------ | ----------------------------------------------------------------------- | ---- | ----- | ------------------------------------------------ |
| T8  | 手机浏览器接入测试 | 用户手机连 WiFi，访问 `http://10.10.10.2:3080`，截图确认                | T7   | 10min | 绿：UI 正常加载；红：白屏或报错                  |
| T9  | 插件加载验证       | 检查 dsh 启动日志，确认 8 插件加载成功（自动化 grep 检查，§6.2 命令 6） | T7   | 5min  | 绿：日志显示 8 插件 loaded；红：任一插件加载失败 |
| T10 | 配置生效验证       | 发起一次对话，确认 settings.yaml 中 model/provider 生效                 | T8   | 10min | 绿：模型调用成功；红：调用失败或模型不对         |

### 阶段 4：文档输出（T11-T12）

| #   | 任务         | 描述                                                                                     | 依赖 | 预估  | 验收                                                         |
| --- | ------------ | ---------------------------------------------------------------------------------------- | ---- | ----- | ------------------------------------------------------------ |
| T11 | 输出部署脚本 | 将 T1-T7 步骤整合为可重复脚本 `deploy-dsh-to-softrouter.sh`（**统一 BusyBox ash 语法**） | T10  | 20min | 绿：脚本 `ash -n` 校验通过且可一键部署；红：校验报错或缺步骤 |
| T12 | 更新项目文档 | 写入 CHANGELOG + 更新 PROGRESS.md                                                        | T11  | 10min | 绿：文档更新；红：未记录                                     |

**总预估**：约 3-4 小时（含用户测试时间）

---

## 八、配额与成本控制

- 部署任务多为**本地 CPU 任务**（构建/瘦身打包/脚本编写/`ash -n` 校验/文档），**零模型配额消耗**
- ⚠️ **凡启动耗模型子代理任务前**，先查 `http://127.0.0.1:9888/api/models`（软路由本机）确认 opencode 配额；**当前 API 未暴露 GO 剩余额度**，需面板确认
- 硬上限**以用户告知 / GUI 面板为准**

---

## 九、风险与对策

| #   | 风险                           | 影响               | 对策                                                                                                                      |
| --- | ------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| R1  | 软路由 SSH 凭据缺失            | 无法部署           | **阻塞项**：需用户提供 SSH root 密码或密钥                                                                                |
| R2  | 软路由内存不足（< 512MB 余量） | dsh 启动失败或 OOM | T1 核实后评估；如不足，考虑裁剪插件或升级硬件                                                                             |
| R3  | U 盘 overlay 空间不足          | 文件传输失败       | T1 核实后评估；如不足，清理旧日志或扩展分区                                                                               |
| R4  | node 二进制与 musl 不匹配      | 无法运行           | N3150 是 x86_64，但 ImmortalWrt 24.10.5 仅 musl：必须用 node-v22-linux-x64-**musl**（glibc 官方版不可用）；异常时源码编译 |
| R5  | dsh 依赖库缺失                 | 启动报错           | 自备完整 node 二进制；原生模块兼容性按 §3.4 矩阵核对，重点 node-pty（无 musl prebuild，需预编译进部署包）                 |
| R6  | 防火墙阻断 3080 端口           | 外部无法访问       | 软路由防火墙放行 3080（LAN 侧）                                                                                           |

---

## 十、用户协助清单（必须解锁）

> 以下事项用户回来后必须处理，否则专项无法启动。

| #      | 协助项                | 说明                                  | 紧迫性            |
| ------ | --------------------- | ------------------------------------- | ----------------- |
| **U1** | 软路由 SSH 登录凭据   | root 密码或 SSH 密钥（10.10.10.2:22） | **高**（阻塞 T1） |
| **U2** | ttyd :7681 登录凭据   | 备选访问方式（如 SSH 不通）           | 中                |
| **U3** | LuCI :80 登录凭据     | 备选访问方式（如 SSH/ttyd 不通）      | 低                |
| **U4** | Hermes :9119 登录凭据 | 如需联动验证（本专项非必须）          | 低                |
| **U5** | 确认端口 3080 可用    | 确认软路由防火墙未阻断                | 中                |
| **U6** | 手机浏览器测试        | T8 需用户实际操作验证                 | 中                |

---

## 十一、实施分段

### ✅ 自主可推进段（现在就能做，无需用户在场）

| 事项           | 说明                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| 瘦身打包       | pnpm deploy --prod（1.4G → prod node_modules 267M）+ 平台 prebuild 裁剪 + web dist 去 .map，产出 ~320M 部署包（§3.2） |
| procd 脚本模板 | 编写 `templates/etc-init-dsh` 模板（$NODE_DIR/bin/node + lib/bin.js，§5.1）                                           |
| ash 校验       | 部署脚本与 procd 模板统一 BusyBox ash 语法，`ash -n` 校验通过                                                         |
| 部署操作手册   | 撰写部署操作手册（含回滚步骤）                                                                                        |
| 密钥与首启策略 | settings.yaml 密钥剥离 + 首启注入策略设计（出厂镜像预研）                                                             |
| 回滚方案       | 软路由 overlay 快照 / 备份恢复回滚方案设计                                                                            |

### 🔒 等用户解锁段（用户回来后处理）

| 解锁项                  | 阻塞原因                                           |
| ----------------------- | -------------------------------------------------- |
| 软路由登录凭据（U1-U3） | 无 SSH/ttyd/LuCI 凭据无法登录，阻塞 T1-T7 部署实施 |
| 3080 端口放行确认（U5） | 需确认软路由防火墙未阻断 :3080                     |
| 手机实测（U6/T8-T10）   | 需用户手机浏览器验收                               |

---

## 十二、交付物

| #   | 交付物             | 路径                                                      |
| --- | ------------------ | --------------------------------------------------------- |
| 1   | 部署脚本           | `projects/ai-gateway/scripts/deploy-dsh-to-softrouter.sh` |
| 2   | procd 服务脚本模板 | `projects/ai-gateway/templates/etc-init.d-dsh`            |
| 3   | 部署报告           | `projects/ai-gateway/docs/部署报告-dsh软路由.md`          |
| 4   | CHANGELOG 更新     | `docs/CHANGELOG.md`                                       |
| 5   | PROGRESS 更新      | `docs/PROGRESS.md`                                        |

---

## 附录：参考文档

- 软路由资产盘点：`/home/dingx/DSF-work/docs/软路由资产与热备方案.md`
- dsh 改造部署指南：`/home/dingx/DSF-work/docs/DSH-改造部署指南.md`
- dsh vs Hermes 对比：`/home/dingx/DSF-work/docs/dsh-vs-hermes-对比.md`
- 项目立项：`/home/dingx/DSF-work/projects/ai-gateway/立项.md`
- 产品化路线：`/home/dingx/DSF-work/projects/ai-gateway/docs/计划-产品化路线.md`
