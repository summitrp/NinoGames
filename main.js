'use strict';

const { app, BrowserWindow, ipcMain, shell, session, dialog, globalShortcut } = require('electron');
const { net } = require('electron');
const path   = require('path');
const fs     = require('fs');
const cp     = require('child_process');
const store  = require('./store');

let mainWindow;
const activeDownloads = new Map();

// ── Helpers ───────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function sendMain(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(channel, data);
}

function gameIdFromUrl(url) {
  const su = url.match(/steamunlocked\.org\/([^/?#]+)/);
  if (su) return su[1].replace(/-free-download.*$/, '').replace(/-+$/, '');
  const ag = url.match(/ankergames\.net\/game\/([^/?#]+)/);
  if (ag) return 'ag-' + ag[1].replace(/-+$/, '');
  return url;
}

function decodeHTMLEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .trim();
}

function fmtBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function getInstallDir() {
  const settings = store.getSettings();
  return settings.installPath || path.join(app.getPath('home'), 'NinoGames');
}

// ── aria2c binary path ────────────────────────────────────────
// Place aria2c.exe (Windows) or aria2c (Linux/Mac) in:
//   <project>/resources/aria2/aria2c.exe   (dev)
//   resources/aria2/aria2c.exe             (packaged)
function getAria2Path() {
  const bin = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'aria2', bin);
  }
  return path.join(__dirname, 'resources', 'aria2', bin);
}

// ── 7-Zip binary path ─────────────────────────────────────────
// Place 7za.exe (Windows standalone) in:
//   <project>/resources/7zip/7za.exe   (dev)
//   resources/7zip/7za.exe             (packaged)
function get7ZipPath() {
  const bin = process.platform === 'win32' ? '7za.exe' : '7za';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, '7zip', bin);
  }
  return path.join(__dirname, 'resources', '7zip', bin);
}

// ── aria2c downloader ─────────────────────────────────────────
// Spawns aria2c for a known direct file URL.
// Supports resume, multi-connection, retries, and progress parsing.
function aria2Download({ fileUrl, destDir, filename, refererUrl, cookies, gameId, title }) {
  return new Promise((resolve, reject) => {
    const aria2Path = getAria2Path();

    if (!fs.existsSync(aria2Path)) {
      return reject(new Error(
        `aria2c not found at ${aria2Path}. ` +
        `Download it from https://github.com/aria2/aria2/releases and place the binary in resources/aria2/`
      ));
    }

    fs.mkdirSync(destDir, { recursive: true });

    const args = [
      '--continue=true',                  // resume partial downloads
      '--max-connection-per-server=4',    // 4 parallel connections per server
      '--split=4',                        // split file into 4 chunks
      '--min-split-size=10M',             // only split if file > 10MB
      '--retry-wait=3',                   // wait 3s between retries
      '--max-tries=15',                   // retry up to 15 times
      '--timeout=60',                     // 60s connection timeout
      '--connect-timeout=15',             // 15s initial connect timeout
      '--file-allocation=none',           // faster start (no pre-allocation)
      '--console-log-level=notice',
      '--summary-interval=1',             // progress update every 1s
      `--dir=${destDir}`,
      `--out=${filename}`,
      `--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`,
    ];

    if (refererUrl) args.push(`--referer=${refererUrl}`);
    if (cookies)    args.push(`--header=Cookie: ${cookies}`);

    args.push(fileUrl);

    const proc = cp.spawn(aria2Path, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const entry = activeDownloads.get(gameId);
    if (entry) entry.proc = proc;

    let stderr = '';
    let lastPct = 0;

    // aria2c progress line format:
    // [#abc123 SIZE/TOTAL(PCT%) CN:4 DL:2.0MiB ETA:30s]
    proc.stdout.on('data', d => {
      const lines = d.toString().split('\n');
      for (const line of lines) {
        // Summary line with percent
        const pctM  = line.match(/\((\d+)%\)/);
        const dlM   = line.match(/DL:([\d.]+\w+)/);
        const etaM  = line.match(/ETA:([\w]+)/);
        const sizeM = line.match(/([\d.]+\w+)\/([\d.]+\w+)/);

        if (pctM) {
          const pct   = parseInt(pctM[1]);
          const speed = dlM  ? dlM[1]  : '';
          const eta   = etaM ? etaM[1] : '';
          const recv  = sizeM ? sizeM[1] : '';
          const total = sizeM ? sizeM[2] : '';

          lastPct = pct;
          const msg = total
            ? `${pct}%  ${recv} / ${total}${speed ? `  •  ${speed}/s` : ''}${eta ? `  •  ETA ${eta}` : ''}`
            : `${pct}%${speed ? `  •  ${speed}/s` : ''}`;

          store.upsertLibrary(gameId, { status: 'downloading', statusMsg: msg, percent: pct });
          sendMain('download-progress', { gameId, pct, speed, eta, msg });
        }
      }
    });

    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('error', err => reject(err));

    proc.on('close', code => {
      if (code === 0) {
        resolve(path.join(destDir, filename));
      } else if (code === null) {
        // Killed intentionally (cancel/pause)
        reject(new Error('cancelled'));
      } else {
        reject(new Error(stderr.trim() || `aria2c exited with code ${code}`));
      }
    });
  });
}

// ── HTTP fetch ────────────────────────────────────────────────
function fetchPage(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request({
      url, method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...extraHeaders,
      },
    });
    let body = '';
    let statusCode = 200;
    req.on('response', res => {
      statusCode = res.statusCode;
      res.on('data', c => { body += c.toString(); });
      res.on('end', () => resolve({ statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Parse search results ──────────────────────────────────────
function parseGames(html) {
  const games = [];

  // SteamUnlocked has changed markup over time — try each pattern in order.
  // Pattern A (current): <a class="cover-item" ...>  (same structure as homepage)
  // Pattern B (old):     <div class="cover-item category">
  // Pattern C (fallback):<div class="cover-item">
  let parts;
  if (html.includes('<a class="cover-item"')) {
    parts = html.split('<a class="cover-item"');
  } else if (html.includes('<div class="cover-item category">')) {
    parts = html.split('<div class="cover-item category">');
  } else {
    parts = html.split('<div class="cover-item">');
  }

  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const hrefM  = chunk.match(/href="(https?:\/\/steamunlocked\.org\/[^"]+)"/);
    // Title: try new markup first, fall back to <h2>
    const titleM = chunk.match(/cover-item-content__title">\s*([^<]+)/)
                || chunk.match(/<h2>([\s\S]*?)<\/h2>/);
    const imgAbsM = chunk.match(/src="(https:\/\/steamunlocked\.org\/wp-content\/uploads\/[^"]+)"/);
    const srcsetM = chunk.match(/srcset="(https:\/\/steamunlocked\.org\/wp-content\/uploads\/[^\s"]+)/);
    const imgM   = chunk.match(/<img[^>]+src="([^"]+)"/);
    const image  = (imgAbsM ? imgAbsM[1] : null) || (srcsetM ? srcsetM[1] : null) || (imgM ? imgM[1] : null);

    if (hrefM && titleM) {
      const raw  = decodeHTMLEntities(titleM[1].trim());
      const verM = raw.match(/^(.*?)\s*(\([^)]+\))\s*$/);
      games.push({
        url: hrefM[1], title: verM ? verM[1].trim() : raw,
        version: verM ? verM[2] : null, image,
      });
    }
  }
  return games;
}

// ── Parse AnkerGames search results ──────────────────────────
function parseAnkerGames(html) {
  const games = [];
  const parts = html.split('<article ');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const hrefM  = chunk.match(/href="(https?:\/\/ankergames\.net\/game\/[^"]+)"/);
    const titleM = chunk.match(/<h3[^>]*>([^<]+)<\/h3>/);
    const imgM   = chunk.match(/<img[^>]+src="([^"]+)"/);
    const genreM = chunk.match(/class="[^"]*opacity-70[^"]*">([^<]+)<\/p>/);
    const metaM  = chunk.match(/class="[^"]*opacity-60[^"]*">([^<]+)<\/p>/);
    if (hrefM && titleM) {
      games.push({
        url:     hrefM[1],
        title:   decodeHTMLEntities(titleM[1].trim()),
        version: null,
        image:   imgM   ? imgM[1]   : null,
        genre:   genreM ? genreM[1].trim() : null,
        meta:    metaM  ? metaM[1].trim()  : null,
        source:  'ankergames',
      });
    }
  }
  return games;
}

