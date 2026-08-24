# Tableau de bord ICMP Zabbix

Ecran de supervision sans interaction: il liste les hôtes ayant un trigger actif sur un item `icmpping`, par défaut dans les groupes Zabbix `Switches` et `AP`.

## Installation

```bash
npm install
cp .env.example .env
```

Renseignez `.env` avec l'URL JSON-RPC exacte de Zabbix et un jeton API en lecture seule. Utilisez HTTPS, avec un certificat valide, pour proteger le jeton et les donnees de supervision :

```dotenv
ZABBIX_API_URL=https://172.16.132.86/api_jsonrpc.php
```

Puis lancez l'ecran:

```bash
npm start
```

Ouvrez `http://localhost:3100` dans le navigateur du poste d'affichage et utilisez le mode plein ecran du navigateur. L'affichage consulte Zabbix toutes les 45 secondes et change de page toutes les 12 secondes lorsqu'il y a plus de huit pannes.

## Securite

Utilisez un jeton API associe a un compte de lecture seule, qui peut voir les groupes et les triggers concernes. Le jeton reste uniquement dans `.env` sur la machine qui execute le serveur; il n'est jamais transmis au navigateur.

Le serveur ecoute exclusivement sur `127.0.0.1`: aucun poste du reseau ne peut ouvrir le dashboard ou appeler son API. Le navigateur NOC et le serveur communiquent localement; seul le serveur contacte Zabbix. Les erreurs detaillees restent dans le journal systemd, pas dans l'ecran.

Avant l'installation, restreignez les droits du secret :

```bash
chmod 600 .env
```

L'usage de HTTP est bloque par defaut. Si une migration HTTPS est vraiment impossible, activez explicitement `ZABBIX_ALLOW_INSECURE_HTTP=true`; ce choix expose le trafic et doit rester exceptionnel.

Le filtre de groupes est configurable avec `ZABBIX_HOST_GROUPS`. Laissez cette valeur vide pour voir tous les hôtes Zabbix ayant une panne ICMP.

## Personnalisation de l'ecran

Modifiez `dashboard.config.json`, puis redemarrez le service. Les blocs de l'en-tete peuvent etre places dans l'ordre `brand`, `summary`, `connection`; ceux du pied de page acceptent `scope`, `updatedAt`, `clock`. Les exemples de disposition sont dans `dashboard.config.example.json`.

## Poste NOC sans clavier ni souris

Le dossier `deploy/` contient un service systemd pour lancer l'application au demarrage et un script pour ouvrir Chromium en mode kiosque. Le service est volontairement execute par le compte local dedie `nocdashboard`, depuis `/opt/zabbix-noc-dashboard`.

Sur le PC du travail, clonez le depot puis installez-le ainsi :

```bash
sudo useradd --system --home-dir /opt/zabbix-noc-dashboard --shell /usr/sbin/nologin nocdashboard
sudo git clone https://github.com/VOTRE_COMPTE/zabbix-noc-dashboard.git /opt/zabbix-noc-dashboard
sudo cp /opt/zabbix-noc-dashboard/.env.example /opt/zabbix-noc-dashboard/.env
sudo chown -R nocdashboard:nocdashboard /opt/zabbix-noc-dashboard
sudo chmod 600 /opt/zabbix-noc-dashboard/.env
sudo cp /opt/zabbix-noc-dashboard/deploy/noc-zabbix.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now noc-zabbix
```

Renseignez ensuite le jeton dans `/opt/zabbix-noc-dashboard/.env` et relancez `sudo systemctl restart noc-zabbix`.

Ajoutez ensuite `deploy/noc-kiosk.sh` aux applications lancees a l'ouverture de session graphique du poste NOC. Le navigateur s'ouvre directement sur le tableau de bord, sans barre d'adresse ni controles.
