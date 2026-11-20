#!/usr/bin/env bash
# 检查 HTTPS 证书还剩多久。IP 证书只有约 6 天，续期连续失败两三次就会过期，所以剩余不到 2 天就告警。
# 输出写进 systemd 日志（journalctl -u certbot-renew）和 q-avatar 的日志文件，方便一眼看到。
set -uo pipefail
CERT=/etc/letsencrypt/live/q-avatar/cert.pem
LOG=/opt/q-avatar/logs/image-api.log
WARN_HOURS=48

stamp() { date '+%F %T'; }
note() { echo "$1"; echo "$(stamp) [cert] $1" >> "$LOG" 2>/dev/null || true; }

if [ ! -f "$CERT" ]; then note "告警：找不到 HTTPS 证书 $CERT"; exit 0; fi
end=$(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2)
left=$(( ($(date -d "$end" +%s) - $(date +%s)) / 3600 ))
if [ "$left" -lt "$WARN_HOURS" ]; then
  note "告警：HTTPS 证书只剩 ${left} 小时（到期 $end），自动续期可能失败了。查看：sudo journalctl -u certbot-renew -n 50"
else
  echo "HTTPS 证书还剩 ${left} 小时（到期 $end）"
fi