// ── Parse SteamUnlocked homepage (recently added + popular) ──
function parseSteamUnlockedHome(html) {
  function parseSection(section) {
    const games = [];
    const parts = section.split('<a class="cover-item"');
    for (let i = 1; i < parts.length; i++) {
      const chunk = parts[i];
      const hrefM   = chunk.match(/href="(https?:\/\/steamunlocked\.org\/[^"]+)"/);
      const titleM  = chunk.match(/cover-item-content__title">\s*([^<]+)/);
      const dateM   = chunk.match(/cover-item-content__date">\s*([^<]*)/);
      const imgAbsM = chunk.match(/src="(https:\/\/steamunlocked\.org\/wp-content\/uploads\/[^"]+)"/);
      const srcsetM = chunk.match(/srcset="(https:\/\/steamunlocked\.org\/wp-content\/uploads\/[^\s"]+)/);
      const image   = (imgAbsM ? imgAbsM[1] : null) || (srcsetM ? srcsetM[1] : null);
      if (!hrefM || !titleM) continue;
      const rawTitle = decodeHTMLEntities(titleM[1].trim());
      const verM = rawTitle.match(/^(.*?)\s+\(([^)]+)\)\s*$/);
      games.push({
        url:     hrefM[1],
        title:   verM ? verM[1].trim() : rawTitle,
        version: verM ? verM[2] : null,
        date:    dateM ? dateM[1].trim() : '',
        image,
        source:  'steamunlocked',
      });
    }
    return games;
  }

  const raIdx  = html.indexOf('Recently Added');
  const popIdx = html.indexOf('Popular games');
  const endIdx = html.indexOf('</body>');

  const recentSection  = raIdx  !== -1 && popIdx !== -1 ? html.slice(raIdx, popIdx)  : '';
  const popularSection = popIdx !== -1                  ? html.slice(popIdx, endIdx > popIdx ? endIdx : undefined) : '';

  return {
    recent:  parseSection(recentSection).slice(0, 8),
    popular: parseSection(popularSection).slice(0, 8),
  };
}

// ── Parse AnkerGames homepage (trending carousel + latest grid) ──
function parseAnkerGamesHome(html) {
  const latestIdx = html.indexOf('Latest Games');

  function parseListingArticles(section) {
    const games = [];
    const re = /listing="(\{[^"]+\})"/g;
    let m;
    while ((m = re.exec(section)) !== null) {
      try {
        const data = JSON.parse(decodeHTMLEntities(m[1]));
        const slug    = data.slug || '';
        const genres  = (data.genres || []).map(g => g.title);
        const version = data.vote_average || null;
        const size    = data.runtime || null;
        games.push({
          url:     `https://ankergames.net/game/${slug}`,
          title:   data.title || '',
          version,
          image:   data.imageurl || null,
          genre:   genres[0] || null,
          genres,
          size,
          source:  'ankergames',
        });
      } catch (_) { /* skip malformed */ }
    }
    return games;
  }

  const carouselSection = latestIdx !== -1 ? html.slice(0, latestIdx) : html;
  const latestSection   = latestIdx !== -1 ? html.slice(latestIdx)    : '';

  return {
    trending: parseListingArticles(carouselSection).slice(0, 8),
    latest:   parseListingArticles(latestSection).slice(0, 8),
  };
}

// ── Parse AnkerGames upcoming page ───────────────────────────
function parseAnkerUpcoming(html) {
  const games = [];
  const parts = html.split('class="group relative"');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i];
    const titleM = chunk.match(/<h3[^>]*>\s*([\s\S]*?)\s*<\/h3>/);
    if (!titleM) continue;
    const title = decodeHTMLEntities(titleM[1].trim());
    if (!title) continue;
    const webpM = chunk.match(/<source\s+srcset="(https:\/\/ankergames\.net[^"]+\.webp)"/i);
    const imgM  = chunk.match(/<img\s[^>]*src="(https:\/\/ankergames\.net[^"]+\.(?:jpg|jpeg|png))"/i);
    const image = (webpM ? webpM[1] : null) || (imgM ? imgM[1] : null);
    const dateM = chunk.match(/bg-blue-500\/10 border[^"]*whitespace-nowrap">\s*([^<]{3,30}?)\s*<\/div>/);
    const date  = dateM ? dateM[1].trim() : 'TBA';
    const genres = [];
    const genreRe = /bg-white\/5[^"]*truncate">([^<]+)<\/span>/g;
    let gm;
    while ((gm = genreRe.exec(chunk)) !== null) genres.push(gm[1].trim());
    const steamM = chunk.match(/href="(https:\/\/store\.steampowered\.com\/app\/\d+[^"]*)"/);
    const url    = steamM ? steamM[1] : '';
    games.push({ title, image, date, genres, url });
  }
  return games;
}

// ── Parse AnkerGames game page ────────────────────────────────
function parseAnkerGamesPage(body, gameUrl) {
  const bannerM = body.match(/property="og:image"\s+content="([^"]+)"/)
               || body.match(/content="([^"]+)"\s+property="og:image"/);

  let description = null;
  const descM = body.match(/<p[^>]*class="[^"]*text-gray-600[^"]*mt-3[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
             || body.match(/<p[^>]*class="[^"]*mt-3[^"]*text-gray-600[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  if (descM) {
    description = descM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800);
  }
  if (!description) {
    const metaM = body.match(/property="og:description"\s+content="([^"]+)"/)
               || body.match(/name="description"\s+content="([^"]+)"/);
    if (metaM) description = decodeHTMLEntities(metaM[1]).slice(0, 800);
  }

  const screenshots = [];
  const seenSS = new Set();
  const ssRe = /(?:src|data-src|data-lazy-src)="(https?:\/\/ankergames\.net\/uploads\/[^"]+\.(?:jpg|jpeg|png|webp))"/gi;
  let ssM;
  while ((ssM = ssRe.exec(body)) !== null) {
    const u = ssM[1];
    if (seenSS.has(u) || u.includes('/poster/') || u.includes('/user/')) continue;
    seenSS.add(u);
    screenshots.push(u);
  }

  const sysReqItems = [];
  const sysReqAnchor = body.search(/System Requirements/i);
  if (sysReqAnchor !== -1) {
    const section = body.slice(sysReqAnchor);
    const rowRe = /<dt[^>]*>([\s\S]*?)<\/dt>[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    let rowM;
    while ((rowM = rowRe.exec(section)) !== null) {
      const label = rowM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const value = rowM[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (label && value) sysReqItems.push({ label, value });
    }
  }

  const idM = body.match(/generateDownloadUrl\((\d+)\)/);
  const ankerGameId = idM ? idM[1] : null;
  const sizeM = body.match(/(\d+(?:\.\d+)?\s*GB)/i);

  return {
    description,
    sysReqItems,
    downloadUrl: ankerGameId ? `__ankergames__:${ankerGameId}` : null,
    downloadSource: 'AnkerGames',
    bannerImage: bannerM ? bannerM[1] : null,
    size: sizeM ? sizeM[1] : null,
    screenshots: screenshots.slice(0, 10),
    ankerGameId,
    gamePageUrl: gameUrl,
  };
}

// ── Extract archive (ZIP or RAR) ──────────────────────────────
function extractArchive(archivePath, destDir, onProgress) {
  const ext = path.extname(archivePath).toLowerCase();
  if (ext === '.rar') return extractRar(archivePath, destDir, onProgress);
  return extractZip(archivePath, destDir, onProgress);
}

function extractRar(rarPath, destDir, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });

    let proc;
    let stderr = '';

    const handleProc = () => {
      let stdout = '';
      proc.stdout?.on('data', d => {
        stdout += d.toString();
        const pctMatches = stdout.match(/(\d{1,3})%/g);
        if (pctMatches) {
          const last = pctMatches[pctMatches.length - 1];
          if (onProgress) onProgress(`Extracting… (${last})`);
        }
        const lines = stdout.split('\n');
        lines.forEach(line => {
          if (/^(Extracting|OK)\s+/i.test(line.trim())) {
            const fname = line.trim().split(/\s+/)[1] || '';
            if (onProgress) onProgress(`Extracting… ${fname}`);
          }
        });
      });
      proc.stderr?.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve(destDir);
        else reject(new Error(stderr || `Extraction exited with code ${code}`));
      });
    };

    if (process.platform === 'win32') {
      const winrar = 'C:\\Program Files\\WinRAR\\WinRAR.exe';
      const zip7   = 'C:\\Program Files\\7-Zip\\7z.exe';
      const useWinrar = fs.existsSync(winrar);
      const use7zip   = !useWinrar && fs.existsSync(zip7);
      if (useWinrar) {
        proc = cp.spawn(winrar, ['x', '-y', rarPath, destDir]);
      } else if (use7zip) {
        proc = cp.spawn(zip7, ['x', rarPath, `-o${destDir}`, '-y', '-bsp1']);
      } else {
        return reject(new Error('WinRAR or 7-Zip not found. Please install one to extract .rar files.'));
      }
    } else {
      const hasUnrar = (() => { try { cp.execSync('which unrar', { stdio: 'ignore' }); return true; } catch { return false; } })();
      const has7z    = !hasUnrar && (() => { try { cp.execSync('which 7z', { stdio: 'ignore' }); return true; } catch { return false; } })();
      if (hasUnrar) {
        proc = cp.spawn('unrar', ['x', '-y', rarPath, destDir]);
      } else if (has7z) {
        proc = cp.spawn('7z', ['x', rarPath, `-o${destDir}`, '-y', '-bsp1']);
      } else {
        return reject(new Error('unrar or 7z not found. Please install one to extract .rar files.'));
      }
    }

    handleProc();
  });
}

