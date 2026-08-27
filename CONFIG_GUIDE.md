# Guide administrateur de configuration

Ce document explique comment modifier la configuration du dashboard NOC
installe sur le poste de travail. Il couvre notamment le changement du secret
de la page `Configuration`, la rotation du jeton Zabbix, les groupes, les delais
de rafraichissement et les controles a effectuer apres chaque modification.

## 1. Fichiers utilises en production

Le service systemd ne lit pas le `.env` du clone Git. Il utilise :

```text
/opt/zabbix-noc-dashboard/.env
```

Les panneaux modifies depuis `settings.html` sont enregistres dans :

```text
/var/lib/noc-zabbix-dashboard/dashboard.local.json
```

Le premier fichier contient des secrets. Le second contient uniquement la
disposition visuelle et les host groups selectionnes.

Ne placez jamais `.env` dans Git, dans un ticket, dans une messagerie ou dans
une capture d'ecran.

## 2. Secrets a ne pas confondre

| Variable | Utilisation | Qui la saisit |
| --- | --- | --- |
| `NOC_ADMIN_TOKEN` | Ouvre et enregistre la configuration visuelle | Administrateur dans `settings.html` |
| `ZABBIX_API_TOKEN` | Autorise le backend a lire l'API Zabbix | Backend uniquement |
| `ZABBIX_PASSWORD` | Ancienne methode de connexion, si aucun jeton API n'est utilise | Backend uniquement |

Le secret `NOC_ADMIN_TOKEN` n'est jamais envoye a Zabbix. Le jeton
`ZABBIX_API_TOKEN` ne doit jamais etre saisi dans la page Settings.

## 3. Changer le secret de la page Configuration

### 3.1 Generer un nouveau secret

Generez une valeur aleatoire de 32 octets :

```bash
openssl rand -hex 32
```

La commande produit 64 caracteres. Conservez temporairement cette valeur dans
un gestionnaire de mots de passe approuve par l'entreprise.

### 3.2 Modifier le bon fichier

Ouvrez le fichier de production avec un editeur securise :

```bash
sudoedit /opt/zabbix-noc-dashboard/.env
```

Remplacez uniquement la ligne suivante :

```dotenv
NOC_ADMIN_TOKEN=NOUVEAU_SECRET_DE_64_CARACTERES
```

Regles de syntaxe :

- ne laissez aucun espace autour du signe `=` ;
- conservez une seule ligne `NOC_ADMIN_TOKEN` ;
- n'ajoutez pas le secret dans le fichier `.env.example` ;
- ne modifiez pas `ZABBIX_API_TOKEN` pendant cette operation.

### 3.3 Proteger et recharger

```bash
sudo chown nocdashboard:nocdashboard /opt/zabbix-noc-dashboard/.env
sudo chmod 600 /opt/zabbix-noc-dashboard/.env
sudo systemctl restart noc-zabbix
```

Le changement prend effet immediatement apres le redemarrage. Une page Settings
deja ouverte avec l'ancien secret ne pourra plus enregistrer de modification.
Rechargez la page, puis saisissez le nouveau secret.

### 3.4 Verifier sans afficher le secret

```bash
sudo awk -F= '$1=="NOC_ADMIN_TOKEN" {
  if (length($2) >= 64) print "Secret Settings configure";
  else print "ERREUR : secret absent ou trop court"
}' /opt/zabbix-noc-dashboard/.env
```

Controlez ensuite le service :

```bash
curl -sS --max-time 5 http://127.0.0.1:3100/api/health
sudo systemctl status noc-zabbix --no-pager
```

Ouvrez le bouton `Configuration` du dashboard et testez le nouveau secret.

## 4. Secret oublie

Le secret actuel n'a pas besoin d'etre recupere. Generez-en un nouveau, modifiez
`NOC_ADMIN_TOKEN` avec `sudoedit`, puis redemarrez le service comme indique dans
la section precedente.

Cette rotation n'efface pas les panneaux existants. Leur configuration reste
dans `dashboard.local.json`.

## 5. Sauvegarde avant une modification

Avant une modification importante, creez une copie protegee dans `/root` :

```bash
sudo cp --preserve=mode,ownership \
  /opt/zabbix-noc-dashboard/.env \
  "/root/noc-zabbix.env.$(date +%Y%m%d-%H%M%S).backup"
```

Pour sauvegarder la disposition des panneaux :

