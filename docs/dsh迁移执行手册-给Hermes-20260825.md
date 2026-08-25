# dsh 迁入软路由执行手册（交给 Hermes 执行）

> 2026-08-25 v1.3 · 本机 10.10.10.9 已备好安装包并已分块传到软路由
> 执行者：软路由(10.10.10.2) 上的 Hermes，按下面步骤在 OpenWrt root shell 逐条执行。
> 若有任何一步失败/输出不符，停下来报告，不要继续。
> v1.3：全部命令为绝对路径（不依赖 cd 相对路径，每条可独立复制执行）+ 执行进度快照。
> 安全提醒：任一命令的绝对路径/目标文件由手册内联定义，请勿凭 shell 记忆推断位置。

---

## 〇-1、执行进度快照（2026-08-25 本机 SMB 回读核实，执行前请确认）

> 软路由 SMB 共享（根=/mnt/data）实况，已核实：
>
> - [x] `temp/dsh-router-install-v0.1.3.tar.gz` **已拼接**（104041274B，与本机原包字节一致，应校验通过）
> - [x] `temp/dsh-router-install-v0.1.3/` **已解包**（app/etc/install/node/install.sh/README/MANIFEST 齐全）
> - [x] `temp/dsh-migrate-manual.md` 手册副本已同步（v1.3，覆盖后 SMB 回读与本机 `docs/dsh迁移执行手册-给Hermes-20260825.md` 字节一致）
> - [ ] 4 重隔离（§一）—— 待执行
> - [ ] install.sh 安装（§二）—— 待执行
> - [ ] 启动 + 自动启动验证（§三）—— 待执行
>
> 若上面 3 个 [x] 与实际不符（文件缺失/大小不一致），回到 §〇 重新拼接校验，失败即停。
> 若 [x] 已确认，可直接从 §一 继续执行（各步幂等可重跑）。

---

## 〇、前置：包已就位（SMB 分块已传到软路由本地）

安装包已由本机分块(50 块)传到软路由 SMB 共享，对应软路由绝对路径：

- **分块目录：`/mnt/data/temp/chunks/`**（`part-0000` ~ `part-0049`，每块 2MB，共 104MB）
- 拼接目标：`/mnt/data/temp/dsh-router-install-v0.1.3.tar.gz`
- 本手册副本：`/mnt/data/temp/dsh-migrate-manual.md`（更新后需重新覆盖）

包内含最新 harness(7f5954c2, 含 guard/工具面收敛), musl node 运行时 + libstdc++/libgcc_s 兜底。
安装包 sha256: `52976f0d14e66547c44d8b2bde34a31264be274fe5ad7e7dc9034978f9066524`

**第一步：本地拼接 + 校验（失败即停）**

```bash
cat /mnt/data/temp/chunks/part-* > /mnt/data/temp/dsh-router-install-v0.1.3.tar.gz && echo "52976f0d14e66547c44d8b2bde34a31264be274fe5ad7e7dc9034978f9066524  /mnt/data/temp/dsh-router-install-v0.1.3.tar.gz" | sha256sum -c -
```

预期输出：`/mnt/data/temp/dsh-router-install-v0.1.3.tar.gz: OK`（中文 locale 可能显示「成功」，均为通过；输出 FAILED/失败/命令退出码非 0 即停，报告）

> 备选传输（仅当分块缺失时用，本机 10.10.10.9 需开放 ssh/http）：
>
> ```bash
> # A. scp（在软路由执行，本机开了 ssh）
> scp dingx@10.10.10.9:/home/dingx/DSF-work/.temp/dsh-router-install-v0.1.3.tar.gz /mnt/data/temp/
> # B. 本机起 HTTP 服务（在本机执行，软路由 wget）
> wget -O /mnt/data/temp/dsh-router-install-v0.1.3.tar.gz http://10.10.10.9:8000/dsh-router-install-v0.1.3.tar.gz
> ```

---

## 一、4 重隔离落地（必须先于安装）

```bash
# ① 目录隔离：dsh 全部落在 /mnt/hermes/dsh（不散落 hermes 根）
mkdir -p /mnt/hermes/dsh

# ② Git 隔离（关键！在 hermes 仓库根追加，防止 hermes 的 git add -A 误纳入 dsh）
grep -qxF '/dsh/' /mnt/hermes/.gitignore || echo '/dsh/' >> /mnt/hermes/.gitignore
grep -qxF '/dsh'    /mnt/hermes/.gitignore || echo '/dsh'    >> /mnt/hermes/.gitignore

# ③ 服务隔离（install 会建独立 /etc/init.d/dsh，独立日志 /var/log/dsh.log——无需额外动作）
# ④ 数据隔离（dsh 的 settings 600 权限在安装时设置——无需额外动作）
```

---

## 二、安装（推荐 A 软链接法，避免改 install.sh）

```bash
tar xzf /mnt/data/temp/dsh-router-install-v0.1.3.tar.gz -C /mnt/data/temp        # 解出 /mnt/data/temp/dsh-router-install-v0.1.3/

# A 软链接法：让 install.sh 的 /srv/dsh 落到 /mnt/hermes/dsh
rm -f /srv/dsh                                    # 若存在旧软链接（rm -f 只删链接本身）
ln -s /mnt/hermes/dsh /srv/dsh

/mnt/data/temp/dsh-router-install-v0.1.3/install.sh   # 一键安装（校验包完整性→拷贝→生成 settings 模板→node 自检→装服务+enable 开机自启）
```

