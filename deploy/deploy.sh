#!/usr/bin/env bash
# 一键部署：测试 → 打包 → 检查服务器上的文件有没有被别人改过 → 上传 → 重启 → 检查 → 记录版本。
# 任何一步失败就停下，线上保持原样。
#
# 用法（在项目根目录，Git Bash）：
#   QA_SERVER=ubuntu@<服务器IP> bash deploy/deploy.sh          # 部署当前已提交的版本
#   QA_SERVER=ubuntu@<服务器IP> bash deploy/deploy.sh --force  # 服务器上的文件和上次部署不同时，仍然覆盖
#
# 服务器地址可以写在项目根目录的 deploy.local（已被 git 忽略）：QA_SERVER=ubuntu@1.2.3.4
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f deploy.local ] && . ./deploy.local
SERVER="${QA_SERVER:?请设置 QA_SERVER，例如 QA_SERVER=ubuntu@1.2.3.4，或写进 deploy.local}"
APP=/opt/q-avatar
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1
# 后端运行需要的文件；网页另外打包 dist/
FILES=(server shared package.json package-lock.json)

step() { printf '\n== %s\n' "$1"; }
fail() { printf '\n✗ %s\n' "$1" >&2; exit 1; }
ssh_() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" "$@"; }

step "1/6 检查本地"
[ -z "$(git status --porcelain -- "${FILES[@]}" src index.html public vite.config.ts)" ] \
  || fail "有还没提交的改动。先提交，再部署：线上必须对应一个确定的 git 版本。"
COMMIT=$(git rev-parse --short HEAD)
VERSION=$(git describe --tags --always --dirty)
echo "准备部署：$VERSION（$COMMIT）→ $SERVER"

step "2/6 测试和打包"
npm run test:server >/tmp/qa-test.log 2>&1 || { tail -30 /tmp/qa-test.log; fail "测试没通过"; }
grep -E '^ℹ (pass|fail)' /tmp/qa-test.log
npm run build >/tmp/qa-build.log 2>&1 || { tail -30 /tmp/qa-build.log; fail "打包失败"; }
echo "打包完成"

step "3/6 检查服务器上的文件"
# 和上次部署的版本逐个比对：有人直接在服务器上改过代码，就先停下，避免把那份改动覆盖掉。
LAST=$(ssh_ "cat $APP/DEPLOYED 2>/dev/null | sed -n 's/^commit=//p'" || true)
if [ -z "$LAST" ]; then
  echo "服务器上没有部署记录（第一次用这个脚本），跳过比对"
elif ! git cat-file -e "$LAST^{commit}" 2>/dev/null; then
  fail "服务器记录的上次部署版本 $LAST 在本地找不到。先 git fetch，或确认是不是从别的电脑部署过。"
else
  # 一次 ssh 取回服务器上所有文件的指纹，在本地逐个比对。
  # （不要在 while read 循环里调 ssh：ssh 会读走循环剩下的输入，只比对第一个文件。）
  mapfile -t files < <(git ls-tree -r --name-only "$LAST" -- "${FILES[@]}")
  mapfile -t remote < <(ssh_ "cd $APP && for f in ${files[*]}; do if [ -f \"\$f\" ]; then tr -d '\r' < \"\$f\" | sha256sum | cut -c1-64; else echo missing; fi; done" </dev/null)
  [ ${#remote[@]} -eq ${#files[@]} ] || fail "取服务器文件指纹失败（期望 ${#files[@]} 个，拿到 ${#remote[@]} 个）"
  changed=()
  for i in "${!files[@]}"; do
    want=$(git show "$LAST:${files[$i]}" | tr -d '\r' | sha256sum | cut -c1-64)
    [ "$want" = "${remote[$i]}" ] || changed+=("${files[$i]}")
  done
  echo "比对了 ${#files[@]} 个文件"
  if [ ${#changed[@]} -gt 0 ]; then
    printf '服务器上这些文件和上次部署的 %s 不一样：\n' "$LAST"; printf '  %s\n' "${changed[@]}"
    [ $FORCE = 1 ] || fail "有人直接改过服务器上的代码。先把改动拿回本地合并；确认可以覆盖时加 --force。"
    echo "已加 --force，继续覆盖"
  else
    echo "和上次部署的 $LAST 一致"
  fi
fi

step "4/6 上传"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -c core.autocrlf=false archive --format=tar.gz -o "$tmp/src.tar.gz" HEAD -- "${FILES[@]}"  # 保持仓库里的 LF 换行
tar -czf "$tmp/dist.tar.gz" dist
scp -q -o BatchMode=yes "$tmp/src.tar.gz" "$tmp/dist.tar.gz" "$SERVER:/tmp/"
echo "已上传"

step "5/6 替换并重启"
# 先装依赖再替换网页，整个过程中旧版本一直在运行；网页目录整体换掉，不会出现新旧文件混在一起。
ssh_ "set -e
sudo tar --no-same-owner -xzf /tmp/src.tar.gz -C $APP
cd $APP && sudo npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com >/dev/null 2>&1
sudo rm -rf $APP/dist.new && sudo mkdir $APP/dist.new
sudo tar --no-same-owner -xzf /tmp/dist.tar.gz -C $APP/dist.new --strip-components=1
sudo rm -rf $APP/dist.old && sudo mv $APP/dist $APP/dist.old && sudo mv $APP/dist.new $APP/dist && sudo rm -rf $APP/dist.old
rm -f /tmp/src.tar.gz /tmp/dist.tar.gz
sudo systemctl restart q-avatar"
echo "已重启"

step "6/6 检查"
sleep 3
ssh_ "systemctl is-active --quiet q-avatar" || { ssh_ "sudo journalctl -u q-avatar -n 20 --no-pager -o cat"; fail "服务没有起来，看上面的日志"; }
config=$(ssh_ "curl -s -m 10 http://127.0.0.1/api/config")
echo "接口：$config"
case "$config" in *'"enabled"'*) ;; *) fail "/api/config 没有正常返回";; esac
ssh_ "printf 'version=%s\ncommit=%s\ndeployed_at=%s\n' '$VERSION' '$COMMIT' \"\$(date '+%F %T')\" | sudo tee $APP/DEPLOYED >/dev/null"
printf '\n✓ 已上线 %s（%s）\n' "$VERSION" "$COMMIT"
