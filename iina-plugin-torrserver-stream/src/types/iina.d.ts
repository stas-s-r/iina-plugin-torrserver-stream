/**
 * IINA Plugin API Type Definitions
 */

declare namespace IINA {
  interface HTTPRequestOption<DataType = Record<string, any>> {
    params?: Record<string, string>;
    headers?: Record<string, string>;
    data?: DataType;
  }

  interface HTTPResponse<DataType = any> {
    text: string;
    data: DataType;
    statusCode: number;
    reason: string;
    headers?: Record<string, string>;
  }

  interface API {
    core: {
      open(url: string): void;
      osd(message: string): void;
      pause(): void;
      resume(): void;
      stop(): void;
      seek(seconds: number, exact?: boolean): void;
      seekTo(seconds: number, exact?: boolean): void;
      status: {
        paused: boolean;
        position: number;
        duration: number;
        url: string;
      };
      window: {
        loaded: boolean;
      };
    };
    event: {
      on(eventName: string, callback: (...args: any[]) => void): void;
      off(eventName: string, callback: (...args: any[]) => void): void;
    };
    mpv: {
      command(name: string, ...args: (string | number | boolean)[]): void;
      getProperty(name: string): any;
      setProperty(name: string, value: any): void;
      addHook(hookName: string, priority: number, callback: () => void): void;
    };
    menu: {
      addItem(item: { title: string; action: () => void }): void;
    };
    sidebar: {
      loadFile(path: string): void;
      postMessage(name: string, data?: any): void;
      onMessage(name: string, callback: (data: any) => void): void;
      show(): void;
      hide(): void;
    };
    standaloneWindow: {
      loadFile(path: string): void;
      postMessage(name: string, data?: any): void;
      onMessage(name: string, callback: (data: any) => void): void;
      open(): void;
      close(): void;
      setTitle(title: string): void;
    };
    http: {
      get<ResData = any>(url: string, options?: HTTPRequestOption): Promise<HTTPResponse<ResData>>;
      post<ResData = any>(url: string, options?: HTTPRequestOption): Promise<HTTPResponse<ResData>>;
      download(url: string, destinationPath: string, options?: HTTPRequestOption): Promise<boolean>;
    };
    utils: {
      exec(
        file: string,
        args: string[],
        cwd?: string | null,
        stdoutHook?: (data: string) => void,
        stderrHook?: (data: string) => void
      ): Promise<{ status: number; stdout: string; stderr: string }>;
      fileInPath(file: string): boolean;
      resolvePath(path: string): string;
      ask(title: string): boolean;
      prompt(title: string): string | null;
      chooseFile(options?: any): string | null;
      keyChainWrite(key: string, value: string): boolean;
      keyChainRead(key: string): string | null;
    };
    preferences: {
      get(key: string): any;
      set(key: string, value: any): void;
      sync(): void;
    };
    console: {
      log(...args: any[]): void;
      warn(...args: any[]): void;
      error(...args: any[]): void;
    };
  }
}

declare const iina: IINA.API;
declare const core: IINA.API['core'];
declare const http: IINA.API['http'];
declare const utils: IINA.API['utils'];
declare const sidebar: IINA.API['sidebar'];
declare const standaloneWindow: IINA.API['standaloneWindow'];
declare const preferences: IINA.API['preferences'];
declare const event: IINA.API['event'];
declare const mpv: IINA.API['mpv'];
declare const console: IINA.API['console'];
declare const menu: IINA.API['menu'];
