import { useEffect, useRef, useState, ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from '../store/sessionStore'
import * as pdfjsLib from 'pdfjs-dist'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).toString()

function SetupScreen(): JSX.Element {
    const navigate = useNavigate()
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const [isProcessingPdf, setIsProcessingPdf] = useState(false)
    const [pdfError, setPdfError] = useState('')

    const {
        resume,
        resumeFileName,
        company,
        position,
        jobDescription,
        setResume,
        setCompany,
        setPosition,
        setJobDescription,
        markSetupComplete,
        resetSession
    } = useSessionStore()

    // ============================================================
    // Setup window — enable focus + resize
    // ============================================================
    useEffect(() => {
        window.api.enableFocus()
        window.api.resizeWindow(750, 800)
        window.api.setResizable(true)
    }, [])

    // ============================================================
    // PDF Upload Handler
    // ============================================================
    const handlePdfUpload = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
        const file = e.target.files?.[0]
        if (!file) return

        if (file.type !== 'application/pdf') {
            setPdfError('Please upload a PDF file')
            return
        }

        setIsProcessingPdf(true)
        setPdfError('')

        try {
            const arrayBuffer = await file.arrayBuffer()
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
            let fullText = ''

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i)
                const content = await page.getTextContent()
                const pageText = content.items
                    .map((item: any) => item.str)
                    .join(' ')
                fullText += pageText + '\n\n'
            }

            setResume(fullText.trim(), file.name)
        } catch (err) {
            console.error('PDF parse error:', err)
            setPdfError('Failed to read PDF. Try pasting text instead.')
        } finally {
            setIsProcessingPdf(false)
        }
    }

    // ============================================================
    // Validation
    // ============================================================
    const isFormValid = (): boolean => {
        return !!(
            resume.trim() &&
            company.trim() &&
            position.trim() &&
            jobDescription.trim()
        )
    }

    // ============================================================
    // Start Session Handler
    // ============================================================
    const handleStartSession = async (): Promise<void> => {
        markSetupComplete()
        await window.api.resizeWindow(480, 720)
        await window.api.disableFocus()
        navigate('/overlay')
    }

    const handleClearAll = (): void => {
        if (confirm('Clear all fields? This cannot be undone.')) {
            resetSession()
        }
    }

    // ============================================================
    // RENDER
    // ============================================================
    return (
        <div
            style={{
                width: '100vw',
                height: '100vh',
                background: 'linear-gradient(135deg, #0f0f19 0%, #1a1a2e 100%)',
                color: 'white',
                fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }}
        >
            {/* ============================================ */}
            {/* HEADER (DRAGGABLE)                          */}
            {/* ============================================ */}
            <div
                style={
                    {
                        padding: '14px 20px',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: 'rgba(255, 255, 255, 0.03)',
                        WebkitAppRegion: 'drag',
                        cursor: 'move',
                        flexShrink: 0
                    } as React.CSSProperties
                }
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>👻</span>
                    <span style={{ fontSize: '15px', fontWeight: 700 }}>GHOST</span>
                    <span style={{ fontSize: '11px', opacity: 0.5 }}>Interview Setup</span>
                </div>
                <span style={{ fontSize: '10px', opacity: 0.4 }}>Drag to move</span>
            </div>

            {/* ============================================ */}
            {/* MAIN CONTENT (SCROLLABLE)                   */}
            {/* ============================================ */}
            <div
                style={
                    {
                        flex: 1,
                        padding: '24px 40px',
                        overflowY: 'auto',
                        WebkitAppRegion: 'no-drag'
                    } as React.CSSProperties
                }
            >
                <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                    {/* Intro */}
                    <h1
                        style={{
                            fontSize: '24px',
                            fontWeight: 700,
                            marginBottom: '6px'
                        }}
                    >
                        Let's personalize your AI 🎯
                    </h1>
                    <p
                        style={{
                            fontSize: '13px',
                            opacity: 0.6,
                            marginBottom: '28px',
                            lineHeight: 1.5
                        }}
                    >
                        Provide your resume, company details, and job description so Ghost can
                        generate accurate, personalized answers during your interview.
                    </p>

                    {/* ============================================ */}
                    {/* RESUME SECTION                              */}
                    {/* ============================================ */}
                    <div style={fieldWrapper}>
                        <div style={labelRow}>
                            <label style={labelStyle}>📄 YOUR RESUME *</label>
                            {resumeFileName && (
                                <span style={fileTagStyle}>📎 {resumeFileName}</span>
                            )}
                        </div>

                        <textarea
                            value={resume}
                            onChange={(e) => setResume(e.target.value, resumeFileName)}
                            placeholder="Paste your resume text here, or upload a PDF below..."
                            style={{ ...textareaStyle, minHeight: '140px' }}
                        />

                        {/* PDF Upload */}
                        <div
                            style={{
                                marginTop: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px'
                            }}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="application/pdf"
                                onChange={handlePdfUpload}
                                style={{ display: 'none' }}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isProcessingPdf}
                                style={{
                                    padding: '8px 14px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: '#5c6cff',
                                    background: 'rgba(92, 108, 255, 0.1)',
                                    border: '1px solid rgba(92, 108, 255, 0.3)',
                                    borderRadius: '6px',
                                    cursor: isProcessingPdf ? 'wait' : 'pointer'
                                }}
                            >
                                {isProcessingPdf ? '⏳ Reading PDF...' : '📎 Upload PDF'}
                            </button>

                            {pdfError && (
                                <span style={{ fontSize: '11px', color: '#ff4757' }}>{pdfError}</span>
                            )}

                            <span
                                style={{
                                    fontSize: '11px',
                                    opacity: 0.4,
                                    marginLeft: 'auto'
                                }}
                            >
                                {resume.length} characters
                            </span>
                        </div>
                    </div>

                    {/* ============================================ */}
                    {/* COMPANY + POSITION (side by side)           */}
                    {/* ============================================ */}
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '16px'
                        }}
                    >
                        <div style={fieldWrapper}>
                            <label style={labelStyle}>🏢 COMPANY NAME *</label>
                            <input
                                type="text"
                                value={company}
                                onChange={(e) => setCompany(e.target.value)}
                                placeholder="e.g. Google"
                                style={inputStyle}
                            />
                        </div>

                        <div style={fieldWrapper}>
                            <label style={labelStyle}>💼 POSITION *</label>
                            <input
                                type="text"
                                value={position}
                                onChange={(e) => setPosition(e.target.value)}
                                placeholder="e.g. Senior Frontend Engineer"
                                style={inputStyle}
                            />
                        </div>
                    </div>

                    {/* ============================================ */}
                    {/* JOB DESCRIPTION                             */}
                    {/* ============================================ */}
                    <div style={fieldWrapper}>
                        <label style={labelStyle}>📋 JOB DESCRIPTION *</label>
                        <textarea
                            value={jobDescription}
                            onChange={(e) => setJobDescription(e.target.value)}
                            placeholder="Paste the full job description here..."
                            style={{ ...textareaStyle, minHeight: '140px' }}
                        />
                        <div
                            style={{
                                fontSize: '11px',
                                opacity: 0.4,
                                marginTop: '4px',
                                textAlign: 'right'
                            }}
                        >
                            {jobDescription.length} characters
                        </div>
                    </div>
                </div>
            </div>

            {/* ============================================ */}
            {/* FOOTER (ACTION BUTTONS)                     */}
            {/* ============================================ */}
            <div
                style={
                    {
                        padding: '16px 40px',
                        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: 'rgba(0, 0, 0, 0.2)',
                        WebkitAppRegion: 'no-drag',
                        flexShrink: 0
                    } as React.CSSProperties
                }
            >
                <button
                    onClick={handleClearAll}
                    style={{
                        padding: '10px 18px',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: 'rgba(255, 71, 87, 0.8)',
                        background: 'transparent',
                        border: '1px solid rgba(255, 71, 87, 0.3)',
                        borderRadius: '8px',
                        cursor: 'pointer'
                    }}
                >
                    🗑️ Clear All
                </button>

                <div style={{ fontSize: '11px', opacity: 0.5 }}>
                    {isFormValid() ? '✓ Ready to start' : '⚠️ Fill all required fields'}
                </div>

                <button
                    onClick={handleStartSession}
                    disabled={!isFormValid()}
                    style={{
                        padding: '11px 26px',
                        fontSize: '13px',
                        fontWeight: 700,
                        color: 'white',
                        background: isFormValid()
                            ? 'linear-gradient(135deg, #2ed573 0%, #26ab5f 100%)'
                            : 'rgba(255,255,255,0.05)',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: isFormValid() ? 'pointer' : 'not-allowed',
                        boxShadow: isFormValid() ? '0 4px 15px rgba(46, 213, 115, 0.4)' : 'none',
                        opacity: isFormValid() ? 1 : 0.4
                    }}
                >
                    ▶ START GHOST SESSION
                </button>
            </div>
        </div>
    )
}

// ============================================================
// SHARED STYLES
// ============================================================
const fieldWrapper: React.CSSProperties = {
    marginBottom: '20px'
}

const labelRow: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '6px'
}

const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    color: 'rgba(255, 255, 255, 0.6)',
    letterSpacing: '0.5px'
}

const fileTagStyle: React.CSSProperties = {
    fontSize: '10px',
    color: '#5c6cff',
    background: 'rgba(92, 108, 255, 0.1)',
    padding: '2px 8px',
    borderRadius: '10px'
}

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    fontSize: '13px',
    color: 'white',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '8px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit'
}

const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    resize: 'vertical',
    lineHeight: 1.5
}

export default SetupScreen