```bash
sudo cp --preserve=mode,ownership \
  /var/lib/noc-zabbix-dashboard/dashboard.local.json \
  "/root/noc-dashboard-layout.$(date +%Y%m%d-%H%M%S).json"
```

Ces sauvegardes contiennent des informations sensibles. Elles doivent rester
lisibles uniquement par `root`.

## 6. Variables disponibles

### `ZABBIX_API_URL`

Adresse complete de l'API JSON-RPC :

```dotenv
ZABBIX_API_URL=http://172.16.132.86:8080/api_jsonrpc.php
```

Si Zabbix est publie localement par Docker, l'adresse peut etre :

```dotenv
ZABBIX_API_URL=http://127.0.0.1:8080/api_jsonrpc.php
```

Apres un changement d'adresse, regenerez la liste reseau systemd et redemarrez.
Le script lit la nouvelle URL, resout son host et limite systemd aux adresses
obtenues ainsi qu'aux bridges Docker locaux :

```bash
sudo bash /opt/zabbix-noc-dashboard/deploy/configure-network-allowlist.sh
sudo systemctl daemon-reload
sudo systemctl restart noc-zabbix
```

### `ZABBIX_ALLOW_INSECURE_HTTP`

Doit rester `true` uniquement tant que l'API interne utilise HTTP :

```dotenv
ZABBIX_ALLOW_INSECURE_HTTP=true
```

Passez cette variable a `false` lorsque l'API est disponible en HTTPS avec un
certificat valide.

### `ZABBIX_REQUEST_TIMEOUT_MS`

Delai maximal d'un appel API, entre 1000 et 30000 millisecondes :

```dotenv
ZABBIX_REQUEST_TIMEOUT_MS=5000
```

Une valeur trop faible provoque des erreurs de timeout. Une valeur trop haute
retarde l'affichage d'une panne de la source.

### `ZABBIX_API_TOKEN`

Methode recommandee pour l'authentification Zabbix :

```dotenv
ZABBIX_API_TOKEN=JETON_ZABBIX_LECTURE_SEULE
ZABBIX_USERNAME=
ZABBIX_PASSWORD=
```

Le jeton doit appartenir a un utilisateur technique en lecture seule. Il doit
pouvoir lire les groupes, hosts, triggers, items, scenarios Web et historiques
du perimetre NOC.

Apres rotation du jeton :

```bash
sudo systemctl restart noc-zabbix
curl -sS --max-time 40 http://127.0.0.1:3100/api/status | jq '{ok, diagnostics}'
```

### `ZABBIX_USERNAME` et `ZABBIX_PASSWORD`

Ces variables constituent la methode de repli historique. Ne les utilisez que
si l'instance ne permet pas les jetons API :

```dotenv
ZABBIX_API_TOKEN=
ZABBIX_USERNAME=utilisateur_noc
ZABBIX_PASSWORD=MOT_DE_PASSE
```

Ne configurez pas simultanement un jeton et un mot de passe. Le jeton est
prioritaire.

### `ZABBIX_HOST_GROUPS`

Liste separee par des virgules :

```dotenv
ZABBIX_HOST_GROUPS=SWITCHE,DTC,SW-DTV,SW-TOUR,AP-DTV,AP-TC3,Navis
```

Lorsque des panneaux ont ete enregistres depuis l'interface, leurs host groups
sont prioritaires sur cette liste. Utilisez donc la page `Configuration` pour
changer le perimetre visuel d'un dashboard deja personnalise.

### `POLL_INTERVAL_SECONDS`

Frequence de lecture du backend, avec un minimum force a 5 secondes :

```dotenv
POLL_INTERVAL_SECONDS=6
```

Cette valeur ne change pas la frequence des items ICMP dans Zabbix. Elle indique
uniquement a quelle frequence le dashboard relit les donnees disponibles.

### `WEB_STATUS_STALE_SECONDS`

Age maximal d'une mesure Web avant de la declarer ancienne :

```dotenv
WEB_STATUS_STALE_SECONDS=180
```

La valeur minimale acceptee est 60 secondes. Elle doit rester superieure a
l'intervalle du scenario NAVIS, avec une marge pour un controle retarde.

### `NOC_TEST_MODE`

Simulation visuelle d'une panne ICMP :

```dotenv
NOC_TEST_MODE=false
```

