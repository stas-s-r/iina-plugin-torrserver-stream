// Pure JavaScript TorrServer Plugin for IINA (Global Entry)
const { menu, standaloneWindow, utils, http, file, global: iinaGlobal, core } = iina;

class DaemonManager {
  constructor() {
    this.isRunning = false;
    this.baseUrl = 'http://127.0.0.1:8090';
  }

  async ensureRunning() {
    if (await this.ping(this.baseUrl)) {
      this.isRunning = true;
      return true;
    }
    if (await this.ping('http://127.0.0.1:8095')) {
      this.baseUrl = 'http://127.0.0.1:8095';
      this.isRunning = true;
      return true;
    }

    const candidatePaths = [
      '/opt/homebrew/bin/torrserver',
      '/usr/local/bin/torrserver'
    ];

    for (const p of candidatePaths) {
      const check = await utils.exec('/bin/test', ['-x', p]).catch(() => null);
      if (check && check.status === 0) {
        return this.spawnDaemon(p);
      }
    }

    return false;
  }

  async spawnDaemon(executable) {
    const cacheDir = '/tmp/torrserver-db';
    await utils.exec('/bin/mkdir', ['-p', cacheDir]).catch(() => null);

    const args = ['-p', '8090', '-d', cacheDir];
    utils.exec(executable, args, null).catch(() => {});

    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (await this.ping('http://127.0.0.1:8090')) {
        this.baseUrl = 'http://127.0.0.1:8090';
        this.isRunning = true;
        return true;
      }
    }
    return false;
  }

  async ping(url) {
    try {
      const res = await utils.exec('/usr/bin/curl', [
        '-s',
        '-o', '/dev/null',
        '-w', '%{http_code}',
        '--connect-timeout', '1',
        `${url}/echo`
      ]);
      const code = parseInt((res.stdout || '').trim(), 10);
      return code === 200 || code === 404;
    } catch {
      return false;
    }
  }

  async uploadTorrentFile(torrentFilePath) {
    const url = `${this.baseUrl}/torrent/upload`;
    const cleanUploadPath = '/tmp/torrserver_current.torrent';
    
    if (torrentFilePath !== cleanUploadPath) {
      await utils.exec('/bin/cp', ['-f', torrentFilePath, cleanUploadPath]).catch(() => null);
    }

    const res = await utils.exec('/usr/bin/curl', [
      '-s',
      '-g',
      '-X', 'POST',
      '--header', 'Accept: application/json',
      '-F', `file=@${cleanUploadPath}`,
      url
    ]);

    if (res.status !== 0 || !res.stdout) {
      throw new Error(`Ошибка загрузки в TorrServer: ${res.stderr || 'Нет ответа'}`);
    }

    let data;
    try {
      data = JSON.parse(res.stdout);
    } catch (err) {
      throw new Error('Некорректный ответ от TorrServer: ' + res.stdout);
    }

    const hash = data.hash || data.Hash || '';
    const rawFiles = data.file_stats || data.files || [];
    const files = [];

    rawFiles.forEach((f, idx) => {
      const name = f.path || f.name || `File ${idx + 1}`;
      const isVideo = /\.(mp4|mkv|avi|mov|m4v|wmv|ts|flv|webm)$/i.test(name);
      const sizeBytes = f.length || f.size || 0;
      files.push({
        id: f.id !== undefined ? f.id : idx,
        name: name.split('/').pop() || name,
        path: name,
        sizeBytes,
        sizeFormatted: this.formatBytes(sizeBytes),
        isVideo
      });
    });

    return { hash, files };
  }

  getStreamUrl(hash, fileId) {
    return `${this.baseUrl}/stream?link=${hash}&index=${fileId}&play`;
  }

  getPlaylistUrl(hash) {
    return `${this.baseUrl}/stream?m3u&link=${hash}`;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

const daemon = new DaemonManager();

function openStream(url) {
  if (typeof core !== 'undefined' && core && typeof core.open === 'function') {
    core.open(url);
    return;
  }

  if (iinaGlobal && typeof iinaGlobal.createPlayerInstance === 'function') {
    iinaGlobal.createPlayerInstance({
      url: url,
      enablePlugins: true
    });
  }
}

function addListeners() {
  standaloneWindow.onMessage('pickFile', async () => {
    try {
      const pickedPath = await utils.chooseFile('Выберите .torrent файл');
      
      if (!pickedPath) {
        standaloneWindow.postMessage('torrentCanceled', {});
        return;
      }

      const ready = await daemon.ensureRunning();
      if (!ready) throw new Error('Не удалось подключиться к TorrServer');

      const uploadRes = await daemon.uploadTorrentFile(pickedPath);
      const hash = uploadRes.hash;
      const files = uploadRes.files.filter(f => f.isVideo);
      const title = pickedPath.split('/').pop() || 'Локальный файл';

      standaloneWindow.postMessage('torrentLoaded', { hash, title, files });
    } catch (err) {
      console.error('[TorrServer Plugin] Error loading torrent via picker:', err);
      standaloneWindow.postMessage('torrentError', { message: err.message || 'Ошибка загрузки' });
    }
  });

  standaloneWindow.onMessage('loadTorrentBase64', async (data) => {
    try {
      if (!data || !data.base64) throw new Error('Файл пустой');

      const tmpB64Path = '/tmp/torrserver_drop.b64';
      const tmpTorrentPath = '/tmp/torrserver_current.torrent';

      if (file && typeof file.write === 'function') {
        file.write(tmpB64Path, data.base64);
      } else {
        await utils.exec('/bin/sh', ['-c', `printf "%s" "${data.base64}" > "${tmpB64Path}"`]);
      }

      await utils.exec('/usr/bin/base64', ['-D', '-i', tmpB64Path, '-o', tmpTorrentPath]);
      await utils.exec('/bin/rm', ['-f', tmpB64Path]).catch(() => null);

      const ready = await daemon.ensureRunning();
      if (!ready) throw new Error('Не удалось подключиться к TorrServer');

      const uploadRes = await daemon.uploadTorrentFile(tmpTorrentPath);
      const hash = uploadRes.hash;
      const files = uploadRes.files.filter(f => f.isVideo);
      const title = data.name || 'Загруженный торрент';

      standaloneWindow.postMessage('torrentLoaded', { hash, title, files });
    } catch (err) {
      console.error('[TorrServer Plugin] Error loading dropped torrent:', err);
      standaloneWindow.postMessage('torrentError', { message: err.message || 'Ошибка загрузки' });
    }
  });

  standaloneWindow.onMessage('playFile', (data) => {
    try {
      let streamUrl = '';
      if (data && data.asPlaylist) {
        streamUrl = daemon.getPlaylistUrl(data.hash);
      } else {
        streamUrl = daemon.getStreamUrl(data.hash, (data && data.fileId) || 0);
      }

      console.log('[TorrServer Plugin] Opening stream URL:', streamUrl);
      openStream(streamUrl);
    } catch (err) {
      console.error('[TorrServer Plugin] Error playing file:', err);
      standaloneWindow.postMessage('torrentError', { message: err.message || 'Ошибка запуска воспроизведения' });
    }
  });
}

// Window initialization
standaloneWindow.loadFile('ui/index.html');
standaloneWindow.setProperty({
  title: 'TorrServer Stream',
  resizable: true,
  fullSizeContentView: false,
  hideTitleBar: false
});
standaloneWindow.setFrame(600, 500);
addListeners();

function openWindow() {
  standaloneWindow.open();
}

async function directStream() {
  try {
    const pickedPath = await utils.chooseFile('Выберите .torrent файл для просмотра');
    if (!pickedPath) return;

    if (typeof core !== 'undefined' && core && typeof core.osd === 'function') {
      core.osd('⏳ Загрузка в TorrServer...');
    }
    const ready = await daemon.ensureRunning();
    if (!ready) throw new Error('TorrServer не запущен');

    const uploadRes = await daemon.uploadTorrentFile(pickedPath);
    const streamUrl = daemon.getPlaylistUrl(uploadRes.hash);
    openStream(streamUrl);
  } catch (e) {
    if (typeof core !== 'undefined' && core && typeof core.osd === 'function') {
      core.osd('❌ Ошибка: ' + (e.message || e));
    } else {
      console.error('[TorrServer Plugin] Direct stream error:', e);
    }
  }
}

// Single registration of menu items (ONLY in global entry)
menu.addItem(
  menu.item(
    'TorrServer: Открыть окно загрузки...',
    () => {
      openWindow();
    },
    { keyBinding: 'Meta+Shift+T' }
  )
);

menu.addItem(
  menu.item(
    'TorrServer: Выбрать .torrent и сразу смотреть',
    () => {
      directStream();
    },
    { keyBinding: 'Meta+Shift+P' }
  )
);