function extractZip(zipPath, destDir, onProgress) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const isPlatformWin = process.platform === 'win32';
    let proc;
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (proc) { try { proc.kill(); } catch {} }
      if (err) reject(err); else resolve(destDir);
    };

    const timer = setTimeout(() => done(new Error('Extraction timed out after 30 minutes')), 30 * 60 * 1000);

    // ── Try bundled 7-Zip first (when enabled in settings) ────
    const settings     = store.getSettings();
    const sevenZipPath = get7ZipPath();
    const use7Zip      = settings.sevenZipEnabled !== false && fs.existsSync(sevenZipPath);

    if (use7Zip) {
      let stderr = '';
      let fileCount = 0;
      proc = cp.spawn(sevenZipPath, ['x', zipPath, `-o${destDir}`, '-y', '-bsp1'], { stdio: ['ignore', 'pipe', 'pipe'] });
      proc.stdout?.on('data', d => {
        const text = d.toString();
        const pctM = text.match(/(\d{1,3})%/);
        if (pctM && onProgress) onProgress(`Extracting… (${pctM[1]}%)`);
        text.split('\n').forEach(line => {
          if (/^Extracting\s+/i.test(line.trim())) {
            fileCount++;
            if (onProgress && fileCount % 20 === 0) onProgress(`Extracting… (${fileCount} files)`);
          }
        });
      });
      proc.stderr?.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => done(err));
      proc.on('close', code => {
        if (code === 0) done(null);
        else done(new Error(stderr.trim() || `7-Zip exited with code ${code}`));
      });
      return;
    }

    // ── Fallback: PowerShell (Windows) or unzip (Unix) ────────
    if (isPlatformWin) {
      const escapedZip  = zipPath.replace(/'/g, "''");
      const escapedDest = destDir.replace(/'/g, "''");
      const cmd = `powershell -NoProfile -NonInteractive -Command "` +
        `$ErrorActionPreference='Stop';` +
        `Add-Type -AssemblyName System.IO.Compression.FileSystem;` +
        `$zip=[System.IO.Compression.ZipFile]::OpenRead('${escapedZip}');` +
        `$total=$zip.Entries.Count;$i=0;` +
        `foreach($e in $zip.Entries){` +
          `$i++;` +
          `$outPath=[System.IO.Path]::Combine('${escapedDest}',$e.FullName);` +
          `$dir=[System.IO.Path]::GetDirectoryName($outPath);` +
          `if($dir -and -not [System.IO.Directory]::Exists($dir)){[System.IO.Directory]::CreateDirectory($dir)|Out-Null};` +
          `if(-not $e.FullName.EndsWith('/')){` +
            `[System.IO.Compression.ZipFileExtensions]::ExtractToFile($e,$outPath,$true)` +
          `};` +
          `Write-Host "PROG:$i/$total"` +
        `};` +
        `$zip.Dispose()` +
        `"`;
      let stderr = '';
      proc = cp.exec(cmd, { maxBuffer: 200 * 1024 * 1024 });
      proc.stdout?.on('data', d => {
        const lines = d.toString().split('\n');
        for (const line of lines) {
          const m = line.match(/PROG:(\d+)\/(\d+)/);
          if (m && onProgress) onProgress(`Extracting… (${m[1]}/${m[2]} files)`);
        }
      });
      proc.stderr?.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => done(err));
      proc.on('close', code => {
        if (code === 0) done(null);
        else done(new Error(stderr.trim() || `PowerShell extraction exited with code ${code}`));
      });
    } else {
      proc = cp.spawn('unzip', ['-o', zipPath, '-d', destDir]);
      let stderr = '';
      let fileCount = 0;
      proc.stdout?.on('data', d => {
        const lines = d.toString().split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('inflating:') || line.trim().startsWith('extracting:')) {
            fileCount++;
            if (onProgress && fileCount % 20 === 0) onProgress(`Extracting… (${fileCount} files)`);
          }
        }
      });
      proc.stderr?.on('data', d => { stderr += d.toString(); });
      proc.on('error', err => done(err));
      proc.on('close', code => {
        if (code === 0 || code === 1) done(null);
        else done(new Error(stderr || `unzip exited ${code}`));
      });
    }
  });
}

// ── Find executable ───────────────────────────────────────────
function findExecutable(dir, gameTitle) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const titleNorm = gameTitle ? norm(gameTitle) : '';

  function score(name) {
    const n = norm(name);
    if (n.includes('unins') || n.includes('redist') || n.includes('setup') || n.includes('install')) return -1;
    if (titleNorm && n.includes(titleNorm.slice(0, Math.min(6, titleNorm.length)))) return 3;
    if (n.includes('launch') || n.includes('start') || n.includes('play')) return 2;
    return 1;
  }

  function scanDir(d, depth) {
    let best = null, bestScore = -1;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return null; }
    const dirs = [];
    for (const e of entries) {
      if (!e.isDirectory() && e.name.toLowerCase().endsWith('.exe')) {
        const s = score(e.name);
        if (s > bestScore) { bestScore = s; best = path.join(d, e.name); }
      } else if (e.isDirectory() && !e.name.toLowerCase().includes('redist')) {
        dirs.push(e);
      }
    }
    if (best && bestScore >= 1) return best;
    if (depth > 0) {
      for (const subDir of dirs) {
        const r = scanDir(path.join(d, subDir.name), depth - 1);
        if (r) return r;
      }
    }
    if (best) return best;
    return null;
  }

  return scanDir(dir, 3);
}

// ── Add to Steam ──────────────────────────────────────────────
function findSteamShortcutsPath() {
  const os = require('os');
  const home = os.homedir();
  const platform = process.platform;
  let steamPaths = [];
  if (platform === 'win32') {
    steamPaths = [
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Steam'),
    ];
  } else if (platform === 'linux') {
    steamPaths = [
      path.join(home, '.steam', 'steam'),
      path.join(home, '.local', 'share', 'Steam'),
    ];
  } else if (platform === 'darwin') {
    steamPaths = [path.join(home, 'Library', 'Application Support', 'Steam')];
  }
  for (const sp of steamPaths) {
    const userdataDir = path.join(sp, 'userdata');
    if (!fs.existsSync(userdataDir)) continue;
    try {
      const users = fs.readdirSync(userdataDir).filter(d => /^\d+$/.test(d));
      if (users.length > 0) {
        const sorted = users.sort((a, b) => {
          try { return fs.statSync(path.join(userdataDir, b)).mtimeMs - fs.statSync(path.join(userdataDir, a)).mtimeMs; } catch { return 0; }
        });
        return path.join(userdataDir, sorted[0], 'config', 'shortcuts.vdf');
      }
    } catch {}
  }
  return null;
}

function vdfStr(key, val) {
  return Buffer.concat([
    Buffer.from([0x01]),
    Buffer.from(key + '\x00', 'utf8'),
    Buffer.from((val || '') + '\x00', 'utf8'),
  ]);
}
function vdfU32(key, val) {
  const num = Buffer.alloc(4);
  num.writeUInt32LE((val >>> 0), 0);
  return Buffer.concat([Buffer.from([0x02]), Buffer.from(key + '\x00', 'utf8'), num]);
}
function vdfObjStart(key) {
  return Buffer.concat([Buffer.from([0x00]), Buffer.from(key + '\x00', 'utf8')]);
}
function vdfObjEnd() { return Buffer.from([0x08]); }

