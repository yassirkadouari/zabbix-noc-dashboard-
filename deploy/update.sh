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

for command in git node npm systemctl tar; do
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
tar --exclude='.env' --exclude='node_modules' --exclude='.git' --exclude='image.png' -C "$source_dir" -cf - . | tar -C "$install_dir" -xf -
chown -R "$service_user:$service_user" "$install_dir"
chmod 0600 "$install_dir/.env"
npm ci --omit=dev --prefix "$install_dir"
install -m 0644 "$install_dir/deploy/noc-zabbix.service" /etc/systemd/system/noc-zabbix.service
systemctl daemon-reload
systemctl restart noc-zabbix

echo "Mise a jour terminee depuis $source_dir. Les fichiers .env et dashboard.local.json ont ete conserves."
