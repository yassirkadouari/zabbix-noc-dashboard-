# Documentation complete - Dashboard NOC TC3-TCR

## 1. Objectif

Ce projet affiche sur un ecran NOC sans clavier ni souris :

- les equipements en panne ICMP, regroupes par panneaux ;
- la latence ICMP moyenne de chaque panneau ;
- les scenarios Web Zabbix en permanence, meme lorsqu'ils sont disponibles ;
- le nombre global d'alertes ;
- l'heure du dernier rafraichissement et l'etat de la connexion locale.

Le navigateur ne contacte jamais directement Zabbix. Le serveur Node.js local lit l'API Zabbix avec un compte en lecture seule, puis fournit uniquement les donnees necessaires a l'ecran.

## 2. Architecture

```text
Ecran kiosque
    |
    | HTTP local 127.0.0.1:3100
    v
Dashboard Node.js
    |
    | JSON-RPC avec jeton en lecture seule
    v
Zabbix local 127.0.0.1:8080
```

Fichiers importants :

- `server.js` : connexion API, cache et securite ;
- `public/` : interface du mur NOC ;
- `.env` : secrets et adresses locales, jamais versionnes dans Git ;
- `/var/lib/noc-zabbix-dashboard/dashboard.local.json` : configuration enregistree depuis l'interface ;
- `deploy/` : installation, mise a jour, service systemd et mode kiosque.

Le port unique du projet est `3100`. Le serveur utilise aussi `3100` par defaut si la variable `PORT` est absente.

## 3. Prerequis

- Ubuntu ou distribution Linux avec systemd ;
- Node.js 20 ou plus recent ;
- npm et Git ;
- acces local a Zabbix ;
- un jeton API Zabbix en lecture seule ;
- Chromium, Google Chrome ou Firefox pour le mode kiosque.

Verification :

```bash
node --version
npm --version
git --version
curl -I http://127.0.0.1:8080/
```

## 4. Configuration Zabbix

### 4.1 Compte API

Creez un utilisateur Zabbix dedie au dashboard. Il doit uniquement pouvoir lire :

- les host groups affiches ;
- les hosts de ces groupes ;
- les items et triggers ICMP ;
- les scenarios Web et leurs items ;
- les dernieres valeurs collectees.

N'utilisez pas un compte administrateur dans `.env`. Creez ensuite un jeton API pour cet utilisateur.

### 4.2 ICMP

Chaque switch ou AP doit posseder au minimum :

- l'item `icmpping` ;
- l'item `icmppingsec` pour la latence ;
- un trigger actif base sur `icmpping`.

Configuration conseillee pour les equipements critiques :

```text
Intervalle ICMP : 10s
Declenchement : 2 echecs consecutifs
Expression type : max(/HOST/icmpping,#2)=0
```

Un seul echec est plus rapide, mais provoque davantage de fausses alertes.

### 4.3 Scenario Web NAVIS

Dans Zabbix :

1. Ouvrez `Data collection` puis `Hosts`.
2. Ouvrez le host `navis.marsamaroc.co.ma`.
3. Ouvrez `Web`.
4. Verifiez que le scenario `navis.marsamaroc.co.ma` est `Enabled`.
5. Verifiez que son etape attend le code HTTP `200`.
6. Utilisez un intervalle de `10s`, `15s` ou `1m` selon la charge acceptee.

Zabbix cree automatiquement :

```text
web.test.fail[navis.marsamaroc.co.ma]
web.test.rspcode[navis.marsamaroc.co.ma,last access]
web.test.time[navis.marsamaroc.co.ma,last access,resp]
```

Le dashboard utilise le scenario lui-meme comme source de detection, puis lit `web.test.fail` pour l'etat et `web.test.rspcode` pour le code HTTP.

### 4.4 Placement de NAVIS dans le dashboard

Le host NAVIS doit appartenir a un host group visible par le jeton API. Dans `settings.html`, le panneau nomme `NAVIS` doit contenir ce host group.

Le nom du panneau n'est pas suffisant : c'est la case du host group qui relie le host au panneau.

## 5. Installation initiale

Clonez le depot avec le compte du technicien :

```bash
git clone https://github.com/yassirkadouari/zabbix-noc-dashboard-.git
cd zabbix-noc-dashboard-
npm ci
```

Lancez l'installation systeme :

```bash
sudo ./deploy/install.sh
```

Configurez ensuite :

```bash
sudoedit /opt/zabbix-noc-dashboard/.env
```

Exemple pour Zabbix Docker local :

