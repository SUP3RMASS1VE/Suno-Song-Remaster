// Type declarations for Electron API
interface ElectronAPI {
  selectFile: () => Promise<string | null>;
  saveFile: () => Promise<string | null>;
  readAudioFile: (filePath: string) => Promise<number[]>;
  writeFile: (filePath: string, data: number[]) => Promise<{ success: boolean }>;
  getPathForFile: (file: File) => string;
  getSystemInfo: () => Promise<{
    platform: string;
    arch: string;
    isPackaged: boolean;
    appPath: string;
    electronVersion: string;
    nodeVersion: string;
  }>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
}

interface Window {
  electronAPI: ElectronAPI;
}
