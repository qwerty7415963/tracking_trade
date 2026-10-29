#!/usr/bin/env bash
# Nightly backup: pg_dump + artifacts + env/compose -> restic repo (7-day retention).
# Installed to /opt/tracking_trade/deploy/backup.sh, run by cron at 03:00.
# Logs: /var/log/tracking-backup.log. Failure -> Telegram alert to operator.
set -u

APP_DIR="/opt/tracking_trade"
BACKUP_DIR="/var/backups"
REPO="${BACKUP_DIR}/restic-repo"
export RESTIC_PASSWORD_FILE="/root/.restic-pass"
LOG() { echo "[$(date -u +%FT%TZ)] $*"; }

fail_alert() {
  LOG "BACKUP FAILED: $*"
  if [ -f "${APP_DIR}/.env" ]; then
    # shellcheck disable=SC1091
    set -a; . "${APP_DIR}/.env"; set +a
  fi
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${ALERT_CHAT_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${ALERT_CHAT_ID}" \
      --data-urlencode "text=BACKUP FAILED on $(hostname): $*" >/dev/null || true
  fi
  exit 1
}

LOG "backup start"
cd "${APP_DIR}" || fail_alert "cannot cd ${APP_DIR}"

docker compose -f deploy/docker-compose.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-tracking}" "${POSTGRES_DB:-tracking}" > "${BACKUP_DIR}/dbdump.sql" \
  || fail_alert "pg_dump failed"

ARTIFACTS_DIR="${APP_DIR}/artifacts"
if [ ! -d "${ARTIFACTS_DIR}" ]; then fail_alert "artifacts directory not found"; fi

restic -r "${REPO}" backup \
  "${BACKUP_DIR}/dbdump.sql" "${ARTIFACTS_DIR}" \
  "${APP_DIR}/.env" "${APP_DIR}/deploy/docker-compose.yml" \
  --tag daily || fail_alert "restic backup failed"

restic -r "${REPO}" forget --keep-daily 7 --prune || fail_alert "restic forget failed"
restic -r "${REPO}" check || fail_alert "restic check failed"

LOG "backup ok"
