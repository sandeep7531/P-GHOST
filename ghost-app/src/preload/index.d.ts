import { ElectronAPI } from '@electron-toolkit/preload'

interface GhostAPI {
  toggleStealth: () => Promise<boolean>
  getStealthStatus: () => Promise<boolean>
  copyToClipboard: (text: string) => Promise<boolean>
  enableFocus: () => Promise<boolean>
  disableFocus: () => Promise<boolean>
  resizeWindow: (width: number, height: number) => Promise<boolean>
  setResizable: (resizable: boolean) => Promise<boolean>
  onChatQuestion: (callback: (text: string) => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: GhostAPI
  }
}