```dotenv
ZABBIX_API_URL=http://127.0.0.1:8080/api_jsonrpc.php
ZABBIX_ALLOW_INSECURE_HTTP=true
ZABBIX_API_TOKEN=REMPLACER_PAR_LE_JETON_LECTURE_SEULE
ZABBIX_HOST_GROUPS=SWITCHE,DTC,SW-DTV,SW-TOUR,AP-DTV,AP-TC3,NAVIS
POLL_INTERVAL_SECONDS=5
WEB_STATUS_STALE_SECONDS=180
NOC_TEST_MODE=false
NOC_ADMIN_TOKEN=REMPLACER_PAR_UN_SECRET_LONG_ET_ALEATOIRE
PORT=3100
HOST=127.0.0.1
```

Protegez le fichier et demarrez :

```bash
sudo chmod 600 /opt/zabbix-noc-dashboard/.env
sudo systemctl enable --now noc-zabbix
```

Verification :

```bash
systemctl status noc-zabbix --no-pager
curl -s http://127.0.0.1:3100/api/status
```

## 6. Configuration depuis l'interface

Ouvrez :

```text
http://127.0.0.1:3100/settings.html
```

Le bouton `Configuration` de la barre superieure ouvre directement cette page.
Le lien `Retour au NOC` permet ensuite de revenir au tableau de bord principal.

Entrez `NOC_ADMIN_TOKEN`, puis configurez :

- le titre et le sous-titre ;
- deux, trois ou quatre cartes par ligne ;
- l'ordre des panneaux ;
- le nom de chaque panneau ;
- les host groups contenus dans chaque panneau.

Un host present dans plusieurs groupes est affiche dans le premier panneau correspondant. La configuration est stockee hors du depot Git et survit aux mises a jour.

## 7. Fonctionnement de l'affichage

### Etat ICMP

- Vert : aucune panne ICMP active dans le panneau.
- Rouge : au moins un trigger ICMP actif.
- Les pannes sont dedupliquees par host.
- Trois pannes sont affichees par page, ou deux si un service Web permanent occupe le panneau.
- Les pages de pannes tournent toutes les six secondes.

### Etat Web

- `EN LIGNE` : `web.test.fail=0` avec une valeur recente.
- `HORS LIGNE` : `web.test.fail>0` avec une valeur recente.
- `ETAT INCONNU` : valeur absente, item non supporte ou controle trop ancien.

La carte precise maintenant la cause lorsqu'elle est connue : `ITEMS ABSENTS`,
`DONNEES ANCIENNES`, `ITEM INACTIF` ou `VALEUR INVALIDE`. L'API expose aussi
`statusReason`, `evidence`, `matchedItems`, `matches` et `dataAgeSeconds` pour
permettre un diagnostic sans afficher le jeton Zabbix.

`WEB_STATUS_STALE_SECONDS=180` interdit d'afficher une ancienne valeur verte pendant plus de trois minutes.

## 8. Diagnostic NAVIS

Installez `jq` si necessaire :

```bash
sudo apt install jq
```

Affichez uniquement le diagnostic Web :

```bash
curl -s http://127.0.0.1:3100/api/status | jq '{ok, diagnostics, services: [.groups[].services[]?]}'
```

Tapez l'URL telle quelle dans le terminal. N'ajoutez pas les caracteres Markdown `[`, `]`, `(` ou `)` autour de l'adresse.

Resultat normal :

```json
{
  "diagnostics": {
    "monitoredWebServices": 1,
    "resolvedWebServices": 1,
    "webMonitoringItems": 2,
    "webMonitoringAvailable": true
  },
  "services": [
    {
      "name": "navis.marsamaroc.co.ma",
      "status": "up",
      "statusReason": "scenario-succeeded",
      "evidence": "web.test.fail",
      "responseCode": 200,
      "matchedItems": 2,
      "interval": "1m"
    }
  ]
}
```

Interpretation :

- `webMonitoringAvailable=false` : appel API refuse ou en erreur ; consultez le journal.
- `monitoredWebServices=0` : aucun scenario active n'est visible dans les groupes selectionnes.
- `monitoredWebServices=1` et `resolvedWebServices=0` : scenario trouve, mais valeur absente, ancienne ou non supportee.
- `webMonitoringItems=0` : le jeton ne voit pas les items ou Zabbix ne les a pas encore crees.
- `status=unknown` : ouvrez `Monitoring` puis `Latest data` pour verifier les items du scenario.
- `statusReason=items-not-found` : les cles `web.test.*` ne sont pas visibles par le jeton.
- `statusReason=failure-item-stale` : le dernier controle depasse `WEB_STATUS_STALE_SECONDS`.
- `statusReason=failure-item-unsupported` : l'item automatique est non supporte ou desactive.
- `matches.failure=single-scenario` : le backend a utilise le repli sur l'unique scenario du host, notamment lorsque sa cle contient une macro.

