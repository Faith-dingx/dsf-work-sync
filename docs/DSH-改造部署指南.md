# DeepSeek Harness 局域网多设备部署改造指南

> 目标：让每台设备上的 dsh Web UI 都通过局域网/Tailscale 远程可访问，
> 并且 agent 拥有完整工具 + 全放开权限，便于从 Windows 工作机远程操控。

## 一、改造内容总览

### 1. 局域网访问支持（deepseek-harness 源码改动）
在 `~/deepseek-harness` 仓库的 `feature/lan-access` 分支上固化（commit `e03033c0ba`）：

| 文件 | 改动 | 作用 |
|---|---|---|
| `packages/bundle/web-app/src/startup.ts` | 移除 `--host 0.0.0.0` 的硬性拦截 | 允许绑定任意地址（含 0.0.0.0） |
| `packages/host/webserver/src/index.ts` | host 配置放宽为任意 string | 支持绑定具体接口 IP |
| `packages/client/connection/src/index.ts` | 特权方法栅栏改用 `trustedHosts` | 受信局域网主机可访问 settings/credentials 等特权方法 |
| `apps/web/src/main.ts` | polyfill `crypto.randomUUID` | 非 HTTPS 源（如 http://<LAN-IP>）下 UI 正常工作 |

**必须保留**这些改动，否则升级/重装会丢失局域网访问能力。

**验证**：`pnpm run build:lib:host` 与 `typecheck:contracts-ready` 均通过。

### 2. 自定义 Agent 预设 `full`（全能模式）
位于 `~/.dsh/.agent-presets/full/`（用户预设根 `$DSH_HOME/.agent-presets`）：
- 基于官方 `cordis` 预设（包含 `standard` 全部能力 + 自省/插件工具）
- Persona 改为通用"全能工程师"：全工具 + 全放开权限 + 自主执行
- 含 `editing-cordis-compositions` / `cordis-plugin-development` 两个 skill

### 3. settings.yaml（`~/.dsh/settings.yaml`）
```yaml
agent-default-model:
  provider: opencode-go
  model: deepseek-v4-flash
agent-presets:
  default: full          # 新建会话默认使用 full 全能模式
permission:
  defaultPreset: danger-full-access   # 全放开 + 审批 never
llm-pi-ai:
  providers:
    opencode-go:
      apiKeyEnv: OPENCODE_GO_API_KEY
```

### 4. 启动脚本 `dsh-lan`（跨设备统一入口）
位置：`~/bin/dsh-lan`（已在 PATH）
- 自动收集本机所有非回环 IPv4（局域网 + Tailscale + docker bridge）
- 以 `--host 0.0.0.0 --trusted-host <各IP>` 启动 dsh web
- 支持 `start|stop|status|restart`，后台运行 + 日志轮转

```sh
# 常用
~/bin/dsh-lan status
~/bin/dsh-lan start            # 默认端口 3080
~/bin/dsh-lan start --port 3090
~/bin/dsh-lan restart
```

## 二、在另一台设备复现的步骤

1. **部署 deepseek-harness 源码**（含 feature/lan-access 改动）
   - 克隆官方仓库，checkout 到 `feature/lan-access` 分支（或应用补丁文件）
   - `pnpm install && pnpm run build`
2. **创建 `full` 预设**：复制 `~/.dsh/.agent-presets/full/` 目录到新设备
3. **写入 settings.yaml**：按上文配置
4. **部署 `dsh-lan` 脚本**到新设备的 `~/bin/`
5. **启动**：`dsh-lan start`
6. 从 Windows 工作机访问 `http://<设备局域网IP>:3080`

## 三、注意

- dsh 当前以"源码模式"运行（`node --import tsx/esm apps/cli/src/bin.ts web ...`）
- 改动后的会话（含本文件所在 DSF-work 工作区）会在 dsh 重启后加载新预设
- 局域网访问需要本机防火墙放行 3080 端口（可选 systemd 服务实现开机自启）
