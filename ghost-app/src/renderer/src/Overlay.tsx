import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from './store/sessionStore'
import { useNavigate } from 'react-router-dom'
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
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState<'idle' | 'listening' | 'thinking'>('idle')
  const [transcript, setTranscript] = useState<string>('Waiting for interviewer to speak...')
  const [answer, setAnswer] = useState<string>('')
  const [sessionTime, setSessionTime] = useState<string>('00:00')
  const [stealthOn, setStealthOn] = useState<boolean>(true)
  const [copyFeedback, setCopyFeedback] = useState<string>('')
  const [testQuestion, setTestQuestion] = useState<string>('')
  const [showTestBox, setShowTestBox] = useState<boolean>(true)
  const testTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  // 🆕 Edit mode state
  const [isEditing, setIsEditing] = useState<boolean>(false)
  const [editedText, setEditedText] = useState<string>('')
  const sessionData = useSessionStore()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const sessionStartRef = useRef<number>(Date.now())
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const navigate = useNavigate()
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
  // 📥 SEND SESSION DATA TO BACKEND (once WebSocket connects)
  // ============================================================
  useEffect(() => {
    if (!connected) return

    const sessionData = useSessionStore.getState()

    if (sessionData.isSetupComplete && wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('📥 Sending session context to backend...')
      wsRef.current.send(
        JSON.stringify({
          type: 'load_session',
          resume: sessionData.resume,
          company: sessionData.company,
          position: sessionData.position,
          job_description: sessionData.jobDescription
        })
      )
    }
  }, [connected])

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
          setStatus('thinking')
          setAnswer('')
          setIsEditing(false) // Exit edit mode on new transcript
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
  // ⌨️ CLIPBOARD QUESTION
  // ============================================================
  useEffect(() => {
    window.api.onChatQuestion((text: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'chat_question', text }))
        setTranscript(`💬 [Chat] ${text}`)
        setStatus('thinking')
        setAnswer('')
        setIsEditing(false)
      }
    })
  }, [])

  // ============================================================
  // ✏️ EDIT MODE HANDLERS
  // ============================================================
  const handleStartEdit = async (): Promise<void> => {
    setEditedText(transcript.replace(/^💬 \[Chat\] /, '').replace(/^✏️ \[Edited\] /, ''))
    setIsEditing(true)

    // 🎯 Enable window focus so user can type
    await window.api.enableFocus()

    // Focus textarea after render
    setTimeout(() => {
      editTextareaRef.current?.focus()
      editTextareaRef.current?.select()
    }, 100)
  }

  const handleCancelEdit = async (): Promise<void> => {
    setIsEditing(false)
    setEditedText('')

    // 🎯 Disable focus again so typing in other apps stays smooth
    await window.api.disableFocus()
  }

  const handleRegenerate = async (): Promise<void> => {
    const question = editedText.trim()
    if (!question) return

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat_question', text: question }))
      setTranscript(`✏️ [Edited] ${question}`)
      setStatus('thinking')
      setAnswer('')
      setIsEditing(false)

      // 🎯 Disable focus after submit
      await window.api.disableFocus()
    }
  }

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Cmd/Ctrl + Enter → submit
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleRegenerate()
    }
    // Escape → cancel
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  // ============================================================
  // 🎯 OTHER HANDLERS
  // ============================================================
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

  // ============================================================
  // 🧪 TEST QUESTION HANDLER
  // ============================================================
  const handleTestQuestion = async (): Promise<void> => {
    const question = testQuestion.trim()
    if (!question) return

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat_question', text: question }))
      setTranscript(`🧪 [Test] ${question}`)
      setStatus('thinking')
      setAnswer('')
      setTestQuestion('') // Clear box after sending
    }
  }

  const handleTestKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Cmd/Ctrl + Enter → submit
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleTestQuestion()
    }
  }

  // Focus test box on click
  const handleTestBoxFocus = async (): Promise<void> => {
    await window.api.enableFocus()
    setTimeout(() => testTextareaRef.current?.focus(), 50)
  }

  const handleTestBoxBlur = async (): Promise<void> => {
    await window.api.disableFocus()
  }

  // ============================================================
  // 🎨 STATUS HELPERS
  // ============================================================
  const getStatusColor = (): string => {
    if (!connected) return '#ff4757'
    if (status === 'listening') return '#ffa502'
    if (status === 'thinking') return '#3742fa'
    return '#2ed573'
  }

  const getStatusText = (): string => {
    if (!connected) return 'Disconnected'
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
      {/* ============================================ */}
      {/* HEADER (draggable)                          */}
      {/* ============================================ */}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                marginLeft: '4px'
              }}
            >
              {sessionData.company} · {sessionData.position}
            </span>
          )}
          <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: 'auto' }}>{getStatusText()}</span>
        </div>
        <div style={{ fontSize: '11px', opacity: 0.6, fontFamily: 'monospace' }}>
          {sessionTime}
        </div>
      </div>

      {/* ============================================ */}
      {/* TOGGLE BAR                                  */}
      {/* ============================================ */}
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
            cursor: 'pointer'
          }}
          title={stealthOn ? 'Invisible in screenshots' : 'Visible in screenshots'}
        >
          {stealthOn ? '👻 Stealth ON' : '📸 Stealth OFF'}
        </button>
        {/* Back to Setup button */}
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

        {copyFeedback && (
          <span
            style={{
              fontSize: '10px',
              color: '#2ed573',
              marginLeft: 'auto',
              fontWeight: 600
            }}
          >
            ✓ {copyFeedback}
          </span>
        )}
      </div>

      {/* ============================================ */}
      {/* MAIN CONTENT                                */}
      {/* ============================================ */}
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

        {/* ============================================ */}
        {/* 🧪 TEST QUESTION BOX (for pre-interview)    */}
        {/* ============================================ */}
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
              <span style={{ fontSize: '10px', opacity: 0.5 }}>
                💡 Cmd+Enter to send
              </span>
              <button
                onClick={handleTestQuestion}
                disabled={!testQuestion.trim() || status === 'thinking'}
                style={{
                  background: testQuestion.trim()
                    ? 'linear-gradient(135deg, #5c6cff 0%, #3742fa 100%)'
                    : 'rgba(255, 255, 255, 0.05)',
                  border: 'none',
                  color: testQuestion.trim() ? 'white' : 'rgba(255, 255, 255, 0.3)',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: testQuestion.trim() ? 'pointer' : 'not-allowed',
                  boxShadow: testQuestion.trim()
                    ? '0 2px 8px rgba(55, 66, 250, 0.4)'
                    : 'none'
                }}
              >
                🚀 ASK AI
              </button>
            </div>
          </div>
        )}

        {/* Show button to bring back test box if hidden */}
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

        {/* ============================================ */}
        {/* 📝 TRANSCRIPT / EDIT SECTION                */}
        {/* ============================================ */}
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
                    title="Edit the transcribed question and regenerate"
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
                    title="Copy question to clipboard"
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

          {/* --- Display Mode OR Edit Mode --- */}
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
                  disabled={!editedText.trim()}
                  style={{
                    background: editedText.trim()
                      ? 'linear-gradient(135deg, #5c6cff 0%, #3742fa 100%)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: 'none',
                    color: editedText.trim() ? 'white' : 'rgba(255,255,255,0.3)',
                    borderRadius: '6px',
                    padding: '6px 14px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: editedText.trim() ? 'pointer' : 'not-allowed',
                    boxShadow: editedText.trim()
                      ? '0 2px 8px rgba(55, 66, 250, 0.4)'
                      : 'none'
                  }}
                >
                  🔄 REGENERATE ANSWER
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ============================================ */}
        {/* 💬 ANSWER SECTION                           */}
        {/* ============================================ */}
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
                whiteSpace: 'pre-wrap',
                userSelect: 'text',
                WebkitUserSelect: 'text',
                cursor: answer ? 'copy' : 'default'
              } as React.CSSProperties
            }
            title={answer ? 'Double-click to copy' : ''}
          >
            {answer || (
              <span style={{ opacity: 0.4, fontStyle: 'italic' }}>
                {status === 'thinking'
                  ? 'Generating answer...'
                  : 'AI answers will stream here after a question is detected.'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ============================================ */}
      {/* BOTTOM STATUS BAR                           */}
      {/* ============================================ */}
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
          opacity: 0.5,
          flexShrink: 0
        }}
      >
        <span>{connected ? '🟢 Connected to backend' : '🔴 Backend offline'}</span>
        <span>Local · Private · Free</span>
      </div>
    </div>
  )
}

export default Overlay;