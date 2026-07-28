import { app, shell, BrowserWindow, ipcMain, globalShortcut, clipboard } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

let mainWindow: BrowserWindow | null = null
let isHidden = false
let stealthEnabled = true // Default: stealth ON (toggle via UI button)

function createWindow(): void {
  // ============================================================
  // 👻 GHOST WINDOW
  // ============================================================
  mainWindow = new BrowserWindow({
    width: 900,
    height: 750,
    x: 100,
    y: 100,
    minWidth: 350,
    minHeight: 400,

    // Stealth appearance
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    movable: true,

    // Stealth behavior
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,        // 🎯 CRITICAL: Never steal focus from user
    acceptFirstMouse: true,  // Accept clicks without needing to focus first
    show: false,
    autoHideMenuBar: true,

    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // ============================================================
  // 🕵️ STEALTH ACTIVATION
  // ============================================================
  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) return

    // Apply stealth (invisible to screen share/screenshots)
    mainWindow.setContentProtection(stealthEnabled)

    // Float above fullscreen apps (like Zoom in fullscreen)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')

    // Visible across ALL desktops / spaces
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })

    // 🎯 Show WITHOUT stealing focus from the currently-focused app
    mainWindow.showInactive()

    console.log(`👻 Ghost window ACTIVE — Stealth: ${stealthEnabled ? 'ON' : 'OFF'}`)
    console.log('🎯 Non-focus-stealing mode — typing stays smooth in other apps')
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ============================================================
// 📡 IPC HANDLERS — React can call these functions
// ============================================================
function setupIPC(): void {
  // Toggle stealth mode (for screenshot testing)
  ipcMain.handle('toggle-stealth', () => {
    stealthEnabled = !stealthEnabled
    mainWindow?.setContentProtection(stealthEnabled)
    console.log(`📸 Stealth toggled: ${stealthEnabled ? 'ON (invisible)' : 'OFF (visible)'}`)
    return stealthEnabled
  })

  ipcMain.handle('get-stealth-status', () => stealthEnabled)

  // Copy text to system clipboard
  ipcMain.handle('copy-to-clipboard', (_event, text: string) => {
    clipboard.writeText(text)
    console.log(`📋 Copied: ${text.substring(0, 50)}...`)
    return true
  })
  ipcMain.handle('enable-focus', () => {
    if (mainWindow) {
      mainWindow.setFocusable(true)
      mainWindow.focus()
      console.log('🎯 Focus ENABLED (for editing)')
    }
    return true
  })

  // 🎯 Disable focus again (default state)
  ipcMain.handle('disable-focus', () => {
    if (mainWindow) {
      mainWindow.setFocusable(false)
      console.log('🎯 Focus DISABLED (typing in other apps smooth)')
    }
    return true
  })

  // Resize window (for switching between setup ↔ overlay)
  ipcMain.handle('resize-window', (_event, width: number, height: number) => {
    if (mainWindow) {
      mainWindow.setSize(width, height)
      mainWindow.center()
      console.log(`📐 Window resized to ${width}x${height}`)
    }
    return true
  })

  // Set window resizable
  ipcMain.handle('set-resizable', (_event, resizable: boolean) => {
    mainWindow?.setResizable(resizable)
    return true
  })

}

// ============================================================
// ⌨️ GLOBAL KEYBOARD SHORTCUTS
// ============================================================
function registerShortcuts(): void {
  // 🙈 Cmd+Shift+H → Toggle Hide/Show overlay
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!mainWindow) return
    if (isHidden) {
      mainWindow.showInactive() // Show WITHOUT stealing focus
      isHidden = false
      console.log('👁️  Overlay SHOWN')
    } else {
      mainWindow.hide()
      isHidden = true
      console.log('🙈 Overlay HIDDEN')
    }
  })
  
  if (is.dev) {
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      if (mainWindow?.webContents.isDevToolsOpened()) {
        mainWindow?.webContents.closeDevTools()
      } else {
        mainWindow?.webContents.openDevTools({ mode: 'detach' })
      }
    })
  }

  // 💬 Cmd+Shift+Q → Send clipboard content as chat question
  globalShortcut.register('CommandOrControl+Shift+Q', () => {
    const clipboardText = clipboard.readText().trim()
    if (!clipboardText) {
      console.log('⚠️ Clipboard is empty')
      return
    }
    console.log(`💬 Clipboard question: ${clipboardText.substring(0, 60)}...`)
    mainWindow?.webContents.send('chat-question', clipboardText)
  })

  console.log('⌨️  Shortcuts registered:')
  console.log('   Cmd+Shift+H → Hide/Show overlay')
  console.log('   Cmd+Shift+Q → Ask clipboard question')
}

// ============================================================
// 🚀 APP LIFECYCLE
// ============================================================
app.whenReady().then(() => {
  // Hide dock icon on macOS (fully invisible from dock)
  if (process.platform === 'darwin') {
    app.dock?.hide()
  }

  electronApp.setAppUserModelId('com.ghost.interview')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('ping', () => console.log('pong'))

  setupIPC()
  createWindow()
  registerShortcuts()


  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Unregister shortcuts on quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})