Passez temporairement a `true` pour une recette, puis remettez immediatement
`false`. Cette option ne modifie aucun equipement et aucun trigger Zabbix.

### `PORT`

Le deploiement d'entreprise utilise :

```dotenv
PORT=3100
```

Conservez ce port. Le service, le kiosque, les tests de sante et la documentation
sont configures pour `3100`. Ne lancez jamais `npm start` pendant que systemd
utilise deja ce port.

### `HOST`

Le dashboard doit rester local au poste NOC :

```dotenv
HOST=127.0.0.1
```

Le backend refuse volontairement `0.0.0.0` et les adresses reseau. N'affaiblissez
pas cette restriction.

## 7. Modifier les panneaux depuis l'interface

1. Ouvrez `http://127.0.0.1:3100/`.
2. Selectionnez le bouton `Configuration`.
3. Saisissez `NOC_ADMIN_TOKEN`, jamais `ZABBIX_API_TOKEN`.
4. Modifiez le titre, le nombre de colonnes, l'ordre ou les host groups.
5. Enregistrez les changements.
6. Utilisez `Retour au NOC` et attendez le prochain rafraichissement.

Un host appartenant a plusieurs groupes est affecte au premier panneau
correspondant. L'ordre des panneaux est donc fonctionnel, pas uniquement visuel.

## 8. Procedure standard apres toute modification

```bash
sudo chown nocdashboard:nocdashboard /opt/zabbix-noc-dashboard/.env
sudo chmod 600 /opt/zabbix-noc-dashboard/.env
sudo systemctl restart noc-zabbix

curl -sS --max-time 5 http://127.0.0.1:3100/api/health
curl -sS --max-time 40 http://127.0.0.1:3100/api/status | jq '{ok, diagnostics}'
sudo systemctl status noc-zabbix --no-pager
```

Le premier appel verifie le processus Node. Le second verifie la communication
avec Zabbix. Un `/api/health` vert ne suffit pas si `/api/status` retourne
`ok: false`.

## 9. Retour arriere

Si la modification empeche le demarrage, restaurez la sauvegarde choisie :

```bash
sudo cp /root/noc-zabbix.env.AAAAmmjj-HHMMSS.backup \
  /opt/zabbix-noc-dashboard/.env
sudo chown nocdashboard:nocdashboard /opt/zabbix-noc-dashboard/.env
sudo chmod 600 /opt/zabbix-noc-dashboard/.env
sudo systemctl restart noc-zabbix
```

Consultez ensuite les erreurs :

```bash
sudo journalctl -u noc-zabbix -n 100 --no-pager
```

## 10. Controle sans divulguer les secrets

Cette commande indique seulement si les secrets ont une longueur plausible :

```bash
sudo awk -F= '
  $1=="ZABBIX_API_TOKEN" {print "ZABBIX_API_TOKEN:", length($2) > 20 ? "configure" : "absent"}
  $1=="NOC_ADMIN_TOKEN"  {print "NOC_ADMIN_TOKEN:",  length($2) >= 64 ? "configure" : "absent ou court"}
' /opt/zabbix-noc-dashboard/.env
```

Elle n'affiche aucune valeur. Si un secret a ete copie accidentellement dans un
terminal partage, un message ou Git, revoquez-le puis generez-en un nouveau.

## 11. Interdictions de production

- Ne jamais committer `.env`.
- Ne jamais utiliser un compte Zabbix administrateur pour le dashboard.
- Ne jamais partager le jeton Zabbix avec les utilisateurs de Settings.
- Ne jamais lancer `npm start` en parallele du service `noc-zabbix`.
- Ne jamais exposer le port `3100` sur le reseau.
- Ne jamais desactiver durablement les protections systemd pour contourner une erreur.
- Ne jamais laisser `NOC_TEST_MODE=true` apres une recette.

## 12. Checklist administrateur

- Sauvegarde protegee realisee.
- Bon fichier modifie : `/opt/zabbix-noc-dashboard/.env`.
- Aucun secret affiche ou versionne.
- Proprietaire `nocdashboard:nocdashboard` et mode `600` verifies.
- Service redemarre une seule fois.
- `/api/health` retourne `ok: true`.
- `/api/status` retourne `ok: true`.
- Page Settings testee si `NOC_ADMIN_TOKEN` a change.
- NAVIS et les groupes ICMP visibles apres rafraichissement.
