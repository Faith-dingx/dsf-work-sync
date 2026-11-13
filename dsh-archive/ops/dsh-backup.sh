#!/bin/sh
# dsh-backup.sh — DSH 稳定态全量备份（2026-08-29）
# 恢复方法：tar xzf dsh-stable-*.tar.gz -C /tmp/rst，按 manifest 目录映射归位；
#   crontab 用 system/crontab.txt 人工比对后导入；git 仓用 app-repo.bundle clone。
# 说明：脚本内 rm 仅作用于备份暂存目录副本，绝不触碰原文件。

TS=$(date +%Y%m%d-%H%M%S)
BK=/mnt/agent/backup
ST=$BK/stage-$TS

# 防并发：锁目录法（busybox ash 兼容）
LOCK=/mnt/agent/work/tmp/dsh-backup.lock
mkdir "$LOCK" 2>/dev/null || { echo "[dsh-backup] 已有备份在跑，退出"; exit 4; }
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM

mkdir -p "$ST/home" "$ST/system" "$ST/work" "$ST/dsf/reports" "$ST/dsf/docs" "$ST/config-ui" "$ST/rootdsh" || exit 2

git --git-dir=/mnt/agent/dsh/app/.git bundle create "$ST/app-repo.bundle" --all >/dev/null 2>&1 \
  || echo "[dsh-backup] 警告: git bundle 失败，本次包无代码仓"

# 1) DSH_HOME（记忆/会话/预设/profiles/设置）
cp -a /srv/dsh/home/. "$ST/home/" 2>/dev/null

# 2) 系统文件：crontab / rc.local / init.d
crontab -l > "$ST/system/crontab.txt" 2>/dev/null
cp -a /etc/rc.local "$ST/system/" 2>/dev/null
cp -a /etc/init.d/dsh /etc/init.d/config-ui /etc/init.d/model-router-v2 /etc/init.d/power-monitor /etc/init.d/voice-gateway "$ST/system/" 2>/dev/null

# 3) 守护与触发脚本
cp -a /mnt/agent/work/bin/. "$ST/work/" 2>/dev/null

# 4) DSF-work 文档与报告
cp -a /mnt/agent/DSF-work/docs/. "$ST/dsf/docs/" 2>/dev/null
cp -a /mnt/agent/DSF-work/.temp/reports/. "$ST/dsf/reports/" 2>/dev/null

# 5) config-ui 运行时
cp -a /srv/dsh/config-ui/. "$ST/config-ui/" 2>/dev/null

# 6) /root/.dsh 与 /mnt/agent/work/projects
cp -a /root/.dsh/. "$ST/rootdsh/" 2>/dev/null
mkdir -p "$ST/projects"; cp -a /mnt/agent/work/projects/. "$ST/projects/" 2>/dev/null

# 6b) dsh 档案区（本机重编原生模块恢复点, 2026-09-24 新增）
#     /srv/dsh/档案 = musl 版 node-pty(pty.node+spawn-helper), 安装包只带 glibc 版,
#     拔盘/重装后无此件则 bash 工具段错误复发。归口 dsh 自己目录(自包含铁律), 非平台区。
mkdir -p "$ST/dsh-archive"; cp -a /srv/dsh/档案/. "$ST/dsh-archive/" 2>/dev/null

# 7) manifest：内容映射（恢复时按此归位）
cat > "$ST/manifest.txt" <<EOF
# dsh-stable-$TS 备份内容与恢复映射（生成于 $(date '+%F %T')）
home/          <- /srv/dsh/home (DSH_HOME: memory/sessions/profiles/settings; 整目录归位)
system/        <- crontab.txt(导入前人工比对) + /etc/rc.local + /etc/init.d/{dsh,config-ui,model-router-v2,power-monitor,voice-gateway}
work/          <- /mnt/agent/work/bin (守护/自检/触发脚本)
dsf/docs/      <- /mnt/agent/DSF-work/docs
dsf/reports/   <- /mnt/agent/DSF-work/.temp/reports
config-ui/     <- /srv/dsh/config-ui
rootdsh/       <- /root/.dsh
projects/      <- /mnt/agent/work/projects (项目档案/方案目录)
dsh-archive/   <- /srv/dsh/档案 (dsh 本机重编原生模块恢复点: node-pty musl 版 pty.node/spawn-helper)
app-repo.bundle<- /mnt/agent/dsh/app/.git 全量 bundle; 恢复: git clone app-repo.bundle <目标目录>
# 注: 本包不含 /srv/dsh/app 运行时代码树(源码由 bundle 重建)
EOF

# 8) 打包
tar czf "$BK/dsh-stable-$TS.tar.gz" -C "$ST" . || { echo "[dsh-backup] tar 失败"; rm -rf "$ST"; exit 3; }
chmod 600 "$BK/dsh-stable-$TS.tar.gz" 2>/dev/null

# 9) 清理暂存副本（仅副本，绝不触碰原文件）
rm -rf "$ST"

# 10) 只保留最近 5 份备份包
ls -1t "$BK"/dsh-stable-*.tar.gz 2>/dev/null | tail -n +6 | while read -r old; do
  rm -f "$old"
done

echo "[dsh-backup] OK: $BK/dsh-stable-$TS.tar.gz ($(du -h "$BK/dsh-stable-$TS.tar.gz" | cut -f1))"
