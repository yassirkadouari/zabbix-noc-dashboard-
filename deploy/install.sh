#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Lancez ce script avec: sudo ./deploy/install.sh" >&2
  exit 1
fi

source_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
install_dir="/opt/zabbix-noc-dashboard"
service_user="nocdashboard"

for command in node npm systemctl tar; do
  command -v "$command" >/dev/null 2>&1 || { echo "Commande manquante: $command" >&2; exit 1; }
done

if [ -e "$install_dir" ] && [ "$(find "$install_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  echo "Installation existante: $install_dir" >&2
  echo "Pour une mise a jour sans ecraser .env, lancez: sudo ./deploy/update.sh" >&2
  exit 1
fi

if ! id "$service_user" >/dev/null 2>&1; then
  useradd --system --home-dir "$install_dir" --shell /usr/sbin/nologin "$service_user"
fi

install -d -o "$service_user" -g "$service_user" -m 0750 "$install_dir"
tar --exclude='.env' --exclude='node_modules' --exclude='.git' -C "$source_dir" -cf - . | tar -C "$install_dir" -xf -
cp "$install_dir/.env.example" "$install_dir/.env"
chmod 0600 "$install_dir/.env"
chown -R "$service_user:$service_user" "$install_dir"

npm ci --omit=dev --prefix "$install_dir"
install -m 0644 "$install_dir/deploy/noc-zabbix.service" /etc/systemd/system/noc-zabbix.service
systemctl daemon-reload
systemctl enable noc-zabbix

echo
echo "Installation terminee. Configurez le secret avec:"
echo "  sudoedit $install_dir/.env"
echo "Puis demarrez le dashboard avec:"
echo "  sudo systemctl start noc-zabbix"
