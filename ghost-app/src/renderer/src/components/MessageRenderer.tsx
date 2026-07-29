import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useState } from 'react'

interface MessageRendererProps {
  content: string
  onCopyCode?: (code: string) => void
}

/**
 * 🎨 Renders text with:
 * - Markdown formatting (bold, italic, headers, bullets)
 * - Syntax-highlighted code blocks
 * - Inline code
 * - Copy button on each code block
 */
function MessageRenderer({ content, onCopyCode }: MessageRendererProps): JSX.Element {
  return (
    <div className="ghost-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // ============================================
          // CODE BLOCKS (```language ... ```)
          // ============================================
          code({ inline, className, children, ...props }: any) {
            const codeString = String(children).replace(/\n$/, '')
            const match = /language-(\w+)/.exec(className || '')

            // 🎯 Smart inline detection
            // Consider it INLINE if:
            // - react-markdown says inline=true
            // - OR no language class AND single line AND short
            // - OR no newline in the content AND under 60 chars
            const isInline =
              inline === true ||
              (!className && !codeString.includes('\n') && codeString.length < 80)

            if (isInline) {
              return (
                <code
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontFamily: 'JetBrains Mono, Menlo, monospace',
                    fontSize: '12px',
                    color: '#ffb86c',
                    fontWeight: 500
                  }}
                  {...props}
                >
                  {children}
                </code>
              )
            }

            // Block code with syntax highlighting
            return (
              <CodeBlock
                language={match?.[1] || 'text'}
                code={codeString}
                onCopy={onCopyCode}
              />
            )
          },

          // ============================================
          // PARAGRAPHS
          // ============================================
          p: ({ children }) => (
            <p
              style={{
                margin: '0 0 8px 0',
                lineHeight: 1.6,
                fontSize: '13px'
              }}
            >
              {children}
            </p>
          ),

          // ============================================
          // HEADINGS
          // ============================================
          h1: ({ children }) => (
            <h1 style={{ fontSize: '16px', fontWeight: 700, margin: '10px 0 6px', color: '#fff' }}>
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontSize: '14px', fontWeight: 700, margin: '10px 0 6px', color: '#fff' }}>
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontSize: '13px', fontWeight: 700, margin: '8px 0 4px', color: '#fff' }}>
              {children}
            </h3>
          ),

          // ============================================
          // BULLET LISTS
          // ============================================
          ul: ({ children }) => (
            <ul
              style={{
                margin: '6px 0',
                paddingLeft: '20px',
                lineHeight: 1.6
              }}
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              style={{
                margin: '6px 0',
                paddingLeft: '20px',
                lineHeight: 1.6
              }}
            >
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: '3px 0', fontSize: '13px' }}>{children}</li>
          ),

          // ============================================
          // BOLD & ITALIC
          // ============================================
          strong: ({ children }) => (
            <strong style={{ color: '#fff', fontWeight: 700 }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em style={{ color: '#c8d6e5', fontStyle: 'italic' }}>{children}</em>
          ),

          // ============================================
          // BLOCKQUOTES
          // ============================================
          blockquote: ({ children }) => (
            <blockquote
              style={{
                borderLeft: '3px solid rgba(255, 255, 255, 0.2)',
                paddingLeft: '10px',
                margin: '8px 0',
                color: 'rgba(255, 255, 255, 0.7)',
                fontStyle: 'italic'
              }}
            >
              {children}
            </blockquote>
          ),

          // ============================================
          // LINKS
          // ============================================
          a: ({ children, href }) => (
            <a
              href={href}
              style={{ color: '#5c6cff', textDecoration: 'underline' }}
              target="_blank"
              rel="noreferrer"
            >
              {children}
            </a>
          ),

          // ============================================
          // HORIZONTAL RULE
          // ============================================
          hr: () => (
            <hr
              style={{
                border: 'none',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                margin: '10px 0'
              }}
            />
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// ============================================================
// 🎨 CODE BLOCK COMPONENT (with copy button)
// ============================================================
interface CodeBlockProps {
  language: string
  code: string
  onCopy?: (code: string) => void
}

function CodeBlock({ language, code, onCopy }: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = (): void => {
    if (onCopy) onCopy(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      style={{
        position: 'relative',
        margin: '8px 0',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        background: '#1e1e2e'
      }}
    >
      {/* Header with language + copy button */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          background: 'rgba(0, 0, 0, 0.3)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.5px'
        }}
      >
        <span
          style={{
            color: '#8b8fa3',
            textTransform: 'uppercase'
          }}
        >
          {language}
        </span>
        <button
          onClick={handleCopy}
          style={{
            background: copied ? 'rgba(46, 213, 115, 0.2)' : 'transparent',
            border: `1px solid ${copied ? '#2ed573' : 'rgba(255, 255, 255, 0.15)'}`,
            color: copied ? '#2ed573' : 'rgba(255, 255, 255, 0.6)',
            borderRadius: '4px',
            padding: '2px 8px',
            fontSize: '10px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>

      {/* The actual code */}
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          padding: '12px',
          fontSize: '12px',
          background: 'transparent',
          fontFamily: 'JetBrains Mono, Menlo, monospace',
          lineHeight: 1.5
        }}
        showLineNumbers={code.split('\n').length > 5}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

export default MessageRenderer