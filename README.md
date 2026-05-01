# NinoGames

> **Your personal gaming hub — discover, download, play.**

NinoGames is a free, open-source PC game downloader built with Electron. It lets you search, download, and manage free PC games from multiple sources — all from a clean, dark-themed desktop app.

---

## Features

- 🔍 **Game Search** — Search across SteamUnlocked and AnkerGames from a single interface
- 🏠 **Discovery Home** — Browse trending, latest, popular, and upcoming games on launch
- 📥 **Fast Downloads** — Powered by [aria2c](https://github.com/aria2/aria2) with multi-connection, resume support, and real-time progress
- 📦 **Auto Extraction** — Archives are automatically extracted using bundled 7-Zip
- 📚 **Library Management** — Track installed, downloading, paused, and failed games in one place
- ⭐ **Wishlist** — Save games you want to download later
- ⏸️ **Pause & Resume** — Interrupt and continue downloads at any time
- 🚀 **Launch Games** — Launch installed games directly from the app with custom EXE and argument support
- 🎮 **Add to Steam** — Add non-Steam games to your Steam library with one click
- 🖥️ **Desktop Shortcuts** — Create desktop shortcuts for installed games
- 🌙 **Dark / Light Theme** — Toggle between dark and light modes
- ⚙️ **Configurable Settings** — Choose download source, install directory, and toggle aria2 / 7-Zip

---

## Screenshots

> *(Add screenshots of the home view, library, and settings here)*

---

## Download

Grab the latest portable `.exe` from the [Releases](../../releases) page — no installation required.

---

## Requirements

- **Windows** (portable `.exe`, no installer needed)
- For development: [Node.js](https://nodejs.org/) and npm

### Optional bundled tools (place in `resources/`)

| Tool | Path | Purpose |
|------|------|---------|
| aria2c | `resources/aria2/aria2c.exe` | Accelerated multi-connection downloading |
| 7-Zip | `resources/7zip/7za.exe` | Archive extraction |

Download aria2 from [github.com/aria2/aria2/releases](https://github.com/aria2/aria2/releases).

---

## Development Setup

```bash
# Clone the repo
git clone https://github.com/your-username/NinoGames.git
cd NinoGames

# Install dependencies
npm install

# Run in development mode
npm start
```

### Build a portable Windows executable

```bash
npm run dist
```

This uses `electron-builder` to produce a portable `.exe` in the `dist/` folder.

---

## Project Structure

```
NinoGames/
├── main.js              # Main process — downloads, extraction, IPC handlers
├── preload.js           # Context bridge exposing APIs to the renderer
├── store.js             # Persistent storage (library, wishlist, settings)
├── package.json
└── renderer/
    ├── index.html       # App shell and UI markup
    ├── renderer.js      # Renderer process — UI logic and state
    └── styles.css       # App styles
```

---

## How It Works

1. **Search** — NinoGames scrapes game listings from SteamUnlocked or AnkerGames based on your query.
2. **Download** — When you click download, the app resolves the direct file URL and hands it off to aria2c (or Electron's built-in downloader as fallback).
3. **Extract** — Once the download completes, the archive is extracted automatically using 7-Zip (or PowerShell as fallback).
4. **Launch** — NinoGames scans the install directory for executables and lets you pick and launch the game.

All library data, wishlist entries, and settings are stored locally in a `sudata.json` file in your app data folder.

---

## Settings

| Setting | Description |
|---------|-------------|
| **Install Path** | Where games are downloaded and extracted (default: `~/NinoGames`) |
| **Search Source** | Choose between SteamUnlocked or AnkerGames |
| **aria2 Downloader** | Enable/disable aria2c for faster downloads |
| **7-Zip Extraction** | Enable/disable bundled 7-Zip for extraction |
| **Theme** | Toggle dark / light mode |

---

## Uninstalling

Run `Uninstall NinoGames.bat` (or `Uninstall NinoGames.ps1`) included in the app folder to remove the application. You can optionally delete your downloaded games at the same time.

---

## License

This project is provided for personal, non-commercial use. Game content is sourced from third-party sites — do not resell these games as they are contain pirated software. Use for personal use only.


---

## Author

Made with ❤️ by **nino**
