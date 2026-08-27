#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Ce script doit etre execute avec les droits root." >&2
  exit 1
fi

dropin_dir="/etc/systemd/system/noc-zabbix.service.d"
dropin_file="$dropin_dir/network-allowlist.conf"
install_dir="/opt/zabbix-noc-dashboard"

install -d -m 0755 "$dropin_dir"
api_host="$(
  cd "$install_dir"
  node --input-type=module -e \
    'import "dotenv/config"; process.stdout.write(new URL(process.env.ZABBIX_API_URL).hostname);'
)"
mapfile -t api_addresses < <(getent ahosts "$api_host" | awk '{ print $1 }' | sort -u)
if [ "${#api_addresses[@]}" -eq 0 ]; then
  echo "Impossible de resoudre la cible de supervision: $api_host" >&2
  exit 1
fi
mapfile -t bridge_networks < <(
  LC_ALL=C ip -4 route show scope link |
    awk '$2 == "dev" && ($3 ~ /^docker[0-9]*$/ || $3 ~ /^br-[[:xdigit:]]+$/) && $1 ~ /^[0-9.]+\/[0-9]+$/ { print $1 }' |
    sort -u
)

{
  echo "[Service]"
  echo "# Cible de supervision issue de ZABBIX_API_URL."
  for address in "${api_addresses[@]}"; do
    printf 'IPAddressAllow=%s\n' "$address"
  done
  echo "# Sous-reseaux locaux necessaires apres la traduction Docker du port de supervision."
  for network in "${bridge_networks[@]}"; do
    printf 'IPAddressAllow=%s\n' "$network"
  done
} > "$dropin_file"
chmod 0644 "$dropin_file"

echo "Adresses de supervision autorisees pour le backend: ${api_addresses[*]}"

if [ "${#bridge_networks[@]}" -eq 0 ]; then
  echo "Aucun bridge Docker local detecte; aucune autorisation supplementaire ajoutee."
else
  echo "Sous-reseaux Docker autorises pour le backend: ${bridge_networks[*]}"
fi