function buildShortcutsVdf(entries) {
  const parts = [vdfObjStart('shortcuts')];
  for (const e of entries) {
    parts.push(vdfObjStart(String(e.idx)));
    parts.push(vdfU32('appid', e.appId));
    parts.push(vdfStr('AppName', e.title));
    parts.push(vdfStr('Exe', `"${e.execPath}"`));
    parts.push(vdfStr('StartDir', e.startDir || path.dirname(e.execPath)));
    parts.push(vdfStr('icon', e.execPath));
    parts.push(vdfStr('ShortcutPath', ''));
    parts.push(vdfStr('LaunchOptions', e.launchArgs || ''));
    parts.push(vdfU32('IsHidden', 0));
    parts.push(vdfU32('AllowDesktopConfig', 1));
    parts.push(vdfU32('AllowOverlay', 1));
    parts.push(vdfU32('openvr', 0));
    parts.push(vdfU32('Devkit', 0));
    parts.push(vdfStr('DevkitGameID', ''));
    parts.push(vdfU32('LastPlayTime', 0));
    parts.push(vdfObjStart('tags'));
    parts.push(vdfObjEnd());
    parts.push(vdfObjEnd());
  }
  parts.push(vdfObjEnd());
  return Buffer.concat(parts);
}

function parseShortcutsVdf(buf) {
  const entries = [];
  let i = 0;
  while (i < buf.length - 2) {
    const key = 'AppName\x00';
    const needle = Buffer.from('\x01' + key, 'utf8');
    const pos = buf.indexOf(needle, i);
    if (pos === -1) break;
    let start = pos + needle.length;
    let end = start;
    while (end < buf.length && buf[end] !== 0) end++;
    const name = buf.slice(start, end).toString('utf8');
    const exeNeedle = Buffer.from('\x01Exe\x00', 'utf8');
    const exePos = buf.indexOf(exeNeedle, pos);
    let exePath = '';
    if (exePos !== -1) {
      let es = exePos + exeNeedle.length;
      let ee = es;
      while (ee < buf.length && buf[ee] !== 0) ee++;
      exePath = buf.slice(es, ee).toString('utf8').replace(/^"|"$/g, '');
    }
    entries.push({ title: name, execPath: exePath });
    i = pos + 1;
  }
  return entries;
}

ipcMain.handle('add-to-steam', async (_e, { gameId, execPath, title, launchArgs, startDir }) => {
  if (!execPath) return { error: 'No executable path provided.' };
  try {
    const shortcutsPath = findSteamShortcutsPath();
    if (!shortcutsPath) return { error: 'Steam userdata folder not found. Is Steam installed?' };
    fs.mkdirSync(path.dirname(shortcutsPath), { recursive: true });
    let appId = 0;
    const src = (title || '') + (execPath || '');
    for (let ci = 0; ci < src.length; ci++) { appId = (appId * 31 + src.charCodeAt(ci)) >>> 0; }
    let existingParsed = [];
    if (fs.existsSync(shortcutsPath)) {
      try {
        const existing = fs.readFileSync(shortcutsPath);
        existingParsed = parseShortcutsVdf(existing);
        fs.copyFileSync(shortcutsPath, shortcutsPath + '.bak');
      } catch {}
    }
    const allEntries = existingParsed.map((e, idx) => ({
      idx, appId: 0, title: e.title, execPath: e.execPath, startDir: path.dirname(e.execPath), launchArgs: '',
    }));
    allEntries.push({
      idx: allEntries.length,
      appId,
      title: title || gameId,
      execPath,
      startDir: startDir || path.dirname(execPath),
      launchArgs: launchArgs || '',
    });
    const output = buildShortcutsVdf(allEntries);
    fs.writeFileSync(shortcutsPath, output);
    return { ok: true, shortcutsPath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('add-desktop-shortcut', async (_e, { gameId, execPath, title }) => {
  if (!execPath) return { error: 'No executable' };
  try {
    const desktop = app.getPath('desktop');
    if (process.platform === 'win32') {
      const lnkPath = path.join(desktop, `${title || gameId}.lnk`);
      const ps = `$s=(New-Object -COM WScript.Shell).CreateShortcut('${lnkPath.replace(/'/g,"''")}');$s.TargetPath='${execPath.replace(/'/g,"''")}';$s.Save()`;
      cp.execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`);
    } else if (process.platform === 'linux') {
      const desktopEntry = `[Desktop Entry]\nName=${title||gameId}\nExec=${execPath}\nType=Application\nTerminal=false\n`;
      fs.writeFileSync(path.join(desktop, `${title||gameId}.desktop`), desktopEntry);
    }
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

// ── Window creation ───────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 920, minHeight: 620,
    frame: false, backgroundColor: '#1A1A1A',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
    show: false,
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize',   () => sendMain('window-state', 'maximized'));
  mainWindow.on('unmaximize', () => sendMain('window-state', 'normal'));
  mainWindow.on('close', e => {
    const hasActive = [...activeDownloads.values()].some(d =>
      d.status === 'downloading' || d.status === 'preparing' || d.status === 'extracting'
    );
    if (hasActive) {
      e.preventDefault();
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Download in progress',
        message: 'A download is currently in progress.',
        detail: 'Please cancel or wait for the download to finish before closing.',
        buttons: ['OK'],
      });
    }
  });
}

app.whenReady().then(() => { store.resetInterrupted(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── Window controls ───────────────────────────────────────────
ipcMain.on('win-minimize',  () => mainWindow.minimize());
ipcMain.on('win-maximize',  () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('win-close',     () => mainWindow.close());
ipcMain.on('open-external', (_e, url) => shell.openExternal(url));
ipcMain.on('open-path',     (_e, p)   => shell.showItemInFolder(p));

// ── Settings ──────────────────────────────────────────────────
ipcMain.handle('get-settings', () => store.getSettings());
ipcMain.handle('save-settings', (_e, s) => { store.saveSettings(s); return { ok: true }; });
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// ── Search ────────────────────────────────────────────────────
ipcMain.handle('search', async (_e, { query, page, source }) => {
  try {
    const enc = encodeURIComponent(query);
    const src = source || store.getSettings().source || 'steamunlocked';
    let url;
    if (src === 'ankergames') {
      url = page <= 1
        ? `https://ankergames.net/search/${enc}`
        : `https://ankergames.net/search/${enc}?page=${page}`;
    } else {
      url = page <= 1
        ? `https://steamunlocked.org/?s=${enc}`
        : `https://steamunlocked.org/page/${page}/?s=${enc}`;
    }
    const { statusCode, body } = await fetchPage(url);
    console.log(`[search] ${src} status=${statusCode} bodyLen=${body.length} url=${url}`);
    if (statusCode === 404 || (body.includes('404') && body.toLowerCase().includes('not found')))
      return { games: [], hasMore: false };
    if (statusCode >= 500)
      return { games: [], hasMore: false, error: `${src === 'ankergames' ? 'AnkerGames' : 'SteamUnlocked'} is currently down (HTTP ${statusCode}). Try switching sources in Settings or try again later.` };
    // Dump first 2000 chars of body to console so HTML structure is visible in DevTools
    console.log('[search] body preview:', body.substring(0, 2000));
    // Report which split pattern was detected
    if (src !== 'ankergames') {
      const hasA    = body.includes('<a class="cover-item"');
      const hasDiv  = body.includes('<div class="cover-item category">');
      const hasDiv2 = body.includes('<div class="cover-item">');
      console.log(`[search] cover-item patterns: a=${hasA} divCat=${hasDiv} div=${hasDiv2}`);
    }
    let games;
    if (src === 'ankergames') games = parseAnkerGames(body);
    else games = parseGames(body);
    console.log(`[search] parsed ${games.length} games`);
    return { games, hasMore: games.length > 0 };
  } catch (err) {
    return { games: [], hasMore: false, error: err.message };
  }
});

// ── Get game page info ────────────────────────────────────────
ipcMain.handle('get-game-page', async (_e, gameUrl) => {
  try {
    const { statusCode, body } = await fetchPage(gameUrl);
    if (statusCode !== 200) return { error: 'Page not found' };

    if (gameUrl.includes('ankergames.net')) {
      return parseAnkerGamesPage(body, gameUrl);
    }

    const allHrefs = [...body.matchAll(/href="(https?:\/\/[^"]{10,})"/g)].map(m => m[1]);
    const downloadHints = allHrefs.filter(h => /download|upload|haven|file/i.test(h));

    const dlM = body.match(/class="btn-download"[^>]*href="([^"]+)"/)
             || body.match(/href="([^"]+)"[^>]*class="btn-download"/)
             || body.match(/btn-download[^>]*href="([^"]+)"/)
             || body.match(/"(https?:\/\/uploadhaven\.com\/[^"]+)"/)
             || body.match(/"(https?:\/\/[^"]*upload[^"]+\.php[^"]*)"/)
             || body.match(/href="(https?:\/\/[^"]*(?:download|file)[^"]*)"/)
             || (downloadHints.length > 0 ? [null, downloadHints[0]] : null);

    const screenshots = [];
    const seenUrls = new Set();
    const screenshotRe = /(?:data-wpfc-original-src|src)="(https?:\/\/steamunlocked\.org\/wp-content\/uploads\/[^"]+\.(?:jpg|png|webp))"/gi;
    let sm;
    while ((sm = screenshotRe.exec(body)) !== null) {
      const src = sm[1];
      if (src.includes('-300x') || src.includes('-150x') || src.includes('-768x') ||
          src.includes('-100x') || src.includes('-384x') ||
          src.toLowerCase().includes('logo') || src.toLowerCase().includes('banner') ||
          seenUrls.has(src)) continue;
      seenUrls.add(src);
      screenshots.push(src);
    }
    const screenshotsOnly = screenshots.slice(1);

    let descriptionHtml = null;
    const blogM = body.match(/<div[^>]+class="blog-content"[^>]*>([\s\S]*?)<\/div>\s*(?=<div|<section|<footer|$)/i);
    if (blogM) {
      const blogHtml = blogM[0];
      const afterHeading = blogHtml.match(/Game Overview<\/h\d>([\s\S]*)/i);
      if (afterHeading) {
        const beforeImg = afterHeading[1].split(/<img/i)[0];
        const text = beforeImg.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#\d+;/g,'').replace(/&[a-z]+;/g,'').trim();
        if (text) descriptionHtml = text;
      }
    }

    const sizeM   = body.match(/Size:\s*([\d.,]+\s*[GMKBT]+)/i);
    const bannerM = body.match(/property="og:image"\s+content="([^"]+)"/)
                 || body.match(/content="([^"]+)"\s+property="og:image"/);

    const sysReqItems = [];
    const sysReqSection = body.match(/System Requirements[\s\S]{0,8000}/i);
    if (sysReqSection) {
      const chunk = sysReqSection[0];
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liM;
      while ((liM = liRe.exec(chunk)) !== null) {
        const raw = liM[1];
        if (/64.bit processor and operating system/i.test(raw)) continue;
        const strongM = raw.match(/<strong[^>]*>([\s\S]*?)<\/strong>([\s\S]*)/i);
        if (strongM) {
          const label = strongM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/:$/, '').trim();
          const value = strongM[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          if (label && value) { sysReqItems.push({ label, value }); continue; }
        }
        const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!text || text.length < 3 || text.length > 300) continue;
        const colonIdx = text.indexOf(':');
        if (colonIdx > 0 && colonIdx < 30) {
          const label = text.slice(0, colonIdx).trim();
          const value = text.slice(colonIdx + 1).trim();
          if (label && value) sysReqItems.push({ label, value });
        }
      }
    }

    return {
      downloadUrl:  dlM     ? dlM[1]                      : null,
      size:         sizeM   ? sizeM[1].trim()              : null,
      bannerImage:  bannerM ? bannerM[1]                   : null,
      description:  descriptionHtml,
      screenshots:  screenshotsOnly.slice(0, 3),
      sysReqItems,
    };
  } catch (err) {
    return { error: err.message };
  }
});