L'API Zabbix exclut les items de scenarios Web d'un appel `item.get` standard.
Le backend transmet donc explicitement `webitems: true`, puis limite localement
le resultat aux cles `web.test.*`. Sans ce drapeau, le scenario reste visible
avec `httptest.get`, mais `webMonitoringItems` vaut zero et la carte affiche
`ITEMS ABSENTS` alors que les valeurs existent dans `Latest data`.

Journal du serveur :

```bash
sudo journalctl -u noc-zabbix -n 100 --no-pager
```

Apres une mise a jour contenant la correction NAVIS :

```bash
cd ~/Desktop/testingnoc/zabbix-noc-dashboard-
git pull --ff-only origin main
npm ci
npm test
sudo ./deploy/update.sh
curl -sS --max-time 20 http://127.0.0.1:3100/api/status | \
  jq '{diagnostics, services: [.groups[].services[]?]}'
```

Avec les valeurs visibles dans `Latest data` (`web.test.fail=0`, code HTTP `200`
et controle de moins de 180 secondes), le resultat attendu est `status: "up"` et
`statusReason: "scenario-succeeded"`.

## 9. Mise a jour

Travaillez toujours depuis le clone du technicien, jamais directement dans `/opt` :

```bash
cd /chemin/vers/zabbix-noc-dashboard-
git status
git pull --ff-only origin main
sudo ./deploy/update.sh
```

Le script :

- utilise les droits Git du technicien pour le depot prive ;
- refuse une copie contenant des modifications suivies non enregistrees ;
- synchronise le code vers `/opt/zabbix-noc-dashboard` ;
- conserve `.env` ;
- conserve `dashboard.local.json` ;
- reinstalle les dependances et redemarre le service.

Si `registry.npmjs.org` retourne temporairement `503 Service Unavailable`, les scripts verifient `node_modules` dans le clone avec `npm ls`, puis reutilisent cette copie locale complete. Le dashboard peut ainsi etre reinstalle sans attendre le retour du registre npm lorsque les dependances sont deja presentes et valides dans le clone.

### Conflit `public/index.html needs merge`

Commencez toujours par :

```bash
git status
```

Si les modifications locales du titre ne sont plus necessaires, car le titre est maintenant configurable depuis l'interface, sauvegardez puis restaurez le fichier du commit courant :

```bash
cp public/index.html /tmp/index.html.conflit.bak
git restore --source=HEAD --staged --worktree public/index.html
git status
```

Si Git indique encore `merge in progress` :

```bash
git merge --abort
```

Si Git indique `rebase in progress` :

```bash
git rebase --abort
```

Relancez ensuite :

```bash
git pull --ff-only origin main
sudo ./deploy/update.sh
```

Ne supprimez jamais `.git`, `.env` ou `/var/lib/noc-zabbix-dashboard` pour resoudre un conflit.

## 10. Tests sans risque

### Simulation d'affichage ICMP

Dans `/opt/zabbix-noc-dashboard/.env` :

```dotenv
NOC_TEST_MODE=true
```

Puis :

```bash
sudo systemctl restart noc-zabbix
```

Remettez immediatement `false` apres le test.

### Test Web

Ne modifiez pas le scenario NAVIS de production. Creez un host et un scenario Web fictifs dans un groupe `test`, avec une URL de laboratoire. Selectionnez ensuite le groupe `test` dans un panneau temporaire.

## 11. Depannage general

### `fetch failed`

Verifiez l'adresse exacte :

```dotenv
ZABBIX_API_URL=http://172.16.132.86:8080/api_jsonrpc.php
ZABBIX_ALLOW_INSECURE_HTTP=true
ZABBIX_REQUEST_TIMEOUT_MS=5000
```

Puis :

```bash
curl -sS --max-time 10 -H 'Content-Type: application/json-rpc' \
  -d '{"jsonrpc":"2.0","method":"apiinfo.version","params":{},"id":1}' \
  http://172.16.132.86:8080/api_jsonrpc.php
sudo systemctl restart noc-zabbix
sudo journalctl -u noc-zabbix -n 100 --no-pager
```

Le test du dashboard et le test de la source sont distincts :

```bash
curl -sS --max-time 5 http://127.0.0.1:3100/api/health
curl -sS --max-time 15 http://127.0.0.1:3100/api/status | jq
```

N'ecrivez pas les URL sous la forme Markdown `[http://...](http://...)` dans le terminal.

### Le dashboard fonctionne mais NAVIS n'apparait pas

Verifiez dans cet ordre :

