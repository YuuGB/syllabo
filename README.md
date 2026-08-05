# Syllabo

Jeu de lettres multijoueur en temps réel (ou en solo contre une IA) : construisez des mots ensemble, lettre par lettre.

## Règles

**But :** marquer un maximum de points en posant tes lettres pour construire des mots valides, seul ou à plusieurs.

- Chaque joueur reçoit les 26 lettres de l'alphabet, une seule fois chacune.
- Les voyelles (A, E, I, O, U, Y) peuvent être jouées jusqu'à **3 fois** chacune avant de quitter la main (un badge affiche le nombre d'utilisations restantes). Les consonnes ne servent qu'une seule fois.
- **Tour par tour**, pas de temps limite : à ton tour, tu peux :
  - poser une lettre en fin d'un mot déjà en cours (n'importe lequel) ;
  - démarrer un nouveau mot ;
  - **clore** un mot ouvert (action gratuite, sans carte) pour figer les points ;
  - ou passer.
- Chaque lettre est validée **immédiatement** contre le dictionnaire français : si le mot obtenu ne peut mener à aucun mot réel, le coup est refusé.
- Un mot clos rapporte, à chaque joueur qui y a contribué, 1 point par lettre posée — **x2** si le mot final est un vrai mot du dictionnaire.
- La partie se termine quand toutes les mains sont vides et tous les mots clos ; un écran de classement final s'affiche, avec un bouton pour relancer une manche dans le même salon.

**Mode solo :** joue contre une IA qui, à son tour, cherche une lettre valide dans sa main pour prolonger un mot (ou en démarrer un nouveau) — seules tes propres lettres comptent pour ton score final.

## Fonctionnalités

- **Multi-parties** : l'accueil affiche "Mes parties" (celles que tu as rejointes, mémorisées sur ton téléphone) et "Parties en cours" (annuaire public des parties ouvertes), pour naviguer entre plusieurs parties sans perdre sa place.
- **Reconnexion** : recharger la page retrouve automatiquement tes parties en cours.
- **Règles intégrées** : bouton "📖 Règles du jeu" sur l'accueil.
- **Classement** : bouton "🏆 Classement", top 10 solo et top 10 multijoueur, alimentés automatiquement à la fin de chaque partie.

## Mise en place (même principe que l'appli budget)

1. **Firebase** : crée un projet Firebase (ou réutilise celui de l'appli budget avec une nouvelle Realtime Database), active Realtime Database en mode test, copie la config dans `src/firebase.js`.
2. **vite.config.js** : remplace `base: '/syllabo/'` par le nom exact de ton repo GitHub.
3. Crée chaque fichier un par un sur GitHub (**Add file > Create new file**, chemin complet dans le champ nom, ex. `src/App.jsx`) puisque l'upload de dossier ne marche pas sur mobile.
4. Ajoute `.github/workflows/deploy.yml` pour le build automatique, et vérifie que **Settings > Pages > Source** est réglé sur "GitHub Actions".

## Structure des données Firebase

- `rooms/{code}` : état complet d'une partie (joueurs, mains, plateau, tour) — lu uniquement par les participants de cette partie.
- `roomsIndex/{code}` : fiche légère d'une partie (code, nombre de joueurs, statut) pour l'annuaire public, sans les mains des joueurs.
- `leaderboard/solo` et `leaderboard/multi` : historique des scores de fin de partie, utilisés pour les tops 10.

## Notes techniques

- Le dictionnaire français (~336k mots) est chargé depuis GitHub au premier lancement et mis en cache dans le navigateur (`localStorage`) pour les fois suivantes.
- Aucune authentification : chaque joueur est identifié par un ID généré et stocké localement sur son téléphone.
- Limite connue : l'annuaire public ne détecte pas encore automatiquement qu'une partie est "terminée" (elle reste affichée comme "en cours").