// ── Fetch AnkerGames upcoming page ────────────────────────────
ipcMain.handle('fetch-upcoming', async () => {
  try {
    const { statusCode, body } = await fetchPage('https://ankergames.net/upcoming');
    if (statusCode !== 200) return { games: [], error: `HTTP ${statusCode}` };
    return { games: parseAnkerUpcoming(body) };
  } catch (err) {
    return { games: [], error: err.message };
  }
});

// ── Fetch discovery data ──────────────────────────────────────
ipcMain.handle('fetch-discovery', async () => {
  try {
    const [ankerRes, steamRes] = await Promise.allSettled([
      fetchPage('https://ankergames.net'),
      fetchPage('https://steamunlocked.org'),
    ]);
    const anker = ankerRes.status === 'fulfilled' && ankerRes.value.statusCode === 200
      ? parseAnkerGamesHome(ankerRes.value.body)
      : { trending: [], latest: [] };
    const steam = steamRes.status === 'fulfilled' && steamRes.value.statusCode === 200
      ? parseSteamUnlockedHome(steamRes.value.body)
      : { recent: [], popular: [] };
    return { ok: true, ...anker, ...steam };
  } catch (err) {
    return { ok: false, trending: [], latest: [], recent: [], popular: [] };
  }
});

// ── Scan games folder for manually added games ────────────────
ipcMain.handle('scan-library', async () => {
  const installBase = getInstallDir();
  if (!fs.existsSync(installBase)) return { added: 0 };
  const existing = store.getLibrary();
  const existingIds = new Set(existing.map(e => e.id));
  let added = 0;
  const entries = fs.readdirSync(installBase, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderId = entry.name;
    if (existingIds.has(folderId)) continue;
    const installDir = path.join(installBase, folderId);
    const title = folderId.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const execPath = findExecutable(installDir, title) || null;
    store.upsertLibrary(folderId, {
      id: folderId, title, status: 'installed', statusMsg: 'Installed (manual)',
      installDir, execPath, addedAt: new Date().toISOString(), scanned: true,
    });
    existingIds.add(folderId);
    added++;
  }
  sendMain('library-updated');
  return { added };
});

// ── Library management ────────────────────────────────────────
ipcMain.handle('get-library', () => store.getLibrary());
ipcMain.handle('get-wishlist', () => store.getWishlist());
ipcMain.handle('is-wishlisted', (_e, id) => store.isWishlisted(id));
ipcMain.handle('toggle-wishlist', (_e, game) => store.toggleWishlist(game));

ipcMain.handle('remove-game', (_e, id) => {
  store.removeLibrary(id);
  sendMain('library-updated');
  return { ok: true };
});

ipcMain.handle('uninstall-game', async (_e, id) => {
  const entry = store.getLibraryEntry(id);
  if (entry && entry.installDir) {
    try { fs.rmSync(entry.installDir, { recursive: true, force: true }); } catch {}
  }
  if (entry && entry.zipPath) {
    try { fs.unlinkSync(entry.zipPath); } catch {}
  }
  store.upsertLibrary(id, { status: 'failed', statusMsg: 'Uninstalled', installDir: null, execPath: null });
  sendMain('library-updated');
  return { ok: true };
});

ipcMain.handle('launch-game', (_e, id) => {
  const entry = store.getLibraryEntry(id);
  if (!entry) return { error: 'Game not found' };
  if (entry.execPath && fs.existsSync(entry.execPath)) {
    try { shell.openPath(entry.execPath); return { ok: true }; } catch {}
  }
  if (entry.installDir && fs.existsSync(entry.installDir)) {
    const found = findExecutable(entry.installDir, entry.title);
    if (found) {
      store.upsertLibrary(id, { execPath: found });
      try { shell.openPath(found); return { ok: true }; } catch {}
    }
  }
  return { error: 'No executable found' };
});

// ── Pause / Resume (aria2c: kill proc and store progress, resume = re-download with continue) ──
function killDownload(gameId) {
  const dl = activeDownloads.get(gameId);
  if (!dl) return;
  // Kill aria2c process if running
  try { if (dl.proc && !dl.proc.killed) dl.proc.kill(); } catch {}
  // Cancel Electron DownloadItem if in built-in mode
  try { if (dl.item) dl.item.cancel(); } catch {}
  // Destroy hidden window if still in preparing phase
  try { if (dl.window && !dl.window.isDestroyed()) dl.window.destroy(); } catch {}
}

ipcMain.handle('pause-download', (_e, gameId) => {
  const dl = activeDownloads.get(gameId);
  if (!dl) return { ok: true };

  if (dl.item) {
    // Electron built-in: use native pause
    try { dl.item.pause(); } catch {}
    dl.paused = true;
    dl.status = 'paused';
  } else if (dl.proc) {
    // aria2c: kill the process — --continue=true will resume from partial file
    try { dl.proc.kill(); } catch {}
    dl.paused = true;
    dl.status = 'paused';
  } else {
    // Still in preparing phase (hidden window clicking buttons) — cancel it fully
    // Can't meaningfully pause here; treat as cancel and let user retry
    killDownload(gameId);
    activeDownloads.delete(gameId);
    store.upsertLibrary(gameId, { status: 'failed', statusMsg: 'Cancelled during preparation' });
    sendMain('library-updated');
    return { ok: true };
  }

  store.upsertLibrary(gameId, { status: 'paused', statusMsg: 'Paused — resume to continue' });
  sendMain('library-updated');
  return { ok: true };
});

