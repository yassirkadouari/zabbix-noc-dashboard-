#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lancez ce script avec: sudo ./deploy/update.sh" >&2
  exit 1
fi

install_dir="/opt/zabbix-noc-dashboard"
service_user="nocdashboard"
expected_remote="https://github.com/yassirkadouari/zabbix-noc-dashboard-.git"

if ! id "$service_user" >/dev/null 2>&1; then
  echo "Compte systeme introuvable: $service_user" >&2
  exit 1
fi

if ! sudo -u "$service_user" git -C "$install_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Installation Git introuvable: $install_dir" >&2
  exit 1
fi

current_remote="$(sudo -u "$service_user" git -C "$install_dir" remote get-url origin)"
if [ "$current_remote" != "$expected_remote" ]; then
  echo "Le depot installe ne pointe pas vers le depot attendu." >&2
  echo "Adresse actuelle: $current_remote" >&2
  echo "Adresse attendue: $expected_remote" >&2
  echo "Verifiez le depot avant de modifier son remote." >&2
  exit 1
fi

sudo -u "$service_user" git -C "$install_dir" pull --ff-only
sudo -u "$service_user" npm ci --omit=dev --prefix "$install_dir"
systemctl daemon-reload
systemctl restart noc-zabbix

echo "Mise a jour terminee. Le fichier .env a ete conserve."
