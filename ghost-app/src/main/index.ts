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
    width: 480,
    height: 720,
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
    focusable: false, // Never steal focus by default
    acceptFirstMouse: true,
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

    mainWindow.setContentProtection(stealthEnabled)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    })

    mainWindow.showInactive() // Show without stealing focus

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
  // Toggle stealth mode
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

  // Enable focus (for editing/typing in overlay)
  ipcMain.handle('enable-focus', () => {
    if (mainWindow) {
      mainWindow.setFocusable(true)
      mainWindow.focus()
      console.log('🎯 Focus ENABLED (for editing)')
    }
    return true
  })

  // Disable focus (default state)
  ipcMain.handle('disable-focus', () => {
    if (mainWindow) {
      mainWindow.setFocusable(false)
      console.log('🎯 Focus DISABLED (typing in other apps smooth)')
    }
    return true
  })

  // Resize window
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

  // AI Mode toggle
  let currentAIMode = 'hybrid' // default

  ipcMain.handle('set-ai-mode', (_event, mode: string) => {
    currentAIMode = mode
    console.log(`🎯 AI mode changed to: ${mode}`)
    return true
  })

  ipcMain.handle('get-ai-mode', () => currentAIMode)
}

// ============================================================
// ⌨️ GLOBAL KEYBOARD SHORTCUTS
// ============================================================
function registerShortcuts(): void {
  // 🙈 Cmd+Shift+H → Toggle Hide/Show overlay
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!mainWindow) return
    if (isHidden) {
      mainWindow.showInactive()
      isHidden = false
      console.log('👁️  Overlay SHOWN')
    } else {
      mainWindow.hide()
      isHidden = true
      console.log('🙈 Overlay HIDDEN')
    }
  })

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

  // 🔄 Cmd+Shift+R → Regenerate current answer
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    console.log('🔄 Regenerate requested')
    mainWindow?.webContents.send('regenerate-answer')
  })

  // 📋 Cmd+Shift+C → Copy current answer
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    console.log('📋 Copy answer requested')
    mainWindow?.webContents.send('copy-answer')
  })

  // ⏸️ Cmd+Shift+P → Pause/Resume listening
  globalShortcut.register('CommandOrControl+Shift+P', () => {
    console.log('⏸️  Pause/Resume toggled')
    mainWindow?.webContents.send('toggle-pause')
  })

  // 🎯 Cmd+Shift+F → Focus test question box
  globalShortcut.register('CommandOrControl+Shift+F', () => {
    console.log('🎯 Focus test box')
    mainWindow?.setFocusable(true)
    mainWindow?.focus()
    mainWindow?.webContents.send('focus-test-box')
  })
  // 📥 Cmd+Shift+N → Show next queued question
  globalShortcut.register('CommandOrControl+Shift+N', () => {
    console.log('📥 Show next question requested')
    mainWindow?.webContents.send('show-next-question')
  })

  // 🗑️ Cmd+Shift+K → Clear transcript + answer
  globalShortcut.register('CommandOrControl+Shift+K', () => {
    console.log('🗑️  Clear requested')
    mainWindow?.webContents.send('clear-content')
  })

  // 🔧 DEV ONLY: Cmd+Shift+D → Toggle DevTools
  if (is.dev) {
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      if (mainWindow?.webContents.isDevToolsOpened()) {
        mainWindow?.webContents.closeDevTools()
      } else {
        mainWindow?.webContents.openDevTools({ mode: 'detach' })
      }
    })
  }

  console.log('⌨️  Keyboard shortcuts registered:')
  console.log('   Cmd+Shift+H → Hide/Show overlay')
  console.log('   Cmd+Shift+Q → Ask clipboard question')
  console.log('   Cmd+Shift+R → Regenerate answer')
  console.log('   Cmd+Shift+C → Copy answer')
  console.log('   Cmd+Shift+P → Pause/Resume listening')
  console.log('   Cmd+Shift+F → Focus test box')
  console.log('   Cmd+Shift+K → Clear transcript+answer')
  if (is.dev) console.log('   Cmd+Shift+D → Toggle DevTools')
}

// ============================================================
// 🚀 APP LIFECYCLE
// ============================================================
app.whenReady().then(() => {
  // Hide dock icon on macOS
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