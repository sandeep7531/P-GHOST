import { ElectronAPI } from '@electron-toolkit/preload'

interface GhostAPI {
  // Stealth
  toggleStealth: () => Promise<boolean>
  getStealthStatus: () => Promise<boolean>

  // Clipboard
  copyToClipboard: (text: string) => Promise<boolean>

  // Focus
  enableFocus: () => Promise<boolean>
  disableFocus: () => Promise<boolean>

  // Window
  resizeWindow: (width: number, height: number) => Promise<boolean>
  setResizable: (resizable: boolean) => Promise<boolean>

  // Global shortcuts
  onChatQuestion: (callback: (text: string) => void) => void
  onRegenerateAnswer: (callback: () => void) => void
  onCopyAnswer: (callback: () => void) => void
  onTogglePause: (callback: () => void) => void
  onFocusTestBox: (callback: () => void) => void
  onClearContent: (callback: () => void) => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: GhostAPI
  }
}