import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from './store/sessionStore'
import MessageRenderer from './components/MessageRenderer'

// ============================================================
// 🎯 TYPES for messages from Python backend
// ============================================================
type WSMessage =
  | { type: 'connected'; message: string }
  | { type: 'listening' }
  | { type: 'transcript'; text: string; duration: number }
  | { type: 'answer_start'; question: string; mode?: string }
  | { type: 'answer_token'; token: string }
  | { type: 'answer_done'; full_answer: string; duration: number; mode?: string; word_count?: number }
  | { type: 'error'; message: string }

// ============================================================
// 🎨 GHOST OVERLAY
// ============================================================
function Overlay(): JSX.Element {
  const navigate = useNavigate()
  const sessionData = useSessionStore()

  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState<'idle' | 'listening' | 'thinking'>('idle')
  const [transcript, setTranscript] = useState<string>('Waiting for interviewer to speak...')
  const [answer, setAnswer] = useState<string>('')
  const [sessionTime, setSessionTime] = useState<string>('00:00')
  const [stealthOn, setStealthOn] = useState<boolean>(true)
  const [copyFeedback, setCopyFeedback] = useState<string>('')
  const [aiMode, setAIMode] = useState<'local' | 'hybrid' | 'cloud'>('hybrid')

  // Edit mode
  const [isEditing, setIsEditing] = useState<boolean>(false)
  const [editedText, setEditedText] = useState<string>('')

  // Test box
  const [testQuestion, setTestQuestion] = useState<string>('')
  const [showTestBox, setShowTestBox] = useState<boolean>(true)

  // Shortcut states
  const [isPaused, setIsPaused] = useState<boolean>(false)
  const [lastQuestion, setLastQuestion] = useState<string>('')

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const sessionStartRef = useRef<number>(Date.now())
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const testTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 🎯 Refs to always access LATEST state (fixes stale closure in shortcuts)
  const lastQuestionRef = useRef<string>('')
  const answerRef = useRef<string>('')
  const statusRef = useRef<'idle' | 'listening' | 'thinking'>('idle')
  const isPausedRef = useRef<boolean>(false)

  // 🛡️ Debounce timestamps for shortcuts
  const shortcutTimestampsRef = useRef<{ [key: string]: number }>({
    regenerate: 0,
    copy: 0,
    pause: 0,
    clear: 0,
    focus: 0,
    chatQuestion: 0
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
  // 🔄 KEEP REFS IN SYNC WITH STATE (fixes stale closure bug)
  // ============================================================
  useEffect(() => {
    lastQuestionRef.current = lastQuestion
  }, [lastQuestion])

  useEffect(() => {
    answerRef.current = answer
  }, [answer])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  // ============================================================
  // 📸 INITIAL STEALTH STATUS
  // ============================================================
  useEffect(() => {
    window.api.getStealthStatus().then(setStealthOn)
  }, [])

  // ============================================================
  // 🎯 LOAD INITIAL AI MODE
  // ============================================================
  useEffect(() => {
    window.api.getAIMode().then((mode) => {
      if (mode === 'local' || mode === 'hybrid' || mode === 'cloud') {
        setAIMode(mode as 'local' | 'hybrid' | 'cloud')
      }
    })
  }, [])

  // ============================================================
  // 📡 WEBSOCKET
  // ============================================================
  useEffect(() => {
    let ws: WebSocket | null = null
    let isCleanedUp = false

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
          setTranscript(msg.text)
          setLastQuestion(msg.text)
          setStatus('thinking')
          setAnswer('')
          setIsEditing(false)
          break
        case 'answer_start':
          setStatus('thinking')
          setAnswer('')
          break
        case 'answer_token':
          setAnswer((prev) => prev + msg.token)
          break
        case 'answer_done':
          setStatus('idle')
          break
        case 'error':
          console.error('Backend error:', msg.message)
          setStatus('idle')
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
  // 📥 SEND SESSION CONTEXT TO BACKEND
  // ============================================================
  useEffect(() => {
    if (!connected) return
    const data = useSessionStore.getState()
    if (data.isSetupComplete && wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('📥 Sending session context to backend...')
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
  // 🛡️ DEBOUNCE HELPER for shortcuts
  // ============================================================
  const canFireShortcut = (key: string): boolean => {
    const now = Date.now()
    const lastFired = shortcutTimestampsRef.current[key] || 0
    if (now - lastFired < DEBOUNCE_MS) {
      console.log(`⏳ Shortcut "${key}" blocked (debounce)`)
      return false
    }
    shortcutTimestampsRef.current[key] = now
    return true
  }

  // ============================================================
  // ⌨️ LISTEN FOR CLIPBOARD QUESTION (Cmd+Shift+Q)
  // ============================================================
  useEffect(() => {
    window.api.onChatQuestion((text: string) => {
      if (!canFireShortcut('chatQuestion')) return

      // 🛡️ Block if AI is thinking (use REF!)
      if (statusRef.current === 'thinking') {
        setCopyFeedback('⏳ Wait for current answer...')
        setTimeout(() => setCopyFeedback(''), 1500)
        return
      }

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'chat_question', text }))
        setTranscript(`💬 [Chat] ${text}`)
        setLastQuestion(text)
        setStatus('thinking')
        setAnswer('')
        setIsEditing(false)
      }
    })
  }, [])

  // ============================================================
  // ⌨️ HANDLE GLOBAL KEYBOARD SHORTCUTS (using refs to avoid stale closures)
  // ============================================================
  useEffect(() => {
    // 🔄 Cmd+Shift+R → Regenerate current answer
    window.api.onRegenerateAnswer(() => {
      if (!canFireShortcut('regenerate')) return

      // Use REF to get latest values
      if (statusRef.current === 'thinking') {
        console.log('🔄 Regenerate blocked (already generating)')
        setCopyFeedback('⏳ Wait for current answer...')
        setTimeout(() => setCopyFeedback(''), 1500)
        return
      }

      const currentLastQuestion = lastQuestionRef.current
      if (!currentLastQuestion || wsRef.current?.readyState !== WebSocket.OPEN) {
        console.log('🔄 No last question available')
        setCopyFeedback('No previous question to regenerate')
        setTimeout(() => setCopyFeedback(''), 1500)
        return
      }

      console.log('🔄 Regenerating answer for:', currentLastQuestion)
      wsRef.current.send(
        JSON.stringify({ type: 'chat_question', text: currentLastQuestion })
      )
      setStatus('thinking')
      setAnswer('')
      setCopyFeedback('Regenerating...')
      setTimeout(() => setCopyFeedback(''), 1200)
    })

    // 📋 Cmd+Shift+C → Copy current answer
    window.api.onCopyAnswer(() => {
      if (!canFireShortcut('copy')) return
      const currentAnswer = answerRef.current
      if (!currentAnswer) {
        setCopyFeedback('No answer to copy')
        setTimeout(() => setCopyFeedback(''), 1500)
        return
      }
      window.api.copyToClipboard(currentAnswer)
      setCopyFeedback('Answer copied!')
      setTimeout(() => setCopyFeedback(''), 1500)
    })

    // ⏸️ Cmd+Shift+P → Pause/Resume listening
    window.api.onTogglePause(() => {
      if (!canFireShortcut('pause')) return
      if (wsRef.current?.readyState !== WebSocket.OPEN) return

      const newPaused = !isPausedRef.current
      setIsPaused(newPaused)
      wsRef.current.send(
        JSON.stringify({
          type: newPaused ? 'pause_listening' : 'resume_listening'
        })
      )
      setCopyFeedback(newPaused ? '⏸️ Paused' : '▶️ Resumed')
      setTimeout(() => setCopyFeedback(''), 1500)
    })

    // 🎯 Cmd+Shift+F → Focus test question box
    window.api.onFocusTestBox(() => {
      if (!canFireShortcut('focus')) return
      setShowTestBox(true)
      setTimeout(() => testTextareaRef.current?.focus(), 100)
    })

    // 🗑️ Cmd+Shift+K → Clear transcript + answer
    window.api.onClearContent(() => {
      if (!canFireShortcut('clear')) return
      setTranscript('Waiting for interviewer to speak...')
      setAnswer('')
      setLastQuestion('')
      setStatus('idle')
      setCopyFeedback('Cleared!')
      setTimeout(() => setCopyFeedback(''), 1200)
    })
  }, []) // ← Empty dependency array! Refs handle latest state

  // ============================================================
  // ✏️ EDIT MODE HANDLERS
  // ============================================================
  const handleStartEdit = async (): Promise<void> => {
    setEditedText(
      transcript
        .replace(/^💬 \[Chat\] /, '')
        .replace(/^✏️ \[Edited\] /, '')
        .replace(/^🧪 \[Test\] /, '')
    )
    setIsEditing(true)
    await window.api.enableFocus()
    setTimeout(() => {
      editTextareaRef.current?.focus()
      editTextareaRef.current?.select()
    }, 100)
  }

  const handleCancelEdit = async (): Promise<void> => {
    setIsEditing(false)
    setEditedText('')
    await window.api.disableFocus()
  }

  const handleRegenerate = async (): Promise<void> => {
    const question = editedText.trim()
    if (!question) return

    if (status === 'thinking') {
      setCopyFeedback('⏳ Wait for current answer...')
      setTimeout(() => setCopyFeedback(''), 1500)
      return
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat_question', text: question }))
      setTranscript(`✏️ [Edited] ${question}`)
      setLastQuestion(question)
      setStatus('thinking')
      setAnswer('')
      setIsEditing(false)
      await window.api.disableFocus()
    }
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleRegenerate()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  // ============================================================
  // 🧪 TEST QUESTION HANDLER
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
      setTranscript(`🧪 [Test] ${question}`)
      setLastQuestion(question)
      setStatus('thinking')
      setAnswer('')
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
  // 🎯 OTHER HANDLERS
  // ============================================================
  const handleToggleStealth = async (): Promise<void> => {
    const newStatus = await window.api.toggleStealth()
    setStealthOn(newStatus)
  }

  const handleAIModeChange = async (mode: 'local' | 'hybrid' | 'cloud'): Promise<void> => {
    setAIMode(mode)

    // Send to backend via WebSocket
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_ai_mode', mode }))
    }

    // Store in local Electron for persistence
    await window.api.setAIMode(mode)

    const label = mode === 'local' ? '🏠 Local' : mode === 'hybrid' ? '⚡ Hybrid' : '☁️ Cloud'
    setCopyFeedback(`Switched to ${label}`)
    setTimeout(() => setCopyFeedback(''), 1500)
  }

  const handleCopy = async (text: string, label: string): Promise<void> => {
    if (!text) return
    await window.api.copyToClipboard(text)
    setCopyFeedback(`${label} copied!`)
    setTimeout(() => setCopyFeedback(''), 1500)
  }

  // ============================================================
  // 🎨 STATUS HELPERS
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

  // ============================================================
  // 🎨 RENDER
  // ============================================================
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: 'rgba(15, 15, 25, 0.92)',
        borderRadius: '12px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        color: 'white',
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(20px)'
      }}
    >
      {/* HEADER (draggable) */}
      <div
        style={
          {
            height: '40px',
            background: 'rgba(255, 255, 255, 0.05)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
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
                background: 'rgba(92, 108, 255, 0.1)',
                padding: '2px 8px',
                borderRadius: '10px',
                marginLeft: '4px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
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
            background: 'rgba(255, 255, 255, 0.02)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
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
            transition: 'all 0.2s'
          }}
          title={stealthOn ? 'Invisible in screenshots' : 'Visible in screenshots'}
        >
          {stealthOn ? '👻 Stealth ON' : '📸 Stealth OFF'}
        </button>

        <button
          onClick={async () => {
            await window.api.enableFocus()
            await window.api.resizeWindow(750, 800)
            navigate('/')
          }}
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            color: 'rgba(255, 255, 255, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer'
          }}
          title="Go back to setup screen"
        >
          ⚙️ Setup
        </button>
        {/* AI Mode Selector */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            marginLeft: '8px',
            padding: '2px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '6px'
          }}
        >
          <button
            onClick={() => handleAIModeChange('local')}
            title="Local only (100% private, slower)"
            style={{
              background: aiMode === 'local' ? 'rgba(255, 165, 2, 0.25)' : 'transparent',
              color: aiMode === 'local' ? '#ffa502' : 'rgba(255, 255, 255, 0.5)',
              border: 'none',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            🏠 Local
          </button>
          <button
            onClick={() => handleAIModeChange('hybrid')}
            title="Smart routing (recommended: fast + private)"
            style={{
              background: aiMode === 'hybrid' ? 'rgba(92, 108, 255, 0.25)' : 'transparent',
              color: aiMode === 'hybrid' ? '#5c6cff' : 'rgba(255, 255, 255, 0.5)',
              border: 'none',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            ⚡ Hybrid
          </button>
          <button
            onClick={() => handleAIModeChange('cloud')}
            title="Cloud only (fastest, uses Groq)"
            style={{
              background: aiMode === 'cloud' ? 'rgba(46, 213, 115, 0.25)' : 'transparent',
              color: aiMode === 'cloud' ? '#2ed573' : 'rgba(255, 255, 255, 0.5)',
              border: 'none',
              borderRadius: '4px',
              padding: '3px 8px',
              fontSize: '10px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            ☁️ Cloud
          </button>
        </div>

        {copyFeedback && (
          <span
            style={{
              fontSize: '10px',
              color: copyFeedback.includes('⏳') || copyFeedback.includes('No ')
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

      {/* MAIN CONTENT */}
      <div
        style={
          {
            flex: 1,
            padding: '14px 16px',
            overflowY: 'auto',
            WebkitAppRegion: 'no-drag'
          } as React.CSSProperties
        }
      >
        {/* Test Question Box */}
        {showTestBox && (
          <div
            style={{
              marginBottom: '14px',
              padding: '12px',
              background: 'rgba(92, 108, 255, 0.08)',
              border: '1px solid rgba(92, 108, 255, 0.25)',
              borderRadius: '8px'
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
              <div
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  color: '#a0aaff',
                  letterSpacing: '0.5px'
                }}
              >
                🧪 TEST QUESTION (Manual Input)
              </div>
              <button
                onClick={() => setShowTestBox(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.4)',
                  cursor: 'pointer',
                  fontSize: '14px',
                  padding: '0 4px'
                }}
                title="Hide test box"
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
              placeholder="Type any interview question here... (Cmd+Enter to submit)"
              style={{
                width: '100%',
                minHeight: '60px',
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
                lineHeight: 1.5
              }}
            />

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '8px'
              }}
            >
              <span style={{ fontSize: '10px', opacity: 0.5 }}>💡 Cmd+Enter to send</span>
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
                  padding: '6px 14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor:
                    testQuestion.trim() && status !== 'thinking' ? 'pointer' : 'not-allowed',
                  boxShadow:
                    testQuestion.trim() && status !== 'thinking'
                      ? '0 2px 8px rgba(55, 66, 250, 0.4)'
                      : 'none'
                }}
              >
                {status === 'thinking' ? '⏳ THINKING...' : '🚀 ASK AI'}
              </button>
            </div>
          </div>
        )}

        {!showTestBox && (
          <button
            onClick={() => setShowTestBox(true)}
            style={{
              width: '100%',
              padding: '8px',
              marginBottom: '14px',
              background: 'rgba(92, 108, 255, 0.08)',
              border: '1px dashed rgba(92, 108, 255, 0.3)',
              borderRadius: '6px',
              color: '#a0aaff',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            🧪 Show Test Question Box
          </button>
        )}

        {/* Transcript / Edit Section */}
        <div style={{ marginBottom: '16px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '6px'
            }}
          >
            <div
              style={{
                opacity: 0.5,
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.5px'
              }}
            >
              {isEditing ? '✏️  EDIT QUESTION' : 'INTERVIEWER IS SAYING'}
            </div>

            <div style={{ display: 'flex', gap: '6px' }}>
              {!isEditing ? (
                <>
                  <button
                    onClick={handleStartEdit}
                    style={{
                      background: 'rgba(55, 66, 250, 0.15)',
                      border: '1px solid rgba(55, 66, 250, 0.4)',
                      color: '#5c6cff',
                      borderRadius: '4px',
                      padding: '3px 10px',
                      fontSize: '10px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    title="Edit and regenerate"
                  >
                    ✏️ EDIT
                  </button>
                  <button
                    onClick={() => handleCopy(transcript, 'Question')}
                    style={{
                      background: 'rgba(255, 165, 2, 0.15)',
                      border: '1px solid rgba(255, 165, 2, 0.3)',
                      color: '#ffa502',
                      borderRadius: '4px',
                      padding: '3px 10px',
                      fontSize: '10px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    title="Copy question"
                  >
                    📋 COPY
                  </button>
                </>
              ) : (
                <button
                  onClick={handleCancelEdit}
                  style={{
                    background: 'rgba(255, 71, 87, 0.15)',
                    border: '1px solid rgba(255, 71, 87, 0.4)',
                    color: '#ff4757',
                    borderRadius: '4px',
                    padding: '3px 10px',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  title="Cancel editing"
                >
                  ✖ CANCEL
                </button>
              )}
            </div>
          </div>

          {!isEditing ? (
            <div
              onDoubleClick={handleStartEdit}
              style={
                {
                  fontSize: '13px',
                  color: '#ffa502',
                  lineHeight: 1.5,
                  padding: '10px 12px',
                  background: 'rgba(255, 165, 2, 0.08)',
                  border: '1px solid rgba(255, 165, 2, 0.2)',
                  borderRadius: '8px',
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  cursor: 'pointer'
                } as React.CSSProperties
              }
              title="Double-click to edit"
            >
              {transcript}
            </div>
          ) : (
            <div>
              <textarea
                ref={editTextareaRef}
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder="Fix the question here..."
                style={{
                  width: '100%',
                  minHeight: '80px',
                  fontSize: '13px',
                  color: '#ffffff',
                  lineHeight: 1.5,
                  padding: '10px 12px',
                  background: 'rgba(55, 66, 250, 0.08)',
                  border: '1px solid rgba(55, 66, 250, 0.4)',
                  borderRadius: '8px',
                  outline: 'none',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '8px'
                }}
              >
                <span style={{ fontSize: '10px', opacity: 0.5 }}>
                  💡 Cmd+Enter to regenerate · Esc to cancel
                </span>
                <button
                  onClick={handleRegenerate}
                  disabled={!editedText.trim() || status === 'thinking'}
                  style={{
                    background:
                      editedText.trim() && status !== 'thinking'
                        ? 'linear-gradient(135deg, #5c6cff 0%, #3742fa 100%)'
                        : 'rgba(255, 255, 255, 0.05)',
                    border: 'none',
                    color:
                      editedText.trim() && status !== 'thinking'
                        ? 'white'
                        : 'rgba(255,255,255,0.3)',
                    borderRadius: '6px',
                    padding: '6px 14px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor:
                      editedText.trim() && status !== 'thinking' ? 'pointer' : 'not-allowed',
                    boxShadow:
                      editedText.trim() && status !== 'thinking'
                        ? '0 2px 8px rgba(55, 66, 250, 0.4)'
                        : 'none'
                  }}
                >
                  {status === 'thinking' ? '⏳ WAIT...' : '🔄 REGENERATE'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Answer Section */}
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '6px'
            }}
          >
            <div
              style={{
                opacity: 0.5,
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.5px'
              }}
            >
              SUGGESTED ANSWER
            </div>
            <button
              onClick={() => handleCopy(answer, 'Answer')}
              disabled={!answer}
              style={{
                background: answer ? 'rgba(46, 213, 115, 0.15)' : 'transparent',
                border: '1px solid rgba(46, 213, 115, 0.3)',
                color: answer ? '#2ed573' : 'rgba(255, 255, 255, 0.2)',
                borderRadius: '4px',
                padding: '3px 10px',
                fontSize: '10px',
                fontWeight: 600,
                cursor: answer ? 'pointer' : 'not-allowed'
              }}
              title="Copy full answer"
            >
              📋 COPY ALL
            </button>
          </div>
          <div
            onDoubleClick={() => answer && handleCopy(answer, 'Answer')}
            style={
              {
                fontSize: '14px',
                lineHeight: 1.6,
                padding: '12px 14px',
                background: 'rgba(46, 213, 115, 0.06)',
                border: '1px solid rgba(46, 213, 115, 0.15)',
                borderRadius: '8px',
                minHeight: '80px',
                userSelect: 'text',
                WebkitUserSelect: 'text',
                cursor: answer ? 'copy' : 'default'
              } as React.CSSProperties
            }
            title={answer ? 'Double-click to copy entire answer' : ''}
          >
            {answer ? (
              <MessageRenderer content={answer} onCopyCode={(code) => handleCopy(code, 'Code')} />
            ) : (
              <span style={{ opacity: 0.4, fontStyle: 'italic' }}>
                {status === 'thinking'
                  ? 'Generating answer...'
                  : 'AI answers will stream here after a question is detected.'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM STATUS BAR */}
      <div
        style={{
          height: '28px',
          background: 'rgba(255, 255, 255, 0.03)',
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
        <span>{connected ? '🟢 Connected to backend' : '🔴 Backend offline'}</span>
        <span>⌘⇧H hide · ⌘⇧Q ask · ⌘⇧R regen · ⌘⇧K clear</span>
      </div>
    </div>
  )
}

export default Overlay