import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from './store/sessionStore'
import MessageRenderer from './components/MessageRenderer'

// ============================================================
// 🎯 TYPES
// ============================================================
type WSMessage =
  | { type: 'connected'; message: string }
  | { type: 'listening' }
  | { type: 'transcript'; text: string; duration: number }
  | { type: 'answer_start'; question: string; mode?: string; engine?: string }
  | { type: 'answer_token'; token: string }
  | { type: 'answer_done'; full_answer: string; duration: number; mode?: string; word_count?: number; engine?: string }
  | { type: 'error'; message: string }

interface ConversationItem {
  id: string
  question: string
  answer: string
  timestamp: number
  isStreaming: boolean
  mode?: string
  engine?: string
  source: 'voice' | 'chat' | 'test' | 'edit'
}

// ============================================================
// 🎨 GHOST OVERLAY (Apple Clear + Opacity Control)
// ============================================================
function Overlay(): JSX.Element {
  const navigate = useNavigate()
  const sessionData = useSessionStore()

  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState<'idle' | 'listening' | 'thinking'>('idle')
  const [sessionTime, setSessionTime] = useState<string>('00:00')
  const [stealthOn, setStealthOn] = useState<boolean>(true)
  const [copyFeedback, setCopyFeedback] = useState<string>('')
  const [aiMode, setAIMode] = useState<'local' | 'hybrid' | 'cloud'>('hybrid')
  const [opacity, setOpacity] = useState<number>(0.65)

  // Conversation history
  const [conversations, setConversations] = useState<ConversationItem[]>([])
  const [newQuestionCount, setNewQuestionCount] = useState<number>(0)

  // Test box
  const [testQuestion, setTestQuestion] = useState<string>('')
  const [showTestBox, setShowTestBox] = useState<boolean>(true)

  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editedText, setEditedText] = useState<string>('')

  // Shortcut states
  const [isPaused, setIsPaused] = useState<boolean>(false)

  // Refs
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const sessionStartRef = useRef<number>(Date.now())
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const testTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const historyContainerRef = useRef<HTMLDivElement | null>(null)

  // State refs (for shortcuts avoiding stale closures)
  const conversationsRef = useRef<ConversationItem[]>([])
  const statusRef = useRef<'idle' | 'listening' | 'thinking'>('idle')
  const isPausedRef = useRef<boolean>(false)
  const isAtTopRef = useRef<boolean>(true)
  const opacityRef = useRef<number>(0.65)

  // Debounce
  const shortcutTimestampsRef = useRef<{ [key: string]: number }>({
    regenerate: 0, copy: 0, pause: 0, clear: 0, focus: 0, chatQuestion: 0, showNext: 0, opacity: 0
  })
  const DEBOUNCE_MS = 1500

  // ============================================================
  // ⏱️ SESSION TIMER
  // ============================================================
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - sessionStartRef.current) / 1000)
      const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
      const ss = String(elapsed % 60).padStart(2, '0')
      setSessionTime(`${mm}:${ss}`)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // ============================================================
  // 🔄 SYNC REFS
  // ============================================================
  useEffect(() => { conversationsRef.current = conversations }, [conversations])
  useEffect(() => { statusRef.current = status }, [status])
  useEffect(() => { isPausedRef.current = isPaused }, [isPaused])
  useEffect(() => { opacityRef.current = opacity }, [opacity])

  // ============================================================
  // 📸 INITIAL STATE
  // ============================================================
  useEffect(() => {
    window.api.getStealthStatus().then(setStealthOn)
    window.api.getAIMode().then((mode) => {
      if (mode === 'local' || mode === 'hybrid' || mode === 'cloud') {
        setAIMode(mode as 'local' | 'hybrid' | 'cloud')
      }
    })

    // Load saved opacity from localStorage
    const savedOpacity = localStorage.getItem('ghost-opacity')
    if (savedOpacity) {
      const val = parseFloat(savedOpacity)
      if (val >= 0.3 && val <= 1.0) {
        setOpacity(val)
      }
    }
  }, [])

  // ============================================================
  // 📡 WEBSOCKET
  // ============================================================
  useEffect(() => {
    let ws: WebSocket | null = null
    let isCleanedUp = false
    let currentStreamingId: string | null = null

    const generateId = (): string => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

    const addNewConversation = (question: string, source: 'voice' | 'chat' | 'test' | 'edit'): string => {
      const id = generateId()
      const newItem: ConversationItem = {
        id,
        question,
        answer: '',
        timestamp: Date.now(),
        isStreaming: true,
        source
      }
      setConversations((prev) => [newItem, ...prev])

      // Increment badge if user isn't at top
      if (!isAtTopRef.current) {
        setNewQuestionCount((prev) => prev + 1)
      }

      return id
    }

    const handleMessage = (msg: WSMessage): void => {
      if (isCleanedUp) return

      switch (msg.type) {
        case 'connected':
          console.log('🎉 Backend:', msg.message)
          break

        case 'listening':
          setStatus('listening')
          break

        case 'transcript':
          currentStreamingId = addNewConversation(msg.text, 'voice')
          setStatus('thinking')
          break

        case 'answer_start':
          setStatus('thinking')
          if (!currentStreamingId) {
            currentStreamingId = addNewConversation(msg.question, 'chat')
          }
          if (msg.mode || msg.engine) {
            const id = currentStreamingId
            setConversations((prev) =>
              prev.map((c) =>
                c.id === id ? { ...c, mode: msg.mode, engine: msg.engine } : c
              )
            )
          }
          break

        case 'answer_token':
          if (currentStreamingId) {
            const id = currentStreamingId
            setConversations((prev) =>
              prev.map((c) =>
                c.id === id ? { ...c, answer: c.answer + msg.token } : c
              )
            )
          }
          break

        case 'answer_done':
          if (currentStreamingId) {
            const id = currentStreamingId
            setConversations((prev) =>
              prev.map((c) =>
                c.id === id ? { ...c, isStreaming: false, answer: msg.full_answer || c.answer } : c
              )
            )
            currentStreamingId = null
          }
          setStatus('idle')
          break

        case 'error':
          console.error('Backend error:', msg.message)
          setStatus('idle')
          if (currentStreamingId) {
            const id = currentStreamingId
            setConversations((prev) =>
              prev.map((c) =>
                c.id === id
                  ? { ...c, isStreaming: false, answer: `❌ Error: ${msg.message}` }
                  : c
              )
            )
            currentStreamingId = null
          }
          if (msg.message.includes('Already generating')) {
            setCopyFeedback('⏳ Wait for current answer...')
            setTimeout(() => setCopyFeedback(''), 1500)
          }
          break
      }
    }

    const connect = (): void => {
      if (isCleanedUp) return
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }

      console.log('🔌 Connecting to Ghost backend...')
      ws = new WebSocket('ws://localhost:8765')
      wsRef.current = ws

      ws.onopen = () => {
        if (isCleanedUp) return
        console.log('✅ Connected')
        setConnected(true)
        setStatus('idle')
      }

      ws.onmessage = (event) => {
        try {
          handleMessage(JSON.parse(event.data))
        } catch (err) {
          console.error(err)
        }
      }

      ws.onclose = () => {
        if (isCleanedUp) return
        console.log('❌ Disconnected')
        setConnected(false)
        setStatus('idle')
        reconnectTimerRef.current = setTimeout(connect, 2000)
      }

      ws.onerror = (err) => console.error('WS error:', err)
    }

    connect()

    return () => {
      isCleanedUp = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (ws) {
        ws.onopen = null
        ws.onmessage = null
        ws.onclose = null
        ws.onerror = null
        ws.close()
      }
      wsRef.current = null
    }
  }, [])

  // ============================================================
  // 📥 SEND SESSION CONTEXT
  // ============================================================
  useEffect(() => {
    if (!connected) return
    const data = useSessionStore.getState()
    if (data.isSetupComplete && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'load_session',
          resume: data.resume,
          company: data.company,
          position: data.position,
          job_description: data.jobDescription
        })
      )
    }
  }, [connected])

  // ============================================================
  // 📜 SCROLL DETECTION
  // ============================================================
  useEffect(() => {
    const container = historyContainerRef.current
    if (!container) return

    const handleScroll = (): void => {
      const isAtTop = container.scrollTop < 50
      isAtTopRef.current = isAtTop
      if (isAtTop && newQuestionCount > 0) {
        setNewQuestionCount(0)
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [newQuestionCount])

  // ============================================================
  // 🛡️ DEBOUNCE HELPER
  // ============================================================
  const canFireShortcut = (key: string): boolean => {
    const now = Date.now()
    const lastFired = shortcutTimestampsRef.current[key] || 0
    if (now - lastFired < DEBOUNCE_MS) return false
    shortcutTimestampsRef.current[key] = now
    return true
  }

  // ============================================================
  // 📥 SCROLL TO TOP
  // ============================================================
  const scrollToTop = (): void => {
    if (historyContainerRef.current) {
      historyContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' })
      setNewQuestionCount(0)
    }
  }

  // ============================================================
  // ⌨️ CLIPBOARD QUESTION
  // ============================================================
  useEffect(() => {
    window.api.onChatQuestion((text: string) => {
      if (!canFireShortcut('chatQuestion')) return
      if (statusRef.current === 'thinking') {
        setCopyFeedback('⏳ Wait for current answer...')
        setTimeout(() => setCopyFeedback(''), 1500)
        return
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'chat_question', text }))
      }
    })
  }, [])

  // ============================================================
  // ⌨️ SHORTCUTS
  // ============================================================
  useEffect(() => {
    // 🔄 Regenerate latest
    window.api.onRegenerateAnswer(() => {
      if (!canFireShortcut('regenerate')) return
      if (statusRef.current === 'thinking') {
        setCopyFeedback('⏳ Wait for current answer...')
        setTimeout(() => setCopyFeedback(''), 1500)
        return
      }
      const latest = conversationsRef.current[0]
      if (!latest || wsRef.current?.readyState !== WebSocket.OPEN) {
        setCopyFeedback('No previous question to regenerate')
        setTimeout(() => setCopyFeedback(''), 1500)
        return
      }
      wsRef.current.send(JSON.stringify({ type: 'chat_question', text: latest.question }))
      setCopyFeedback('Regenerating...')
      setTimeout(() => setCopyFeedback(''), 1200)
    })

    // 📋 Copy latest answer
    window.api.onCopyAnswer(() => {
      if (!canFireShortcut('copy')) return
      const latest = conversationsRef.current[0]
      if (!latest?.answer) {
        setCopyFeedback('No answer to copy')
        setTimeout(() => setCopyFeedback(''), 1500)
        return
      }
      window.api.copyToClipboard(latest.answer)
      setCopyFeedback('Answer copied!')
      setTimeout(() => setCopyFeedback(''), 1500)
    })

    // ⏸️ Pause/Resume
    window.api.onTogglePause(() => {
      if (!canFireShortcut('pause')) return
      if (wsRef.current?.readyState !== WebSocket.OPEN) return
      const newPaused = !isPausedRef.current
      setIsPaused(newPaused)
      wsRef.current.send(
        JSON.stringify({ type: newPaused ? 'pause_listening' : 'resume_listening' })
      )
      setCopyFeedback(newPaused ? '⏸️ Paused' : '▶️ Resumed')
      setTimeout(() => setCopyFeedback(''), 1500)
    })

    // 🎯 Focus test box
    window.api.onFocusTestBox(() => {
      if (!canFireShortcut('focus')) return
      setShowTestBox(true)
      setTimeout(() => testTextareaRef.current?.focus(), 100)
    })

    // 🗑️ Clear all
    window.api.onClearContent(() => {
      if (!canFireShortcut('clear')) return
      setConversations([])
      setNewQuestionCount(0)
      setStatus('idle')
      setCopyFeedback('Cleared!')
      setTimeout(() => setCopyFeedback(''), 1200)
    })

    // 📥 Show next (scroll to top)
    window.api.onShowNextQuestion(() => {
      if (!canFireShortcut('showNext')) return
      scrollToTop()
      setCopyFeedback('📥 Latest question')
      setTimeout(() => setCopyFeedback(''), 1200)
    })

    // ✨ Opacity control
    window.api.onOpacityChange((action: string) => {
      let newOpacity = opacityRef.current

      if (action === 'increase') {
        newOpacity = Math.min(1.0, opacityRef.current + 0.1)
      } else if (action === 'decrease') {
        newOpacity = Math.max(0.3, opacityRef.current - 0.1)
      } else if (action === 'reset') {
        newOpacity = 0.65
      }

      setOpacity(newOpacity)
      localStorage.setItem('ghost-opacity', newOpacity.toString())

      const percentage = Math.round(newOpacity * 100)
      setCopyFeedback(`✨ Opacity: ${percentage}%`)
      setTimeout(() => setCopyFeedback(''), 1500)
    })
  }, [])

  // ============================================================
  // 🎯 HANDLERS
  // ============================================================
  const handleAIModeChange = async (mode: 'local' | 'hybrid' | 'cloud'): Promise<void> => {
    setAIMode(mode)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_ai_mode', mode }))
    }
    await window.api.setAIMode(mode)
    const label = mode === 'local' ? '🏠 Local' : mode === 'hybrid' ? '⚡ Hybrid' : '☁️ Cloud'
    setCopyFeedback(`Switched to ${label}`)
    setTimeout(() => setCopyFeedback(''), 1500)
  }

  const handleToggleStealth = async (): Promise<void> => {
    const newStatus = await window.api.toggleStealth()
    setStealthOn(newStatus)
  }

  const handleCopy = async (text: string, label: string): Promise<void> => {
    if (!text) return
    await window.api.copyToClipboard(text)
    setCopyFeedback(`${label} copied!`)
    setTimeout(() => setCopyFeedback(''), 1500)
  }

  const handleRegenerateItem = (item: ConversationItem): void => {
    if (status === 'thinking') {
      setCopyFeedback('⏳ Wait for current answer...')
      setTimeout(() => setCopyFeedback(''), 1500)
      return
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat_question', text: item.question }))
    }
  }

  const handleDeleteItem = (id: string): void => {
    setConversations((prev) => prev.filter((c) => c.id !== id))
  }

  const handleStartEditItem = async (item: ConversationItem): Promise<void> => {
    setEditingId(item.id)
    setEditedText(item.question)
    await window.api.enableFocus()
    setTimeout(() => {
      editTextareaRef.current?.focus()
      editTextareaRef.current?.select()
    }, 100)
  }

  const handleCancelEdit = async (): Promise<void> => {
    setEditingId(null)
    setEditedText('')
    await window.api.disableFocus()
  }

  const handleSubmitEdit = async (): Promise<void> => {
    const question = editedText.trim()
    if (!question) return
    if (status === 'thinking') {
      setCopyFeedback('⏳ Wait for current answer...')
      setTimeout(() => setCopyFeedback(''), 1500)
      return
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat_question', text: question }))
      setEditingId(null)
      setEditedText('')
      await window.api.disableFocus()
    }
  }

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmitEdit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  // ============================================================
  // 🧪 TEST QUESTION
  // ============================================================
  const handleTestQuestion = async (): Promise<void> => {
    const question = testQuestion.trim()
    if (!question) return
    if (status === 'thinking') {
      setCopyFeedback('⏳ Wait for current answer...')
      setTimeout(() => setCopyFeedback(''), 1500)
      return
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat_question', text: question }))
      setTestQuestion('')
    }
  }

  const handleTestKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleTestQuestion()
    }
  }

  const handleTestBoxFocus = async (): Promise<void> => {
    await window.api.enableFocus()
    setTimeout(() => testTextareaRef.current?.focus(), 50)
  }

  const handleTestBoxBlur = async (): Promise<void> => {
    await window.api.disableFocus()
  }

  // ============================================================
  // 🎨 UTILITIES
  // ============================================================
  const getStatusColor = (): string => {
    if (!connected) return '#ff4757'
    if (isPaused) return '#ffa502'
    if (status === 'listening') return '#ffa502'
    if (status === 'thinking') return '#3742fa'
    return '#2ed573'
  }

  const getStatusText = (): string => {
    if (!connected) return 'Disconnected'
    if (isPaused) return '⏸ Paused'
    if (status === 'listening') return 'Listening...'
    if (status === 'thinking') return 'Thinking...'
    return 'Ready'
  }

  const formatTime = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)
    if (seconds < 5) return 'now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    return `${Math.floor(minutes / 60)}h ago`
  }

  const getSourceIcon = (source: string): string => {
    switch (source) {
      case 'voice': return '🎙️'
      case 'chat': return '💬'
      case 'test': return '🧪'
      case 'edit': return '✏️'
      default: return '❓'
    }
  }

  // ============================================================
  // 🎨 RENDER (Apple Clear Theme)
  // ============================================================
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: `rgba(0, 0, 0, ${opacity * 0.5})`,
        borderRadius: '14px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        color: 'white',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        textShadow: '0 1px 3px rgba(0, 0, 0, 0.9)'
      }}
    >
      {/* HEADER */}
      <div
        style={
          {
            height: '40px',
            background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 15px',
            WebkitAppRegion: 'drag',
            userSelect: 'none',
            cursor: 'move',
            flexShrink: 0
          } as React.CSSProperties
        }
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
          <span style={{ color: getStatusColor(), fontSize: '10px' }}>●</span>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>👻 GHOST</span>
          {sessionData.company && (
            <span
              style={{
                fontSize: '10px',
                color: '#5c6cff',
                background: 'rgba(92, 108, 255, 0.15)',
                padding: '2px 8px',
                borderRadius: '10px',
                marginLeft: '4px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                backdropFilter: 'blur(10px)'
              }}
            >
              {sessionData.company} · {sessionData.position}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '10px', opacity: 0.5 }}>{getStatusText()}</span>
          <span style={{ fontSize: '11px', opacity: 0.6, fontFamily: 'monospace' }}>{sessionTime}</span>
        </div>
      </div>

      {/* TOGGLE BAR */}
      <div
        style={
          {
            height: '36px',
            background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.01) 100%)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '0 12px',
            WebkitAppRegion: 'no-drag',
            flexShrink: 0
          } as React.CSSProperties
        }
      >
        <button
          onClick={handleToggleStealth}
          style={{
            background: stealthOn ? 'rgba(46, 213, 115, 0.15)' : 'rgba(255, 71, 87, 0.15)',
            color: stealthOn ? '#2ed573' : '#ff4757',
            border: `1px solid ${stealthOn ? '#2ed573' : '#ff4757'}`,
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            backdropFilter: 'blur(10px)'
          }}
          title={stealthOn ? 'Invisible in screenshots' : 'Visible in screenshots'}
        >
          {stealthOn ? '👻 Stealth' : '📸 Visible'}
        </button>

        <button
          onClick={async () => {
            await window.api.enableFocus()
            await window.api.resizeWindow(750, 800)
            navigate('/')
          }}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            color: 'rgba(255, 255, 255, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            backdropFilter: 'blur(10px)'
          }}
          title="Setup"
        >
          ⚙️
        </button>

        {/* AI Mode Selector */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            marginLeft: '4px',
            padding: '2px',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '6px',
            backdropFilter: 'blur(10px)'
          }}
        >
          {(['local', 'hybrid', 'cloud'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => handleAIModeChange(mode)}
              title={mode === 'local' ? 'Local only' : mode === 'hybrid' ? 'Smart routing' : 'Cloud only'}
              style={{
                background:
                  aiMode === mode
                    ? mode === 'local'
                      ? 'rgba(255, 165, 2, 0.25)'
                      : mode === 'hybrid'
                        ? 'rgba(92, 108, 255, 0.25)'
                        : 'rgba(46, 213, 115, 0.25)'
                    : 'transparent',
                color:
                  aiMode === mode
                    ? mode === 'local'
                      ? '#ffa502'
                      : mode === 'hybrid'
                        ? '#5c6cff'
                        : '#2ed573'
                    : 'rgba(255, 255, 255, 0.5)',
                border: 'none',
                borderRadius: '4px',
                padding: '3px 8px',
                fontSize: '10px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {mode === 'local' ? '🏠' : mode === 'hybrid' ? '⚡' : '☁️'} {mode}
            </button>
          ))}
        </div>

        {/* Clear All Button */}
        {conversations.length > 0 && (
          <button
            onClick={() => {
              if (confirm('Clear all conversation history?')) {
                setConversations([])
                setNewQuestionCount(0)
              }
            }}
            style={{
              background: 'rgba(255, 71, 87, 0.15)',
              color: '#ff4757',
              border: '1px solid rgba(255, 71, 87, 0.3)',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '10px',
              fontWeight: 500,
              cursor: 'pointer',
              marginLeft: '4px',
              backdropFilter: 'blur(10px)'
            }}
            title="Clear all history"
          >
            🗑️
          </button>
        )}

        {copyFeedback && (
          <span
            style={{
              fontSize: '10px',
              color:
                copyFeedback.includes('⏳') || copyFeedback.includes('No ')
                  ? '#ffa502'
                  : '#2ed573',
              marginLeft: 'auto',
              fontWeight: 600
            }}
          >
            {copyFeedback.includes('⏳') || copyFeedback.includes('No ')
              ? copyFeedback
              : `✓ ${copyFeedback}`}
          </span>
        )}
      </div>

      {/* NEW QUESTIONS BANNER */}
      {newQuestionCount > 0 && (
        <div
          onClick={scrollToTop}
          style={{
            background: 'linear-gradient(90deg, rgba(255, 71, 87, 0.9) 0%, rgba(255, 107, 122, 0.9) 100%)',
            color: 'white',
            padding: '8px 15px',
            fontSize: '11px',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            backdropFilter: 'blur(15px)',
            borderBottom: '1px solid rgba(255, 71, 87, 0.5)'
          }}
        >
          <span>
            🔴 {newQuestionCount} NEW {newQuestionCount === 1 ? 'QUESTION' : 'QUESTIONS'} ABOVE
          </span>
          <span style={{ opacity: 0.9 }}>Click or ⌘⇧N</span>
        </div>
      )}

      {/* MAIN SCROLLABLE AREA */}
      <div
        ref={historyContainerRef}
        style={
          {
            flex: 1,
            padding: '14px 16px',
            overflowY: 'auto',
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties
        }
      >
        {/* Test Box */}
        {showTestBox && (
          <div
            style={{
              marginBottom: '14px',
              padding: '12px',
              background: 'linear-gradient(135deg, rgba(92, 108, 255, 0.1) 0%, rgba(92, 108, 255, 0.05) 100%)',
              border: '1px solid rgba(92, 108, 255, 0.25)',
              borderRadius: '10px',
              backdropFilter: 'blur(15px)',
              boxShadow: '0 4px 12px rgba(92, 108, 255, 0.1)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }}
            >
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#a0aaff' }}>
                🧪 TEST QUESTION
              </div>
              <button
                onClick={() => setShowTestBox(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.4)',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                ✖
              </button>
            </div>

            <textarea
              ref={testTextareaRef}
              value={testQuestion}
              onChange={(e) => setTestQuestion(e.target.value)}
              onKeyDown={handleTestKeyDown}
              onFocus={handleTestBoxFocus}
              onBlur={handleTestBoxBlur}
              onClick={handleTestBoxFocus}
              placeholder="Type any interview question... (Cmd+Enter to submit)"
              style={{
                width: '100%',
                minHeight: '50px',
                fontSize: '13px',
                color: 'white',
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(92, 108, 255, 0.3)',
                borderRadius: '6px',
                padding: '8px 10px',
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
                lineHeight: 1.5,
                backdropFilter: 'blur(10px)'
              }}
            />

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '6px'
              }}
            >
              <span style={{ fontSize: '10px', opacity: 0.5 }}>💡 Cmd+Enter</span>
              <button
                onClick={handleTestQuestion}
                disabled={!testQuestion.trim() || status === 'thinking'}
                style={{
                  background:
                    testQuestion.trim() && status !== 'thinking'
                      ? 'linear-gradient(135deg, #5c6cff 0%, #3742fa 100%)'
                      : 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  color:
                    testQuestion.trim() && status !== 'thinking'
                      ? 'white'
                      : 'rgba(255, 255, 255, 0.3)',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: testQuestion.trim() && status !== 'thinking' ? 'pointer' : 'not-allowed'
                }}
              >
                {status === 'thinking' ? '⏳' : '🚀 ASK'}
              </button>
            </div>
          </div>
        )}

        {!showTestBox && (
          <button
            onClick={() => setShowTestBox(true)}
            style={{
              width: '100%',
              padding: '6px',
              marginBottom: '12px',
              background: 'rgba(92, 108, 255, 0.08)',
              border: '1px dashed rgba(92, 108, 255, 0.3)',
              borderRadius: '6px',
              color: '#a0aaff',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              backdropFilter: 'blur(10px)'
            }}
          >
            🧪 Show Test Box
          </button>
        )}

        {/* CONVERSATION HISTORY */}
        {conversations.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              opacity: 0.4,
              fontSize: '13px',
              fontStyle: 'italic'
            }}
          >
            Waiting for interviewer to speak, or use test box above...
          </div>
        ) : (
          conversations.map((item, index) => (
            <div
              key={item.id}
              style={{
                marginBottom: '16px',
                padding: '14px',
                background:
                  index === 0
                    ? 'linear-gradient(135deg, rgba(92, 108, 255, 0.08) 0%, rgba(92, 108, 255, 0.03) 100%)'
                    : 'linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.01) 100%)',
                border: `1px solid ${index === 0 ? 'rgba(92, 108, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)'
                  }`,
                borderRadius: '12px',
                backdropFilter: 'blur(20px)',
                boxShadow: index === 0
                  ? '0 4px 20px rgba(92, 108, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.05)'
                  : '0 2px 8px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.03)'
              }}
            >
              {/* Question Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '11px' }}>{getSourceIcon(item.source)}</span>
                  <span
                    style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      color: 'rgba(255, 255, 255, 0.5)',
                      letterSpacing: '0.5px'
                    }}
                  >
                    QUESTION · {formatTime(item.timestamp)}
                  </span>
                  {item.engine && (
                    <span
                      style={{
                        fontSize: '9px',
                        padding: '1px 6px',
                        borderRadius: '3px',
                        background:
                          item.engine === 'cloud'
                            ? 'rgba(46, 213, 115, 0.15)'
                            : 'rgba(255, 165, 2, 0.15)',
                        color: item.engine === 'cloud' ? '#2ed573' : '#ffa502',
                        fontWeight: 600
                      }}
                    >
                      {item.engine === 'cloud' ? '☁️' : '🏠'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {editingId !== item.id && (
                    <>
                      <button
                        onClick={() => handleStartEditItem(item)}
                        style={{
                          background: 'rgba(55, 66, 250, 0.15)',
                          border: '1px solid rgba(55, 66, 250, 0.3)',
                          color: '#5c6cff',
                          borderRadius: '3px',
                          padding: '2px 6px',
                          fontSize: '9px',
                          cursor: 'pointer'
                        }}
                        title="Edit & regenerate"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleRegenerateItem(item)}
                        disabled={status === 'thinking'}
                        style={{
                          background: 'rgba(92, 108, 255, 0.15)',
                          border: '1px solid rgba(92, 108, 255, 0.3)',
                          color: '#5c6cff',
                          borderRadius: '3px',
                          padding: '2px 6px',
                          fontSize: '9px',
                          cursor: status === 'thinking' ? 'not-allowed' : 'pointer',
                          opacity: status === 'thinking' ? 0.4 : 1
                        }}
                        title="Regenerate"
                      >
                        🔄
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        style={{
                          background: 'rgba(255, 71, 87, 0.15)',
                          border: '1px solid rgba(255, 71, 87, 0.3)',
                          color: '#ff4757',
                          borderRadius: '3px',
                          padding: '2px 6px',
                          fontSize: '9px',
                          cursor: 'pointer'
                        }}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Question Text or Edit */}
              {editingId === item.id ? (
                <div>
                  <textarea
                    ref={editTextareaRef}
                    value={editedText}
                    onChange={(e) => setEditedText(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    style={{
                      width: '100%',
                      minHeight: '60px',
                      fontSize: '13px',
                      color: 'white',
                      background: 'rgba(55, 66, 250, 0.08)',
                      border: '1px solid rgba(55, 66, 250, 0.4)',
                      borderRadius: '6px',
                      padding: '8px 10px',
                      outline: 'none',
                      resize: 'vertical',
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                      marginBottom: '6px',
                      backdropFilter: 'blur(10px)'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                    <button
                      onClick={handleCancelEdit}
                      style={{
                        background: 'rgba(255, 71, 87, 0.15)',
                        border: '1px solid rgba(255, 71, 87, 0.4)',
                        color: '#ff4757',
                        borderRadius: '4px',
                        padding: '4px 10px',
                        fontSize: '10px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      ✖ Cancel
                    </button>
                    <button
                      onClick={handleSubmitEdit}
                      disabled={!editedText.trim() || status === 'thinking'}
                      style={{
                        background:
                          editedText.trim() && status !== 'thinking'
                            ? 'linear-gradient(135deg, #5c6cff 0%, #3742fa 100%)'
                            : 'rgba(255, 255, 255, 0.05)',
                        border: 'none',
                        color: editedText.trim() && status !== 'thinking' ? 'white' : 'rgba(255,255,255,0.3)',
                        borderRadius: '4px',
                        padding: '4px 10px',
                        fontSize: '10px',
                        fontWeight: 600,
                        cursor: editedText.trim() && status !== 'thinking' ? 'pointer' : 'not-allowed'
                      }}
                    >
                      🔄 Regenerate
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: '13px',
                    color: '#ffa502',
                    lineHeight: 1.4,
                    padding: '8px 10px',
                    background: 'rgba(255, 165, 2, 0.06)',
                    border: '1px solid rgba(255, 165, 2, 0.15)',
                    borderRadius: '6px',
                    marginBottom: '10px',
                    userSelect: 'text',
                    WebkitUserSelect: 'text',
                    backdropFilter: 'blur(5px)'
                  } as React.CSSProperties}
                >
                  {item.question}
                </div>
              )}

              {/* Answer Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '6px'
                }}
              >
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    color: 'rgba(255, 255, 255, 0.5)',
                    letterSpacing: '0.5px'
                  }}
                >
                  {item.isStreaming ? '💭 ANSWER (streaming...)' : '✓ ANSWER'}
                </span>
                {item.answer && !item.isStreaming && (
                  <button
                    onClick={() => handleCopy(item.answer, 'Answer')}
                    style={{
                      background: 'rgba(46, 213, 115, 0.15)',
                      border: '1px solid rgba(46, 213, 115, 0.3)',
                      color: '#2ed573',
                      borderRadius: '3px',
                      padding: '2px 8px',
                      fontSize: '9px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    📋 Copy
                  </button>
                )}
              </div>

              {/* Answer Content */}
              <div
                style={{
                  fontSize: '14px',
                  lineHeight: 1.6,
                  padding: '10px 12px',
                  background: 'rgba(46, 213, 115, 0.04)',
                  border: '1px solid rgba(46, 213, 115, 0.12)',
                  borderRadius: '6px',
                  minHeight: item.answer ? 'auto' : '40px',
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  backdropFilter: 'blur(5px)'
                } as React.CSSProperties}
              >
                {item.answer ? (
                  <MessageRenderer content={item.answer} onCopyCode={(code) => handleCopy(code, 'Code')} />
                ) : (
                  <span style={{ opacity: 0.4, fontStyle: 'italic', fontSize: '12px' }}>
                    Generating answer...
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* BOTTOM BAR */}
      <div
        style={{
          height: '26px',
          background: 'linear-gradient(0deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 15px',
          fontSize: '10px',
          opacity: 0.6,
          flexShrink: 0
        }}
      >
        <span>
          {connected ? '🟢 Connected' : '🔴 Offline'}
          {conversations.length > 0 && ` · ${conversations.length} Q&A`}
        </span>
        <span>⌘⇧N latest · ⌘⇧R regen · ⌘⇧=/-/0 opacity</span>
      </div>
    </div>
  )
}

export default Overlay