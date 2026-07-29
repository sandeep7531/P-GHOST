import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // Stealth
  toggleStealth: (): Promise<boolean> => ipcRenderer.invoke('toggle-stealth'),
  getStealthStatus: (): Promise<boolean> => ipcRenderer.invoke('get-stealth-status'),

  // Clipboard
  copyToClipboard: (text: string): Promise<boolean> =>
    ipcRenderer.invoke('copy-to-clipboard', text),

  // Focus control (for edit mode)
  enableFocus: (): Promise<boolean> => ipcRenderer.invoke('enable-focus'),
  disableFocus: (): Promise<boolean> => ipcRenderer.invoke('disable-focus'),

  // Window resize
  resizeWindow: (width: number, height: number): Promise<boolean> =>
    ipcRenderer.invoke('resize-window', width, height),
  setResizable: (resizable: boolean): Promise<boolean> =>
    ipcRenderer.invoke('set-resizable', resizable),

  // ============================================
  // 🎯 GLOBAL SHORTCUT LISTENERS
  // ============================================
  onChatQuestion: (callback: (text: string) => void): void => {
    ipcRenderer.on('chat-question', (_event, text) => callback(text))
  },
  onRegenerateAnswer: (callback: () => void): void => {
    ipcRenderer.on('regenerate-answer', () => callback())
  },
  onCopyAnswer: (callback: () => void): void => {
    ipcRenderer.on('copy-answer', () => callback())
  },
  onTogglePause: (callback: () => void): void => {
    ipcRenderer.on('toggle-pause', () => callback())
  },
  onFocusTestBox: (callback: () => void): void => {
    ipcRenderer.on('focus-test-box', () => callback())
  },
  onClearContent: (callback: () => void): void => {
    ipcRenderer.on('clear-content', () => callback())
  },
  // AI Mode
  setAIMode: (mode: string): Promise<boolean> => ipcRenderer.invoke('set-ai-mode', mode),
  getAIMode: (): Promise<string> => ipcRenderer.invoke('get-ai-mode')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}