ipcMain.handle('resume-download', (_e, gameId) => {
  const dl = activeDownloads.get(gameId);
  if (!dl || !dl.paused) return { error: 'No paused download found' };

  if (dl.item) {
    // Electron built-in: native resume
    try { dl.item.resume(); } catch {}
    dl.paused = false;
    dl.status = 'downloading';
    store.upsertLibrary(gameId, { status: 'downloading', statusMsg: 'Resuming…' });
    sendMain('library-updated');
    return { ok: true };
  }

  // aria2c: need the original file URL to re-spawn
  if (!dl.fileUrl) return { error: 'Cannot resume — original URL not stored' };

  dl.paused = false;
  dl.status = 'downloading';
  store.upsertLibrary(gameId, { status: 'downloading', statusMsg: 'Resuming…' });
  sendMain('library-updated');

  runAria2AndExtract({
    fileUrl:    dl.fileUrl,
    filename:   dl.filename,
    refererUrl: dl.refererUrl,
    cookies:    dl.cookies,
    gameId,
    title:      dl.title,
  });

  return { ok: true };
});

// ── Cancel download ───────────────────────────────────────────
ipcMain.handle('cancel-download', (_e, gameId) => {
  killDownload(gameId);
  activeDownloads.delete(gameId);
  store.upsertLibrary(gameId, { status: 'cancelled', statusMsg: 'Cancelled' });
  sendMain('library-updated');
  return { ok: true };
});

// ── aria2c + extract pipeline ─────────────────────────────────
// Called once we have the real direct file URL.
async function runAria2AndExtract({ fileUrl, filename, refererUrl, cookies, gameId, title }) {
  const installBase = getInstallDir();
  const tempDir     = app.getPath('temp');
  const zipPath     = path.join(tempDir, filename);

  // Store state so pause/resume/cancel can reference it
  const entry = activeDownloads.get(gameId) || {};
  entry.fileUrl    = fileUrl;
  entry.filename   = filename;
  entry.refererUrl = refererUrl;
  entry.cookies    = cookies;
  entry.title      = title;
  entry.zipPath    = zipPath;
  entry.status     = 'downloading';
  activeDownloads.set(gameId, entry);

  store.upsertLibrary(gameId, { status: 'downloading', statusMsg: '0%', zipPath, filename });
  sendMain('library-updated');

  try {
    await aria2Download({ fileUrl, destDir: tempDir, filename, refererUrl, cookies, gameId, title });
  } catch (err) {
    if (err.message === 'cancelled') return; // user cancelled — already handled
    if (activeDownloads.get(gameId)?.paused) return; // user paused — don't mark failed

    store.upsertLibrary(gameId, { status: 'failed', statusMsg: err.message });
    sendMain('download-done', { gameId, state: 'failed' });
    sendMain('library-updated');
    activeDownloads.delete(gameId);
    return;
  }

  // Send a final pct:100 progress event so the renderer's hasActiveDownload guard
  // (which blocks library rebuilds while pct is 1–99) knows the download is done.
  // aria2c doesn't always emit a 100% line before exiting, so we send it explicitly.
  sendMain('download-progress', { gameId, pct: 100, speed: '', eta: '', msg: '100%  Download complete' });

  // ── Extract ───────────────────────────────────────────────
  const installDir = path.join(installBase, gameId);
  fs.mkdirSync(installDir, { recursive: true });

  store.upsertLibrary(gameId, { status: 'extracting', statusMsg: 'Extracting…', percent: 100 });
  sendMain('library-updated');
  sendMain('extract-progress', { gameId, msg: 'Extracting files…' });

  const extractHeartbeat = setInterval(() => {
    sendMain('extract-progress', { gameId, msg: 'Extracting files…' });
  }, 3000);

  try {
    await extractArchive(zipPath, installDir, msg => sendMain('extract-progress', { gameId, msg }));
    clearInterval(extractHeartbeat);

    const execPath = findExecutable(installDir, title);
    store.upsertLibrary(gameId, { status: 'installed', statusMsg: 'Installed', installDir, execPath, zipPath });
    sendMain('download-done', { gameId, state: 'completed', installDir, execPath });
    sendMain('library-updated');
  } catch (err) {
    clearInterval(extractHeartbeat);
    store.upsertLibrary(gameId, { status: 'failed', statusMsg: `Extract failed: ${err.message}` });
    sendMain('download-done', { gameId, state: 'failed' });
    sendMain('library-updated');
  }

  activeDownloads.delete(gameId);
}

