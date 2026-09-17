import { DaemonManager } from './engine/daemon';

console.log('[TorrServer Stream] Initializing plugin...');

let daemon: DaemonManager | null = null;
let windowInitialized = false;

function getDaemon(): DaemonManager {
  if (!daemon) daemon = new DaemonManager();
  return daemon;
}

function addListeners() {
  // 1. Pick and Load Torrent (from Finder dialog inside window)
  standaloneWindow.onMessage('pickFile', async () => {
    try {
      const pickedPath = utils.chooseFile('Выберите .torrent файл', {
        allowedFileTypes: ['torrent'],
        canChooseFiles: true,
        allowsMultipleSelection: false
      });
      
      if (!pickedPath) {
        standaloneWindow.postMessage('torrentCanceled', {});
        return;
      }

      const d = getDaemon();
      const daemonReady = await d.ensureRunning();
      if (!daemonReady) {
        throw new Error('Не удалось запустить TorrServer.');
      }

      const uploadRes = await d.uploadTorrentFile(pickedPath);
      const hash = uploadRes.hash;
      const files = uploadRes.files.filter(f => f.isVideo);
      const title = pickedPath.split('/').pop() || 'Локальный файл';

      standaloneWindow.postMessage('torrentLoaded', { hash, title, files });
    } catch (err: any) {
      console.error('[TorrServer Plugin] Error loading torrent via picker:', err);
      standaloneWindow.postMessage('torrentError', { message: err.message || 'Ошибка загрузки' });
    }
  });

  // 1b. Load Torrent from Drag & Drop (Base64 from browser drop)
  standaloneWindow.onMessage('loadTorrentBase64', async (data: { name: string, base64: string }) => {
    try {
      if (!data.base64) {
        throw new Error('Файл пустой');
      }

      const tmpB64Path = '/tmp/torrserver_drop.b64';
      const tmpTorrentPath = '/tmp/torrserver_drop.torrent';

      const script = `cat << 'EOF' > "${tmpB64Path}"\n${data.base64}\nEOF\nbase64 -D -i "${tmpB64Path}" -o "${tmpTorrentPath}"\nrm -f "${tmpB64Path}"`;
      const decodeRes = await utils.exec('/bin/sh', ['-c', script]);
      
      if (decodeRes && decodeRes.status !== 0) {
        throw new Error('Ошибка декодирования содержимого .torrent');
      }

      const d = getDaemon();
      const daemonReady = await d.ensureRunning();
      if (!daemonReady) {
        throw new Error('Не удалось запустить TorrServer.');
      }

      const uploadRes = await d.uploadTorrentFile(tmpTorrentPath);
      const hash = uploadRes.hash;
      const files = uploadRes.files.filter(f => f.isVideo);
      const title = data.name || 'Загруженный торрент';

      standaloneWindow.postMessage('torrentLoaded', { hash, title, files });
    } catch (err: any) {
      console.error('[TorrServer Plugin] Error loading dropped torrent:', err);
      standaloneWindow.postMessage('torrentError', { message: err.message || 'Ошибка загрузки' });
    }
  });

  // 2. Play File
  standaloneWindow.onMessage('playFile', async (data: { hash: string, fileId?: number, asPlaylist?: boolean }) => {
    try {
      const d = getDaemon();
      const daemonReady = await d.ensureRunning();
      if (!daemonReady) throw new Error('TorrServer не запущен');

      let streamUrl = '';
      if (data.asPlaylist) {
        streamUrl = d.getPlaylistUrl(data.hash);
      } else {
        streamUrl = d.getStreamUrl(data.hash, data.fileId || 0);
      }

      console.log('[TorrServer Plugin] Opening stream URL:', streamUrl);
      if (typeof core.open === 'function') {
        core.open(streamUrl);
      } else if (typeof (global as any).createPlayerInstance === 'function') {
        (global as any).createPlayerInstance({
          url: streamUrl,
          enablePlugins: true
        });
      }
    } catch (err: any) {
      console.error('[TorrServer Plugin] Error playing file:', err);
      standaloneWindow.postMessage('torrentError', { message: err.message || 'Ошибка запуска воспроизведения' });
    }
  });
}

function openWindow() {
  if (!windowInitialized) {
    addListeners();
    standaloneWindow.setProperty({
      title: 'TorrServer Stream',
      resizable: true,
      fullSizeContentView: false,
      hideTitleBar: false
    });
    standaloneWindow.setFrame(600, 500);
    windowInitialized = true;
  }
  standaloneWindow.loadFile('ui/index.html');
  standaloneWindow.open();
}

async function directStream() {
  try {
    const pickedPath = utils.chooseFile('Выберите .torrent файл для просмотра', {
      allowedFileTypes: ['torrent'],
      canChooseFiles: true,
      allowsMultipleSelection: false
    });
    if (!pickedPath) return;

    core.osd('⏳ Загрузка в TorrServer...');
    const d = getDaemon();
    await d.ensureRunning();
    const uploadRes = await d.uploadTorrentFile(pickedPath);
    const streamUrl = d.getPlaylistUrl(uploadRes.hash);
    core.open(streamUrl);
  } catch (e: any) {
    core.osd('❌ Ошибка: ' + (e.message || e));
  }
}

// Menu 1: Open Window (Drag & Drop or click)
menu.addItem(
  menu.item(
    'TorrServer: Открыть окно загрузки...',
    () => {
      openWindow();
    },
    { keyBinding: 'Meta+Shift+T' }
  )
);

// Menu 2: Fast Finder Play (Direct play without window)
menu.addItem(
  menu.item(
    'TorrServer: Выбрать .torrent и сразу смотреть',
    () => {
      directStream();
    },
    { keyBinding: 'Meta+Shift+P' }
  )
);
