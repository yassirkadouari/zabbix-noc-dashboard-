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

Lorsque Zabbix Web et le dashboard sont sur le meme PC et que Zabbix est expose par Docker sur le port `8080`, la connexion reste locale au poste. Utilisez alors :

```dotenv
ZABBIX_API_URL=http://127.0.0.1:8080/api_jsonrpc.php
ZABBIX_ALLOW_INSECURE_HTTP=true
```

N'utilisez jamais cette exception avec une adresse IP distante.

Le filtre de groupes est configurable avec `ZABBIX_HOST_GROUPS`. Laissez cette valeur vide pour voir tous les hôtes Zabbix ayant une panne ICMP.

## Simulation sans risque

Pour verifier l'ecran sans creer de panne sur le reseau, definissez temporairement `NOC_TEST_MODE=true` dans `.env`, redemarrez le service, puis ouvrez le dashboard. Une ligne rouge en pointilles avec le badge `TEST` apparait. Cette simulation confirme l'affichage et l'actualisation, mais ne remplace pas un test de trigger Zabbix. Remettez immediatement `NOC_TEST_MODE=false` apres le test.

## Personnalisation de l'ecran

Modifiez `dashboard.config.json`, puis redemarrez le service. Les blocs de l'en-tete peuvent etre places dans l'ordre `brand`, `summary`, `connection`; ceux du pied de page acceptent `scope`, `updatedAt`, `clock`. Les exemples de disposition sont dans `dashboard.config.example.json`.

## Poste NOC sans clavier ni souris

Le dossier `deploy/` contient un service systemd pour lancer l'application au demarrage et un script pour ouvrir Chromium en mode kiosque. Le service est volontairement execute par le compte local dedie `nocdashboard`, depuis `/opt/zabbix-noc-dashboard`.

Sur le PC du travail, clonez le depot puis lancez l'installateur :

```bash
git clone https://github.com/yassirkadouari/zabbix-noc-dashboard-.git
cd zabbix-noc-dashboard
sudo ./deploy/install.sh
```

Renseignez ensuite le jeton dans `/opt/zabbix-noc-dashboard/.env`, puis lancez `sudo systemctl start noc-zabbix`.

Pour une mise a jour ulterieure, depuis un clone a jour du depot, lancez :

```bash
sudo ./deploy/update.sh
```

Le script conserve `.env`, verifie l'adresse du depot avant le telechargement, met a jour les dependances et redemarre le service.

Ajoutez ensuite `deploy/noc-kiosk.sh` aux applications lancees a l'ouverture de session graphique du poste NOC. Le navigateur s'ouvre directement sur le tableau de bord, sans barre d'adresse ni controles.