// ── Start download ────────────────────────────────────────────
ipcMain.handle('start-download', (_e, { uploadhavenUrl, downloadUrl, steamunlockedUrl, gameUrl, gameId, title, coverImage, source }) => {
  if (activeDownloads.has(gameId)) return { error: 'Already downloading' };

  const dlUrl      = downloadUrl || uploadhavenUrl;
  const refererUrl = gameUrl || steamunlockedUrl || '';

  const installBase = getInstallDir();
  fs.mkdirSync(installBase, { recursive: true });

  store.upsertLibrary(gameId, {
    title, coverImage, gameUrl: refererUrl,
    status: 'preparing', statusMsg: 'Starting…', addedAt: new Date().toISOString(),
  });
  sendMain('library-updated');

  // ── Phase 1: use a hidden window only to navigate JS-gated pages
  //            and intercept the real CDN file URL from will-download.
  //            Once we have it, destroy the window and hand off to aria2c.
  const partition = `persist:dl-${gameId}-${Date.now()}`;
  const dlSession = session.fromPartition(partition);

  const hiddenWin = new BrowserWindow({
    show: false,
    webPreferences: {
      session: dlSession,
      contextIsolation: false,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  hiddenWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  activeDownloads.set(gameId, { window: hiddenWin, status: 'preparing', paused: false });

  const upd = (statusMsg, status = 'preparing') => {
    store.upsertLibrary(gameId, { status, statusMsg });
    sendMain('download-status', { gameId, msg: statusMsg });
  };

  return new Promise(resolve => {
    let resolved = false;
    const done = r => { if (!resolved) { resolved = true; resolve(r); } };

    // ── Phase 1 complete: will-download fires with the real file URL ──
    dlSession.once('will-download', async (_dlEv, item) => {
      const fileUrl  = item.getURL();
      const filename = item.getFilename();
      const zipPath  = path.join(app.getPath('temp'), filename);

      const settings     = store.getSettings();
      const useAria2     = !!settings.aria2Enabled;
      const aria2Exists  = useAria2 && fs.existsSync(getAria2Path());

      if (useAria2 && aria2Exists) {
        // ── aria2c path ───────────────────────────────────────
        // Cancel Electron's download, hand off to aria2c
        item.cancel();
        if (!hiddenWin.isDestroyed()) hiddenWin.destroy();

        // Collect session cookies for this URL (needed for Gofile etc.)
        let cookieHeader = '';
        try {
          const u       = new URL(fileUrl);
          const cookies = await dlSession.cookies.get({ domain: u.hostname });
          cookieHeader  = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        } catch {}

        upd('Download starting (aria2)…', 'downloading');
        done({ ok: true });

        // Store fileUrl + zipSize so verify can HEAD it later
        const zipSize = item.getTotalBytes() || 0;
        store.upsertLibrary(gameId, { fileUrl, refererUrl, zipSize });

        runAria2AndExtract({ fileUrl, filename, refererUrl, cookies: cookieHeader || undefined, gameId, title });

      } else {
        // ── Electron built-in fallback ────────────────────────
        if (useAria2 && !aria2Exists) {
          upd('aria2c not found — using built-in downloader', 'downloading');
        }

        item.setSavePath(zipPath);
        const dlEntry = activeDownloads.get(gameId);
        if (dlEntry) { dlEntry.item = item; dlEntry.status = 'downloading'; dlEntry.zipPath = zipPath; }

        // Store fileUrl + zipSize so verify can HEAD it later
        const zipSize = item.getTotalBytes() || 0;
        store.upsertLibrary(gameId, { fileUrl, refererUrl, zipSize, status: 'downloading', statusMsg: '0%', zipPath, filename });
        sendMain('library-updated');

        let lastRecv = 0, lastTime = Date.now();

        item.on('updated', (_ev, state) => {
          if (state === 'interrupted') {
            if (item.canResume()) { item.resume(); return; }
            const recv  = item.getReceivedBytes();
            const total = item.getTotalBytes();
            const pct   = total > 0 ? Math.round((recv / total) * 100) : 0;
            const msg   = total > 0
              ? `Connection interrupted — retrying… (${pct}%  ${fmtBytes(recv)} / ${fmtBytes(total)})`
              : `Connection interrupted — retrying… (${fmtBytes(recv)} downloaded)`;
            store.upsertLibrary(gameId, { status: 'downloading', statusMsg: msg, receivedBytes: recv, totalBytes: total, percent: pct, speed: 0 });
            sendMain('download-progress', { gameId, recv, total, pct, state, msg, speed: 0 });
            return;
          }
          const recv  = item.getReceivedBytes();
          const total = item.getTotalBytes();
          const pct   = total > 0 ? Math.round((recv / total) * 100) : 0;
          const now   = Date.now();
          const dt    = (now - lastTime) / 1000;
          const speed = dt > 0 ? (recv - lastRecv) / dt : 0;
          lastRecv = recv; lastTime = now;
          const speedStr = speed > 0 ? ` • ${fmtBytes(speed)}/s` : '';
          const msg = total > 0
            ? `${pct}%  ${fmtBytes(recv)} / ${fmtBytes(total)}${speedStr}`
            : `${fmtBytes(recv)} downloaded${speedStr}`;
          store.upsertLibrary(gameId, { status: 'downloading', statusMsg: msg, receivedBytes: recv, totalBytes: total, percent: pct, speed });
          sendMain('download-progress', { gameId, recv, total, pct, state, msg, speed });
        });

        item.once('done', async (_ev, state) => {
          const ok = state === 'completed';
          if (!ok) {
            const reason = state === 'interrupted' ? 'Interrupted' : state === 'cancelled' ? 'Cancelled' : `Failed (${state})`;
            store.upsertLibrary(gameId, { status: 'failed', statusMsg: reason, zipPath: null });
            sendMain('download-done', { gameId, state });
            sendMain('library-updated');
            activeDownloads.delete(gameId);
            if (!hiddenWin.isDestroyed()) hiddenWin.destroy();
            return;
          }

          const installDir = path.join(installBase, gameId);
          fs.mkdirSync(installDir, { recursive: true });
          store.upsertLibrary(gameId, { status: 'extracting', statusMsg: 'Extracting…', percent: 100 });
          sendMain('library-updated');
          sendMain('extract-progress', { gameId, msg: 'Extracting files…' });

          const extractHeartbeat = setInterval(() => {
            sendMain('extract-progress', { gameId, msg: 'Extracting files…' });
          }, 3000);

          try {
            await extractArchive(zipPath, installDir, msg => sendMain('extract-progress', { gameId, msg }));
            clearInterval(extractHeartbeat);
            const execPath = findExecutable(installDir, title);
            store.upsertLibrary(gameId, { status: 'installed', statusMsg: 'Installed', installDir, execPath, zipPath });
            sendMain('download-done', { gameId, state: 'completed', installDir, execPath });
            sendMain('library-updated');
          } catch (err) {
            clearInterval(extractHeartbeat);
            store.upsertLibrary(gameId, { status: 'failed', statusMsg: `Extract failed: ${err.message}` });
            sendMain('download-done', { gameId, state: 'failed' });
            sendMain('library-updated');
          }

          activeDownloads.delete(gameId);
          if (!hiddenWin.isDestroyed()) hiddenWin.destroy();
        });

        done({ ok: true, zipPath });
      }
    });

    // ── Navigate hidden window to trigger the download button chain ──
    const isGofile     = dlUrl ? dlUrl.includes('gofile.io')     : false;
    const isAnkerGames = refererUrl && refererUrl.includes('ankergames.net');

    if (isAnkerGames) {
      upd('Loading AnkerGames page…');
      hiddenWin.loadURL(refererUrl, { httpReferrer: 'https://ankergames.net/' });
    } else if (isGofile) {
      upd('Resolving Gofile link…');
      (async () => {
        try {
          const gofileIdM = dlUrl.match(/gofile\.io\/d\/([A-Za-z0-9]+)/);
          if (!gofileIdM) throw new Error('Could not parse Gofile content ID');
          const contentId = gofileIdM[1];

          upd('Getting Gofile token…');
          const tokenRes  = await net.fetch('https://api.gofile.io/accounts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
          });
          const tokenJson = await tokenRes.json();
          const token     = tokenJson?.data?.token;
          if (!token) throw new Error('Failed to get Gofile token');

          upd('Fetching Gofile metadata…');
          const crypto   = require('crypto');
          const password = crypto.createHash('sha256').update('steamrip').digest('hex');
          const metaRes  = await net.fetch(
            `https://api.gofile.io/contents/${contentId}?wt=4fd6sg89d7s6&cache=true&password=${password}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const metaJson = await metaRes.json();
          if (metaJson?.status !== 'ok') throw new Error('Gofile error: ' + metaJson?.status);

          const children  = metaJson?.data?.children || {};
          const fileEntry = Object.values(children).find(c => c.type === 'file');
          if (!fileEntry) throw new Error('No files found in Gofile folder');

          upd(`Starting download: ${fileEntry.name}`);
          await dlSession.cookies.set({ url: 'https://gofile.io', name: 'accountToken', value: token });
          hiddenWin.loadURL(fileEntry.link, {
            httpReferrer: 'https://gofile.io/',
            extraHeaders: `Authorization: Bearer ${token}\n`,
          });
        } catch (err) {
          upd(`Gofile error: ${err.message} — trying direct load`);
          hiddenWin.loadURL(dlUrl, { httpReferrer: refererUrl });
        }
      })();
    } else {
      hiddenWin.loadURL(dlUrl, { httpReferrer: refererUrl });
    }

    hiddenWin.webContents.once('did-finish-load', async () => {
      const isBuzzheavier = dlUrl && dlUrl.includes('buzzheavier.com');

      if (isAnkerGames) {
        upd('Opening download modal…');
        await sleep(2500);
        for (let attempt = 0; attempt < 15; attempt++) {
          if (!activeDownloads.has(gameId)) return;
          try {
            const res = await hiddenWin.webContents.executeJavaScript(`
              (function() {
                var btn = Array.from(document.querySelectorAll('button')).find(b => {
                  var attr = b.getAttribute('@click') || '';
                  return attr.includes('open-download-modal');
                });
                if (!btn) {
                  btn = Array.from(document.querySelectorAll('button')).find(b =>
                    b.querySelector('span') && b.querySelector('span').textContent.trim() === 'Download'
                  );
                }
                if (!btn) return 'no-modal-btn:' + document.querySelectorAll('button').length;
                btn.click();
                return 'modal-clicked';
              })()
            `);
            if (res === 'modal-clicked') break;
            upd(`Waiting for modal button… (${attempt + 1}) [${res}]`);
          } catch (e) { upd(`JS error step1: ${e.message}`); }
          await sleep(1000);
        }

        await sleep(2000);
        upd('Clicking download in modal…');
        for (let attempt = 0; attempt < 20; attempt++) {
          if (!activeDownloads.has(gameId)) return;
          try {
            const res = await hiddenWin.webContents.executeJavaScript(`
              (function() {
                var btn = Array.from(document.querySelectorAll('a')).find(a => {
                  var attr = a.getAttribute('@click.prevent') || a.getAttribute('@click') || '';
                  return attr.includes('generateDownloadUrl');
                });
                if (!btn) btn = document.querySelector('a.download-button');
                if (!btn) return 'no-dl-btn:' + document.querySelectorAll('a').length;
                btn.click();
                return 'dl-clicked';
              })()
            `);
            if (res === 'dl-clicked') { upd('Waiting for download URL…', 'preparing'); break; }
            upd(`Waiting for download button… (${attempt + 1}) [${res}]`);
          } catch (e) { upd(`JS error step2: ${e.message}`); }
          await sleep(1200);
        }
      } else if (isGofile) {
        return; // already handled above
      } else if (isBuzzheavier) {
        for (let attempt = 0; attempt < 20; attempt++) {
          if (!activeDownloads.has(gameId)) return;
          upd(`Clicking download… (attempt ${attempt + 1})`);
          try {
            const res = await hiddenWin.webContents.executeJavaScript(`
              (function() {
                window.open = function() { return null; };
                var btn = document.querySelector('a[hx-get*="/download"]')
                       || document.querySelector('.link-button')
                       || document.querySelector('a[class*="gay-button"]')
                       || document.querySelector('a[class*="download"]');
                if (!btn) return 'no-button';
                btn.click(); return 'clicked';
              })()
            `);
            if (res === 'clicked') break;
            upd(`Button: ${res}, retrying…`);
          } catch {}
          await sleep(1200);
        }
      } else {
        // SteamUnlocked / UploadHaven — wait for countdown, then click
        await hiddenWin.webContents.executeJavaScript(`
          window.open = function() { return null; };
          window.addEventListener('beforeunload', function(){});
        `);

        for (let i = 16; i > 0; i--) {
          if (!activeDownloads.has(gameId)) return;
          upd(`Waiting for timer… ${i}s`);
          await sleep(1000);
        }

        const clickScript = `
          (function() {
            window.open = function() { return null; };
            var btn =
              document.getElementById('downloadbtn') ||
              document.getElementById('submitFree') ||
              document.querySelector('a#downloadbtn') ||
              document.querySelector('form[method="post"] a') ||
              document.querySelector('a.download-btn') ||
              document.querySelector('a[class*="download-btn"]') ||
              document.querySelector('a[class*="btn-download"]') ||
              document.querySelector('button[type="submit"]') ||
              document.querySelector('input[type="submit"]') ||
              Array.from(document.querySelectorAll('a, button')).find(el => {
                var t = el.textContent.trim().toLowerCase();
                return t === 'free download' || t === 'download now' || t === 'slow download';
              });
            if (!btn) return 'no-button';
            if (btn.disabled) return 'disabled';
            btn.removeAttribute('target');
            btn.click();
            return 'clicked';
          })()
        `;

        let clicked = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          if (!activeDownloads.has(gameId)) return;
          upd(`Clicking Free Download… (attempt ${attempt + 1})`);
          try {
            const res = await hiddenWin.webContents.executeJavaScript(clickScript);
            if (res === 'clicked') { clicked = true; upd('Waiting for download URL…', 'preparing'); break; }
            upd(`Button: ${res}, retrying…`);
          } catch {}
          await sleep(800);
        }

        if (clicked) {
          hiddenWin.webContents.once('did-finish-load', async () => {
            if (!activeDownloads.has(gameId)) return;
            await sleep(1500);
            try { await hiddenWin.webContents.executeJavaScript(clickScript); } catch {}
          });
        }
      }

      // Safety timeout — if will-download never fires, give up
      await sleep(90_000);
      if (activeDownloads.has(gameId) && !activeDownloads.get(gameId).fileUrl) {
        store.upsertLibrary(gameId, { status: 'failed', statusMsg: 'Timed out waiting for download URL' });
        sendMain('download-done', { gameId, state: 'failed' });
        sendMain('library-updated');
        activeDownloads.delete(gameId);
        if (!hiddenWin.isDestroyed()) hiddenWin.destroy();
        done({ error: 'Timed out' });
      }
    });

    hiddenWin.webContents.on('did-fail-load', (_e2, errorCode, desc, _validatedUrl, isMainFrame) => {
      // Ignore subframe/resource failures (ads, tracking pixels, CDN assets, etc.)
      if (!isMainFrame) return;
      // ERR_ABORTED (-3) fires normally when a download starts intercepting the navigation
      if (errorCode === -3) return;
      // If will-download already fired and we have the file URL, hidden window is done — ignore
      if (!activeDownloads.has(gameId)) return;
      if (activeDownloads.get(gameId).fileUrl) return;
      store.upsertLibrary(gameId, { status: 'failed', statusMsg: desc });
      sendMain('download-done', { gameId, state: 'failed' });
      sendMain('library-updated');
      activeDownloads.delete(gameId);
      done({ error: desc });
    });
  });
});

// ── DevTools Panel ─────────────────────────────────────────────
// Ctrl+Shift+D  →  toggle devtools overlay in the renderer
// IPC: check-aria2, get-devtools-info, capture-scraper-preview,
//      open-devtools (open Electron's own DevTools for debugging)

ipcMain.handle('check-aria2', () => {
  const aria2Path = getAria2Path();
  const exists    = fs.existsSync(aria2Path);
  const settings  = store.getSettings();
  return {
    exists,
    enabled: !!settings.aria2Enabled,
    path: aria2Path,
  };
});

ipcMain.handle('get-devtools-info', () => {
  const aria2Path   = getAria2Path();
  const aria2Exists = fs.existsSync(aria2Path);
  const settings    = store.getSettings();

  const sevenZipPath   = get7ZipPath();
  const sevenZipExists = fs.existsSync(sevenZipPath);

  // Collect info about active downloads / hidden scraper windows
  const downloads = [];
  for (const [gameId, entry] of activeDownloads.entries()) {
    let scraperUrl = null;
    try {
      if (entry.window && !entry.window.isDestroyed()) {
        scraperUrl = entry.window.webContents.getURL();
      }
    } catch {}
    downloads.push({
      gameId,
      status:    entry.status  || 'unknown',
      paused:    !!entry.paused,
      scraperUrl,
    });
  }

  return {
    aria2: {
      exists:  aria2Exists,
      enabled: !!settings.aria2Enabled,
      path:    aria2Path,
    },
    sevenZip: {
      exists:  sevenZipExists,
      enabled: settings.sevenZipEnabled !== false,
      path:    sevenZipPath,
    },
    activeDownloads: downloads,
    settings: {
      source:      settings.source      || 'steamunlocked',
      installPath: settings.installPath || '(default)',
    },
    platform: process.platform,
    electron: process.versions.electron,
    node:     process.versions.node,
  };
});

ipcMain.handle('capture-scraper-preview', async (_e, gameId) => {
  try {
    const entry = gameId
      ? activeDownloads.get(gameId)
      : [...activeDownloads.values()].find(e => e.window && !e.window.isDestroyed());

    if (!entry || !entry.window || entry.window.isDestroyed()) {
      return { error: 'No active scraper window found' };
    }

    const wc  = entry.window.webContents;
    const url = wc.getURL();

    // Capture a screenshot of the hidden scraper window as base64 PNG
    const img = await wc.capturePage();
    const b64 = img.toJPEG(70).toString('base64');

    return { ok: true, url, snapshot: `data:image/jpeg;base64,${b64}` };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.on('open-devtools', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
});

// Register global shortcut after window is ready
app.whenReady().then(() => {
  // Ctrl+Shift+D — toggle the in-app devtools panel
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    sendMain('toggle-devtools-panel');
  });

  // Ctrl+Shift+I — open Electron's native DevTools (detached)
  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// ── Verify Install ─────────────────────────────────────────────
// HEAD the stored fileUrl to get current Content-Length,
// walk installDir to get on-disk size, and compare.
ipcMain.handle('verify-install', async (_e, gameId) => {
  const entry = store.getLibraryEntry(gameId);
  if (!entry) return { error: 'Game not found in library.' };
  if (entry.status !== 'installed') return { error: 'Game is not installed.' };

  const { installDir, fileUrl, refererUrl, zipSize: storedZipSize } = entry;

  // ── Step 1: check installDir exists on disk ───────────────
  if (!installDir || !fs.existsSync(installDir)) {
    return {
      verdict: 'missing',
      detail: 'Install folder not found on disk.',
      installDir,
    };
  }

  // ── Step 2: sum all files in installDir ───────────────────
  function dirSize(dir) {
    let total = 0;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          total += dirSize(full);
        } else if (entry.isFile()) {
          try { total += fs.statSync(full).size; } catch {}
        }
      }
    } catch {}
    return total;
  }
  const diskSize = dirSize(installDir);

  // ── Step 3: HEAD the download URL ─────────────────────────
  let serverZipSize = null;
  let headError     = null;

  if (fileUrl) {
    try {
      serverZipSize = await new Promise((resolve, reject) => {
        const req = net.request({ method: 'HEAD', url: fileUrl });
        req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        if (refererUrl) req.setHeader('Referer', refererUrl);
        const timer = setTimeout(() => { req.abort(); reject(new Error('HEAD request timed out')); }, 10000);
        req.on('response', res => {
          clearTimeout(timer);
          const cl = parseInt(res.headers['content-length'] || '0', 10);
          resolve(cl || null);
        });
        req.on('error', err => { clearTimeout(timer); reject(err); });
        req.end();
      });
    } catch (err) {
      headError = err.message;
    }
  } else {
    headError = 'No download URL stored — find this game in the store and re-download to enable server checks';
  }

  // ── Step 4: determine verdict ─────────────────────────────
  const zipChanged   = serverZipSize && storedZipSize && serverZipSize !== storedZipSize;
  const diskTooSmall = storedZipSize && diskSize < storedZipSize * 0.5;

  let verdict;
  if (!installDir || !fs.existsSync(installDir)) {
    verdict = 'missing';
  } else if (diskTooSmall) {
    verdict = 'corrupt';
  } else if (zipChanged) {
    verdict = 'outdated';
  } else {
    verdict = 'ok';
  }

  return {
    verdict,
    diskSize,
    serverZipSize,
    storedZipSize: storedZipSize || null,
    zipChanged,
    headError: headError || null,
    installDir,
    fileUrl: fileUrl || null,
  };
});
