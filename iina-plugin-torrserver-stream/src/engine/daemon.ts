import { TorrentFileItem } from './types';

export interface DaemonConfig {
  engineType: 'embedded' | 'torrserver';
  torrserverUrl: string;
  cacheSizeMb: number;
  storageMode: 'ram' | 'disk';
  port: number;
}

export class DaemonManager {
  private isRunning: boolean = false;
  private currentPort: number = 8095;
  private baseUrl: string = 'http://127.0.0.1:8095';

  constructor() {
    this.currentPort = 8095;
    this.baseUrl = preferences.get('torrserverUrl') || `http://127.0.0.1:${this.currentPort}`;
  }

  public getBaseUrl(): string {
    const engineType = preferences.get('engineType') || 'embedded';
    if (engineType === 'torrserver') {
      return preferences.get('torrserverUrl') || 'http://127.0.0.1:8090';
    }
    return `http://127.0.0.1:${this.currentPort}`;
  }

  /**
   * Start local daemon if embedded mode is selected
   */
  public async ensureRunning(): Promise<boolean> {
    const engineType = preferences.get('engineType') || 'embedded';
    if (engineType === 'torrserver') {
      return await this.ping(this.getBaseUrl());
    }

    if (this.isRunning) {
      const alive = await this.ping(this.baseUrl);
      if (alive) return true;
      this.isRunning = false;
    }

    // First, check if already running on either port
    if (await this.ping(this.baseUrl)) {
      this.isRunning = true;
      return true;
    }
    if (await this.ping('http://127.0.0.1:8090')) {
      this.baseUrl = 'http://127.0.0.1:8090';
      this.isRunning = true;
      return true;
    }

    // Check possible binary locations
    const candidatePaths = [
      '/opt/homebrew/bin/torrserver',
      '/usr/local/bin/torrserver',
      utils.resolvePath('@data/bin/torrserver')
    ];

    for (const p of candidatePaths) {
      const check = await utils.exec('/bin/test', ['-x', p]).catch(() => null);
      if (check && check.status === 0) {
        return this.spawnDaemon(p);
      }
    }

    if (utils.fileInPath('torrserver')) {
      return this.spawnDaemon('torrserver');
    }

    console.warn('[DaemonManager] TorrServer binary not found in system or plugin paths');
    return false;
  }

  private async spawnDaemon(executable: string): Promise<boolean> {
    const cacheDir = utils.resolvePath('@tmp/torrent-cache');
    await utils.exec('/bin/mkdir', ['-p', cacheDir]).catch(() => null);

    const args = [
      '-p', String(this.currentPort),
      '-d', cacheDir
    ];

    console.log(`[DaemonManager] Spawning ${executable} ${args.join(' ')}`);

    // Do not await long-running daemon exit
    utils.exec(executable, args, null, 
      (data) => console.log(`[daemon out] ${data.trim()}`),
      (err) => console.log(`[daemon err] ${err.trim()}`)
    ).then((res) => {
      console.log(`[DaemonManager] Daemon exited with status ${res.status}`);
      this.isRunning = false;
    }).catch((e) => {
      console.error('[DaemonManager] Daemon error:', e);
      this.isRunning = false;
    });

    // Poll for readiness
    for (let i = 0; i < 20; i++) {
      await this.sleep(300);
      if (await this.ping(this.getBaseUrl())) {
        this.isRunning = true;
        console.log('[DaemonManager] Daemon is ready on ' + this.getBaseUrl());
        return true;
      }
    }

    console.warn('[DaemonManager] Daemon failed to start within timeout');
    return false;
  }