1. Le nouveau code est installe avec `git log -1 --oneline` dans le clone.
2. `sudo ./deploy/update.sh` s'est termine sans erreur.
3. Le service a ete redemarre.
4. Le scenario NAVIS est enabled.
5. Le host NAVIS appartient au host group selectionne dans le panneau NAVIS.
6. Le jeton API peut lire le host, le scenario et ses items.
7. `/api/status` contient `monitoredWebServices` et `webMonitoringAvailable`.

### L'etat met trop de temps a changer

Le delai maximal est environ :

```text
intervalle du scenario Zabbix + POLL_INTERVAL_SECONDS
```

Avec un scenario a `1m` et un dashboard a `5s`, il faut parfois attendre environ 65 secondes. Pour une supervision plus rapide, configurez le scenario a `10s` ou `15s` apres avoir verifie la charge.

### Le service ne demarre pas

```bash
sudo systemctl status noc-zabbix --no-pager
sudo journalctl -u noc-zabbix -n 100 --no-pager
sudo -u nocdashboard /usr/bin/node --check /opt/zabbix-noc-dashboard/server.js
```

Depuis la correction NAVIS, le backend utilise aussi le module suivant :

```bash
sudo test -r /opt/zabbix-noc-dashboard/lib/web-monitoring.js && echo "module present"
```

Si Node affiche `ERR_MODULE_NOT_FOUND` pour ce fichier, l'installation a ete
mise a jour partiellement. Ne copiez pas uniquement `server.js`. Relancez la
mise a jour complete depuis le clone Git :

```bash
cd ~/Desktop/testingnoc/zabbix-noc-dashboard-
git pull --ff-only origin main
sudo ./deploy/update.sh
```

Le script controle maintenant le module, la syntaxe Node et `/api/health`. En
cas d'echec, il affiche directement le statut systemd et les 40 dernieres lignes
du journal au lieu d'annoncer une mise a jour reussie.

### Le backend fonctionne avec `npm start`, mais pas avec systemd

Ce comportement indique que l'isolation systemd bloque la source de
supervision. Lorsque le serveur Web de supervision est publie par Docker sur
l'adresse du PC, la traduction du port `8080` peut faire apparaitre l'adresse
interne du conteneur au filtre `IPAddressDeny=any`.

Le deploiement detecte maintenant les routes des interfaces `docker*` et
`br-*`, puis les ajoute dans :

```text
/etc/systemd/system/noc-zabbix.service.d/network-allowlist.conf
```

Le filtrage global reste actif : seuls le loopback, l'adresse de supervision et
les sous-reseaux des bridges de conteneurs locaux sont autorises. La mise a jour
teste ensuite `/api/health` et `/api/status`, afin de distinguer la disponibilite
du processus Node de la disponibilite reelle de la source.

Si `systemctl` repond `Unit noc-zabbix.service could not be found`, l'installation systeme n'est pas terminee. Depuis un clone a jour contenant deja un `node_modules` fonctionnel :

```bash
git pull --ff-only origin main
sudo ./deploy/update.sh
```

Le script recree l'unite systemd, l'active et redemarre le service. Si `/opt/zabbix-noc-dashboard` n'existe plus du tout, utilisez `sudo ./deploy/install.sh` puis renseignez de nouveau `/opt/zabbix-noc-dashboard/.env`.

### Le port est deja utilise

```bash
sudo ss -ltnp | grep ':3100'
```

Changez `PORT` uniquement si un autre service legitime utilise deja ce port.

## 12. Securite

- Le dashboard ecoute uniquement sur `127.0.0.1`.
- Le jeton Zabbix reste dans `.env` et n'est jamais envoye au navigateur.
- Le compte Zabbix doit etre en lecture seule.
- Le service systemd bloque les privileges, les peripheriques et les ecritures hors de son StateDirectory.
- N'exposez pas le port 3100 au reseau.
- N'utilisez HTTP que pour `127.0.0.1` lorsque Zabbix est local dans Docker.
- Ne publiez jamais `.env`, un jeton API ou un mot de passe dans GitHub.
- Sauvegardez regulierement `/opt/zabbix-noc-dashboard/.env` et `/var/lib/noc-zabbix-dashboard/dashboard.local.json` dans un emplacement protege.

## 13. Commandes quotidiennes

```bash
# Etat
sudo systemctl status noc-zabbix --no-pager

# Redemarrage
sudo systemctl restart noc-zabbix

# Derniers journaux
sudo journalctl -u noc-zabbix -n 100 --no-pager

# API locale
curl -s http://127.0.0.1:3100/api/status | jq

# Mise a jour
git pull --ff-only origin main
sudo ./deploy/update.sh
```
