# Syllabo

Jeu de cartes multijoueur en temps réel : chacun pose des syllabes pour construire des mots ensemble.

## Règles
- Chacun reçoit 10 cartes syllabes en main.
- N'importe qui peut jouer n'importe quand : poser une carte en fin d'un mot en cours, ou démarrer un nouveau mot.
- Impossible de poser 2 syllabes d'affilée sur le même mot (il faut qu'un autre joueur contribue entre-temps).
- Chaque syllabe est validée immédiatement contre le dictionnaire français : si le mot obtenu ne peut mener à aucun mot réel, le coup est refusé.
- Un mot sans nouvelle contribution pendant 30s est clos : chacun marque 1 point par syllabe posée sur ce mot (x2 si le mot final est un vrai mot du dictionnaire).
- La partie se termine quand toutes les mains sont vides et tous les mots clos.

## Mise en place (même principe que l'appli budget)

1. **Firebase** : crée un projet Firebase (ou réutilise celui de l'appli budget avec une nouvelle Realtime Database), active Realtime Database en mode test, copie la config dans `src/firebase.js`.
2. **vite.config.js** : remplace `base: '/syllabo/'` par le nom exact de ton repo GitHub.
3. Pousse ce dossier sur un nouveau repo GitHub (via l'interface web, comme la dernière fois).
4. Active GitHub Pages sur la branche de build, ou utilise `npm run deploy` (script `gh-pages` déjà inclus) si tu as accès à un terminal.

## Notes techniques
- Le dictionnaire français (~336k mots) est chargé depuis GitHub au premier lancement et mis en cache dans le navigateur (`localStorage`) pour les fois suivantes.
- Aucune authentification : chaque joueur est identifié par un ID généré et stocké localement sur son téléphone.
- Le jeu ne gère pas encore : reconnexion propre si la partie est fermée, relance d'une nouvelle manche sans recharger la page, mode spectateur. Dis-moi si tu veux qu'on ajoute ça ensuite.
