#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lancez ce script avec: sudo ./deploy/update.sh" >&2
  exit 1
fi

install_dir="/opt/zabbix-noc-dashboard"
service_user="nocdashboard"
expected_remote="https://github.com/yassirkadouari/zabbix-noc-dashboard-.git"
source_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
source_owner="${SUDO_USER:-root}"

migrate_known_environment_defaults() {
  local env_file="$install_dir/.env"
  local migrated_api=false

  if grep -Eq '^ZABBIX_API_URL=https?://172\.16\.132\.86/api_jsonrpc\.php$' "$env_file"; then
    sed -i 's|^ZABBIX_API_URL=https\?://172\.16\.132\.86/api_jsonrpc\.php$|ZABBIX_API_URL=http://172.16.132.86:8080/api_jsonrpc.php|' "$env_file"
    migrated_api=true
  fi

  if [ "$migrated_api" = true ]; then
    sed -i 's/^ZABBIX_ALLOW_INSECURE_HTTP=false$/ZABBIX_ALLOW_INSECURE_HTTP=true/' "$env_file"
    echo "Ancienne adresse de supervision corrigee avec le port 8080."
  fi

  if grep -q '^PORT=3000$' "$env_file"; then
    sed -i 's/^PORT=3000$/PORT=3100/' "$env_file"
    echo "Ancien port du dashboard migre de 3000 vers 3100."
  fi
}

install_dependencies() {
  if npm ci --omit=dev --prefer-offline --prefix "$install_dir"; then
    return
  fi

  echo "Le registre npm est indisponible. Verification des dependances deja presentes dans le clone..." >&2
  if [ ! -d "$source_dir/node_modules" ] || ! sudo -u "$source_owner" npm ls --omit=dev --prefix "$source_dir" >/dev/null 2>&1; then
    echo "Aucune copie locale complete de node_modules n'est disponible. Relancez la mise a jour quand npmjs.org repondra." >&2
    exit 1
  fi

  rm -rf -- "$install_dir/node_modules"
  tar -C "$source_dir" -cf - node_modules | tar -C "$install_dir" -xf -
  echo "Dependances restaurees depuis le clone local verifie."
}

verify_backend() {
  if [ ! -r "$install_dir/lib/web-monitoring.js" ]; then
    echo "Module backend manquant: $install_dir/lib/web-monitoring.js" >&2
    return 1
  fi

  if ! sudo -u "$service_user" node --check "$install_dir/server.js"; then
    echo "Le controle de syntaxe du backend a echoue." >&2
    return 1
  fi

  systemctl restart noc-zabbix
  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if systemctl is-active --quiet noc-zabbix \
      && curl --fail --silent --max-time 2 http://127.0.0.1:3100/api/health >/dev/null; then
      echo "Backend local verifie: http://127.0.0.1:3100/api/health"
      break
    fi
    sleep 1
  done

  if ! systemctl is-active --quiet noc-zabbix \
    || ! curl --fail --silent --max-time 2 http://127.0.0.1:3100/api/health >/dev/null; then
    echo "Le backend n'a pas repondu apres le redemarrage." >&2
    systemctl status noc-zabbix --no-pager --full >&2 || true
    journalctl -u noc-zabbix -n 40 --no-pager >&2 || true
    return 1
  fi

  if curl --fail --silent --max-time 40 http://127.0.0.1:3100/api/status >/dev/null \
    && systemctl is-active --quiet noc-zabbix; then
    echo "Source de supervision verifiee via /api/status"
    return 0
  fi

  echo "Le backend fonctionne, mais la source de supervision reste inaccessible." >&2
  systemctl status noc-zabbix --no-pager --full >&2 || true
  journalctl -u noc-zabbix -n 40 --no-pager >&2 || true
  return 1
}

for command in curl git ip node npm systemctl tar; do
  command -v "$command" >/dev/null 2>&1 || { echo "Commande manquante: $command" >&2; exit 1; }
done

if ! id "$service_user" >/dev/null 2>&1 || [ ! -d "$install_dir" ]; then
  echo "Installation introuvable: lancez d'abord sudo ./deploy/install.sh" >&2
  exit 1
fi

if ! sudo -u "$source_owner" git -C "$source_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Le script doit etre lance depuis le clone Git du dashboard." >&2
  exit 1
fi

current_remote="$(sudo -u "$source_owner" git -C "$source_dir" remote get-url origin)"
if [ "$current_remote" != "$expected_remote" ]; then
  echo "Le clone source ne pointe pas vers le depot attendu." >&2
  echo "Adresse actuelle: $current_remote" >&2
  echo "Adresse attendue: $expected_remote" >&2
  echo "Verifiez le depot avant de modifier son remote." >&2
  exit 1
fi

if ! sudo -u "$source_owner" git -C "$source_dir" diff --quiet -- || ! sudo -u "$source_owner" git -C "$source_dir" diff --cached --quiet --; then
  echo "Le clone contient des modifications locales. Committez-les ou utilisez git stash avant la mise a jour." >&2
  exit 1
fi

sudo -u "$source_owner" git -C "$source_dir" pull --ff-only
sudo -u "$source_owner" git -C "$source_dir" archive --format=tar HEAD | tar -C "$install_dir" -xf -
migrate_known_environment_defaults
chmod 0600 "$install_dir/.env"
install_dependencies
chown -R "$service_user:$service_user" "$install_dir"
install -m 0644 "$install_dir/deploy/noc-zabbix.service" /etc/systemd/system/noc-zabbix.service
bash "$install_dir/deploy/configure-network-allowlist.sh"
systemctl daemon-reload
systemctl enable noc-zabbix
verify_backend

echo "Mise a jour terminee depuis $source_dir. Les fichiers .env et dashboard.local.json ont ete conserves."