install.sh 预期输出：`[dsh-install] node 自检通过: v22.23.2` + `[dsh-install] 完成...`

> 若想 B 改路径法（不建软链接）：把 install.sh 内 `APP_DIR=/srv/dsh/app`、`NODE_DIR=/srv/dsh/node`、`DSH_HOME=/srv/dsh/home` 改为 `/mnt/hermes/dsh/...` 后执行，效果等同。

---

## 三、启动、验证与「自动启动」保障（本次重点）

### 3.1 启动服务

```bash
/etc/init.d/dsh enable      # 已由 install.sh 执行过，幂等无害
/etc/init.d/dsh start
sleep 2
```

### 3.2 逐项验证

```bash
/etc/init.d/dsh status                    # 应 running
tail -20 /var/log/dsh.log                  # 应无 ERROR/fail
/usr/sbin/lsof -i:3080 2>/dev/null || netstat -tlnp 2>/dev/null | grep 3080   # 端口监听
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080   # 应 200
# 自身访问 9888（局域网 AI 网关，本机即 10.10.10.2）
curl -s -o /dev/null -w '%{http_code}\n' http://10.10.10.2:9888/v1/models    # 应 200
```

### 3.3 自动启动保障确认（必须通过，这是本次迁移的关键验收）

```bash
ls -l /etc/rc.d/S95dsh     # 必须存在（enable 生成的开机自启链接，指向 ../init.d/dsh）
/etc/init.d/dsh enabled    # 应输出 enabled（BusyBox rc.common）
```

- `/etc/init.d/dsh` 是 rc.common procd 脚本（START=95），`enable` 后开机自启（S95dsh）
- procd `respawn` 配置（1h 内最多重启, 每次延迟 5s）：**进程崩溃自动拉起**，无需人工
- **最终验收：`reboot` 软路由后，等启动完成，`curl http://10.10.10.2:3080` 应返回 200**（若不便重启，S95dsh 存在 + status running 即为通过）

### 3.4 首启设置

install.sh 生成的 `/srv/dsh/home/settings.yaml` 是模板（key 占位）。第一跑前需填入真实 provider/key，否则 dsh 起得来但模型调用会失败——这是预期，密钥不随安装包走。

- 软路由生效文件（绝对路径）：`/srv/dsh/home/settings.yaml`、`/srv/dsh/home/dsh.env`
- 本机迁移源（绝对路径，非 `~` 相对）：`/home/dingx/.dsh/settings.yaml` 与 `/home/dingx/.dsh/.credentials.yaml`
- 或经 `/srv/dsh/home/dsh.env` 注入 `AGNES_API_KEY` / `OPENCODE_GO_API_KEY` 等（init.d/dsh 自动载入）
- 数据层（记忆/sessions/preset）后续从本机备份快照同步：`/home/dingx/DSF-work/.temp/backup-20260825/`（gpg 密钥需先在本机导出导入）

---

## 四、迁移后二次确认（供后续）

- 主 agent 工具面：`cordis_inspect_*` 在、`define/run/stop/undefine` 不在（allowMutation=false）
- 数据层（记忆/sessions/preset）后续从本机同步（备份快照在 .temp/backup-20260825/，gpg 密钥需先在本机导出导入）
- 本机 dsh 暂不关机，双跑并存直到软路由稳定

---

## 五、失败处理

任一步失败：保存输出，报告（不要擅自改配置/重装）。回滚：`/etc/init.d/dsh disable && /etc/init.d/dsh stop && rm -f /srv/dsh`（软链接本身），数据仍在 /mnt/hermes/dsh 可复查。
---

## 六、v0.1.4 补丁说明（2026-08-25 打包方修复，供参考/重装）

> 本手册主体针对已装的 v0.1.3；用户已在软路由真机手工修复 3 个「启动即崩」并运行正常。
> 打包方已把这些修复**内置到 v0.1.4 安装包**（`scripts/build-dsh-router-package.sh` v0.3），
> 后续重装/升级直接得正确行为，无需再手工改。

v0.1.4 内置的三项修复（对应真机三个崩溃，均为「启动即死」且只体现在 /var/log/dsh.log）：

1. **内置 musl 版 sharp**：包内闭包注入 `@img/sharp-linuxmusl-x64` + `@img/sharp-libvips-linuxmusl-x64`（含 RPATH 同级 symlink），修复 `Could not load the "sharp" module using the linuxmusl-x64 runtime` 崩溃。
2. **启动命令带 `--expose-internals`**：修复 HMR 服务 `--expose-internals is required for HMR service` 崩溃。
3. **`--trusted-host` 默认单 IP 自动探测**（不再写 `10.10.10.0/24` CIDR，dsh 拒绝网段）：优先级 环境变量/`dsh.env` → `uci get network.lan.ipaddr` → `ip` 兜底 → 127.0.0.1。
4. **install.sh 新增安装后真实启动自检**：start + curl 探活 :3080 + dsh.log 崩溃关键字检查，失败即停给指引。

v0.1.4 包：本机 `.temp/dsh-router-install-v0.1.4.tar.gz`（107M，sha256 `0f7256af4d21f5ed07fcbd2dae66facd429f1f944b3ecbe5be6f81b1809becc4`）。
已运行的 v0.1.3（用户手工修复版）**无需处理**；如要重装，用 v0.1.4 走 §〇~§三，自动启动保障验收项不变。
