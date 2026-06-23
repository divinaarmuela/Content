'use client'

import { usePathname } from 'next/navigation'
import { ClerkProvider } from '@clerk/nextjs'
import { motion, AnimatePresence } from 'framer-motion'
import SilkBackground from '@/app/components/SilkBackground'
import { s } from './auth-ui'
import './auth.css'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const isSignUp = path.startsWith('/sign-up')

  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: '#5d5fef',
          colorForeground: '#1f1b2e',
          colorMutedForeground: '#7b7990',
          colorBackground: '#ffffff',
          colorInput: '#faf9fd',
          colorInputForeground: '#1f1b2e',
          borderRadius: '8px',
          fontFamily: "var(--font-sans, 'Inter', sans-serif)",
        },
        elements: {
          rootBox: { width: '100%', display: 'flex', justifyContent: 'center' },
          cardBox: {
            width: '100%', maxWidth: 420,
            boxShadow: '0 0 0 1px rgba(31,27,46,0.08), 0 8px 32px rgba(31,27,46,0.06)',
            borderRadius: 16,
          },
          card: { padding: '36px 32px' },
          headerTitle: { fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' },
          headerSubtitle: { fontSize: 13, color: '#7b7990' },
          socialButtonsBlockButton: { borderColor: '#e8e7ef' },
          formButtonPrimary: {
            fontSize: 13, fontWeight: 600, textTransform: 'none',
            boxShadow: 'none',
          },
          footerActionLink: { color: '#5d5fef', fontWeight: 600 },
        },
      }}
    >
    <div className="auth-shell" style={s.shell}>
      {/* ── Left panel — silk lives here so it persists across sign-in/up ── */}
      <div className="auth-left" style={s.left}>
        <SilkBackground color="#6e70ff" speed={0.5} />
        <div className="auth-left-content" style={s.leftContent}>
          <div style={s.leftInner}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="auth-logo" src="/MDLogo-trim.png" alt="MD Media" style={s.logoImg} />

            <AnimatePresence mode="wait">
              <motion.div
                className="auth-hero"
                key={isSignUp ? 'signup' : 'signin'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.32, ease: 'easeOut' }}
                style={{ display: 'flex', flexDirection: 'column', gap: 40 }}
              >
                {isSignUp ? (
                  <>
                    <div>
                      <h1 style={s.heroTitle}>Join the<br />team workspace.</h1>
                      <p style={s.heroSub}>Your account will need to be assigned a role before you can access the full dashboard.</p>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column' }}>
                      {[
                        { r: 'Admin',           d: 'Full access to all pages and settings' },
                        { r: 'Account Manager', d: 'Clients, production, workflow' },
                        { r: 'Editor',          d: 'Production board, your assigned content' },
                        { r: 'Scheduler',       d: 'Scheduler queue and calendar' },
                        { r: 'Client',          d: 'Client portal, your content only' },
                      ].map(({ r, d }) => (
                        <div key={r} style={{ marginBottom: 8 }}>
                          <p style={{ fontSize:12, fontWeight:600, color:'#c5c3d6', margin:'0 0 1px' }}>{r}</p>
                          <p style={{ fontSize:11, color:'#8884a0', margin:0 }}>{d}</p>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <h1 style={s.heroTitle}>Your content<br />operation, unified.</h1>
                      <p style={s.heroSub}>
                        Production board, client workspaces, scheduler queue and reporting, all in one place.
                      </p>
                    </div>
                    <div style={s.pillRow}>
                      {['Production Board', 'Client Portals', 'Scheduler', 'Reports', 'Activity Log'].map(label => (
                        <span key={label} style={s.pill}>{label}</span>
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="auth-foot" style={s.leftFooter}>© 2026 MD Media Marketing · Melbourne</p>
        </div>
      </div>

      {/* ── Right panel — the swapping form ── */}
      <div className="auth-right" style={s.right}>
        {children}
      </div>
    </div>
    </ClerkProvider>
  )
}
