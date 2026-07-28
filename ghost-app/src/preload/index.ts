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

  // Chat question listener
  onChatQuestion: (callback: (text: string) => void): void => {
    ipcRenderer.on('chat-question', (_event, text) => callback(text))
  },
  // Window resize (add these)
  resizeWindow: (width: number, height: number): Promise<boolean> =>
    ipcRenderer.invoke('resize-window', width, height),
  setResizable: (resizable: boolean): Promise<boolean> =>
    ipcRenderer.invoke('set-resizable', resizable)
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