  public async ping(url: string): Promise<boolean> {
    try {
      const res = await utils.exec('curl', [
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

  /**
   * Upload .torrent file to daemon and retrieve info hash and file list
   */
  public async uploadTorrentFile(torrentFilePath: string): Promise<{ hash: string; files: TorrentFileItem[] }> {
    const url = `${this.getBaseUrl()}/torrent/upload`;
    console.log(`[DaemonManager] Uploading ${torrentFilePath} to ${url}`);

    // Copy to universal /tmp path with plain ASCII filename
    const cleanUploadPath = '/tmp/torrserver_current.torrent';
    await utils.exec('/bin/cp', ['-f', torrentFilePath, cleanUploadPath]).catch(() => null);

    const fileToUpload = cleanUploadPath;

    // Upload via curl with -g (globoff) to prevent any bracket parsing
    const res = await utils.exec('curl', [
      '-s',
      '-g',
      '-X', 'POST',
      '--header', 'Accept: application/json',
      '-F', `file=@${fileToUpload}`,
      url
    ]);

    if (res.status !== 0 || !res.stdout) {
      throw new Error(`Failed to upload torrent: ${res.stderr || 'No response'}`);
    }

    try {
      const data = JSON.parse(res.stdout);
      const hash = data.hash || data.Hash || '';
      const files: TorrentFileItem[] = [];

      const rawFiles = data.file_stats || data.files || [];
      rawFiles.forEach((f: any, idx: number) => {
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
    } catch (e) {
      throw new Error(`Failed to parse daemon response: ${e}`);
    }
  }

  /**
   * Add a magnet link or HTTP link to TorrServer and wait for metadata
   */
  public async addLinkAndGetFiles(link: string): Promise<{ hash: string; title: string; files: TorrentFileItem[] }> {
    const baseUrl = this.getBaseUrl();
    
    // 1. Add torrent
    const addRes = await utils.exec('curl', [
      '-s', '-X', 'POST',
      '--header', 'Content-Type: application/json',
      '-d', JSON.stringify({ action: 'add', link: link, save_to_db: true }),
      `${baseUrl}/torrents`
    ]);

    if (addRes.status !== 0 || !addRes.stdout) {
      throw new Error(`Failed to add link to TorrServer`);
    }

    let hash = '';
    let title = '';
    try {
      const data = JSON.parse(addRes.stdout);
      hash = data.hash || data.Hash || '';
      title = data.title || data.Title || '';
    } catch {
      throw new Error(`Invalid response when adding link`);
    }

    if (!hash) {
      throw new Error(`TorrServer did not return a hash`);
    }

    // 2. Poll for metadata
    console.log(`[DaemonManager] Waiting for metadata for hash ${hash}...`);
    for (let i = 0; i < 30; i++) { // wait up to ~30 seconds
      await this.sleep(1000);
      
      const statRes = await utils.exec('curl', [
        '-s', '-X', 'POST',
        '--header', 'Content-Type: application/json',
        '-d', JSON.stringify({ action: 'get', hash: hash }),
        `${baseUrl}/torrents`
      ]);

      if (statRes.status === 0 && statRes.stdout) {
        try {
          const data = JSON.parse(statRes.stdout);
          const torrentNode = data.title !== undefined ? data : (data[0] || {}); // Sometimes returns array, sometimes object
          const rawFiles = torrentNode.file_stats || torrentNode.files || [];
          
          if (rawFiles.length > 0) {
            title = torrentNode.title || torrentNode.name || title;
            const files: TorrentFileItem[] = [];
            rawFiles.forEach((f: any, idx: number) => {
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
            
            // Only return video files to avoid showing NFOs/JPEGs
            const videoFiles = files.filter(f => f.isVideo);
            return { hash, title, files: videoFiles.length > 0 ? videoFiles : files };
          }
        } catch (e) {
          console.warn('[DaemonManager] Polling parse error:', e);
        }
      }
    }

    throw new Error('Таймаут получения списка файлов (нет пиров или плохая сеть)');
  }

  /**
   * Generate streaming URL for the player
   */
  public getStreamUrl(hash: string, fileId: number = 0): string {
    return `${this.getBaseUrl()}/stream?link=${hash}&index=${fileId}&play`;
  }

  /**
   * Get M3U playlist URL for multi-episode releases (series)
   */
  public getPlaylistUrl(hash: string): string {
    return `${this.getBaseUrl()}/stream?m3u&link=${hash}`;
  }

  /**
   * Stop torrent and drop cache
   */
  public async dropTorrent(hash: string): Promise<void> {
    try {
      await utils.exec('curl', [
        '-s',
        '-X', 'POST',
        '--header', 'Content-Type: application/json',
        '-d', JSON.stringify({ hash }),
        `${this.getBaseUrl()}/torrents/drop`
      ]);
    } catch (e) {
      console.warn('[DaemonManager] Failed to drop torrent:', e);
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
