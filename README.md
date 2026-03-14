# YDrop Desktop 🎬

Application desktop multiplateforme (Windows · macOS · Linux) pour **télécharger des vidéos YouTube** et **découper des vidéos** localement.

Basée sur Electron + yt-dlp + ffmpeg.

---

## 📁 Structure du projet

```
ydrop/
├── bin/                    ← Placez ici yt-dlp et ffmpeg
│   ├── yt-dlp.exe          (Windows)
│   ├── ffmpeg.exe          (Windows)
│   ├── yt-dlp              (macOS / Linux)
│   └── ffmpeg              (macOS / Linux)
├── src/
│   ├── main.js             ← Processus principal Electron
│   ├── preload.js          ← Bridge IPC sécurisé
│   └── renderer/
|       ├── script.js 
│       ├── styles.css
│       └── index.html      ← Interface utilisateur
├── assets/
│   └── icon.png            ← Icône de l'app (optionnel)
├── package.json
└── README.md
```

---

## 🚀 Installation

### 1. Installer les dépendances Node.js

```bash
npm install
```

### 2. Télécharger les binaires

#### Windows
- **yt-dlp** : https://github.com/yt-dlp/yt-dlp/releases/latest → `yt-dlp.exe` → dossier `bin/`
- **ffmpeg** : https://www.gyan.dev/ffmpeg/builds/ → extraire `ffmpeg.exe` → dossier `bin/`

#### macOS
```bash
brew install yt-dlp ffmpeg
mkdir -p bin
cp $(which yt-dlp) bin/yt-dlp
cp $(which ffmpeg) bin/ffmpeg
```

#### Linux
```bash
sudo apt install ffmpeg
pip install yt-dlp
mkdir -p bin
cp $(which yt-dlp) bin/yt-dlp
cp $(which ffmpeg) bin/ffmpeg
chmod +x bin/yt-dlp bin/ffmpeg
```

### 3. Lancer l'application

```bash
npm start
```

---

## 📦 Compiler un exécutable

```bash
# Windows (.exe installer)
npm run build:win

# macOS (.dmg)
npm run build:mac

# Linux (.AppImage)
npm run build:linux
```

Les fichiers compilés seront dans le dossier `dist/`.

> ⚠️ Les binaires `bin/` sont inclus automatiquement dans le build grâce à `extraResources` dans `package.json`.

---

## 🎯 Fonctionnalités

| Fonctionnalité | Détail |
|---|---|
| ⬇ Téléchargement vidéo | 360p / 480p / 720p / 1080p / 4K en MP4 |
| 🎵 Téléchargement audio | MP3 (320k / 192k), M4A, FLAC, WAV, OGG |
| ✂ Découpe vidéo | Timeline interactive, segments calculés automatiquement |
| 🔄 Ratios de sortie | Original / 9:16 TikTok / 1:1 Carré / 4:5 Portrait / 16:9 |
| 📁 Dossier de sortie | Sélection via dialogue natif OS |
| 🪟 Fenêtre sans bordures | Titlebar personnalisé avec contrôles natifs |
| 🌐 Multiplateforme | Windows · macOS · Linux |

---

## 🛠 Dépannage

**"Binaires manquants"** → Vérifiez que `bin/yt-dlp` et `bin/ffmpeg` existent bien.

**Erreur de téléchargement** → Mettez à jour yt-dlp : `yt-dlp -U`

**Vidéo non lisible dans l'app** → Normal, l'aperçu nécessite un codec compatible. La découpe fonctionne quand même.
