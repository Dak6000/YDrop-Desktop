# YDrop Desktop

Téléchargeur YouTube + créateur de vidéos courtes (TikTok, Reels, Shorts, WhatsApp…) — Electron.

## Nouveautés v1.1

**Téléchargement rapide**
- Copiez un lien : YDrop le détecte et propose de le télécharger en 1 clic.
- Mode **⚡ automatique au collage** (Ctrl+V n'importe où dans l'onglet, bouton Coller, ou glisser un lien sur la fenêtre).
- **Raccourci global `Ctrl/Cmd+Maj+Y`** : télécharge le lien du presse-papiers même si YDrop est réduit.
- Plusieurs liens collés d'un coup et playlists complètes → file d'attente (1 à 3 téléchargements simultanés).
- Dossier par défaut automatique (`Téléchargements/YDrop`), plus besoin de le choisir.
- Sous-titres YouTube téléchargés avec la vidéo (.srt nettoyé).

**Suivi fiable**
- Vraie progression (vidéo/audio/fusion), vitesse, temps restant, annulation, relance.
- Cause des échecs expliquée en français (robot YouTube, âge, privé, 403, réseau, disque…) + bouton de correction.
- Réessais automatiques (réseau) et **mise à jour automatique de yt-dlp** si YouTube change.
- Installation automatique de **Deno**, désormais requis par yt-dlp pour YouTube (cause fréquente d'échecs).

**Historique**
- Recherche, filtres Réussis/Échecs, ouvrir, afficher dans le dossier, **retélécharger** (même format ou autre), copier le lien, envoyer vers « Découper ».

**Découpe pour les réseaux sociaux**
- Formats 9:16 (TikTok/Reels/Shorts/Statut), 4:5, 1:1, 16:9, Original — **plusieurs formats en une seule passe**.
- Cadrage : recadrage réglable (gauche ↔ droite), **fond flou**, ou bandes noires.
- Durées recommandées par plateforme, **coupe aux pauses** (pas au milieu d'une phrase), sélection segment par segment.
- **Sous-titres incrustés** : fichier .srt, sous-titres YouTube détectés automatiquement, ou génération automatique (Whisper). Styles TikTok / jaune / boîte / classique, mots par ligne, position, aperçu en direct, export .srt par segment.
- Encodage H.264/AAC `yuv420p` compatible partout, 3 niveaux de qualité.

## Dossier `bin/` (non versionné)
```
bin/yt-dlp(.exe)   bin/ffmpeg(.exe)   bin/ffprobe(.exe)   (déjà utilisés par v1.0)
```
ffmpeg doit inclure **libass** (build « full », ex. gyan.dev) pour incruster des sous-titres.
yt-dlp et Deno sont mis à jour/installés automatiquement dans le dossier de données de l'utilisateur.

## Génération automatique de sous-titres (optionnel)
1. Téléchargez `whisper-bin-x64.zip` depuis les releases de [whisper.cpp](https://github.com/ggml-org/whisper.cpp/releases).
2. Paramètres › Outils › Whisper › **Dossier** : copiez-y `whisper-cli.exe` et ses DLL.
3. Placez un modèle (ex. `ggml-base.bin`) dans le sous-dossier `models/`.

## Développement
```
npm install
npm start
npm run build:win      # installateur
npm run release:win    # build + publication GitHub (variable GH_TOKEN)
```
