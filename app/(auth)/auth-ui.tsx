'use client'

import type { CSSProperties } from 'react'

export const s: Record<string, CSSProperties> = {
  shell:    { display:'flex', minHeight:'100vh', fontFamily:"var(--font-sans,-apple-system,BlinkMacSystemFont,'Inter',sans-serif)", WebkitFontSmoothing:'antialiased' },
  left:     { width:'45%', position:'relative', overflow:'hidden', minHeight:'100vh' },
  leftContent: { position:'relative', zIndex:1, display:'flex', flexDirection:'column', justifyContent:'space-between', height:'100%', padding:'48px 52px' },
  leftInner:{ display:'flex', flexDirection:'column', gap:40 },
  logoImg:  { height:18, width:'auto', maxWidth:120, display:'block', filter:'brightness(0) invert(1)' },
  heroTitle:{ fontSize:38, fontWeight:700, color:'#fff', margin:'0 0 14px', lineHeight:1.15, letterSpacing:'-0.03em' },
  heroSub:  { fontSize:15, color:'#a8a5bb', lineHeight:1.6, margin:0, maxWidth:340 },
  pillRow:  { display:'flex', flexWrap:'wrap', gap:8 },
  pill:     { fontSize:11, fontWeight:500, padding:'5px 11px', borderRadius:99, border:'1px solid rgba(255,255,255,0.15)', color:'#c5c3d6', background:'rgba(255,255,255,0.06)' },
  leftFooter:{ fontSize:11, color:'#5a5770', margin:0 },
  right:    { flex:1, background:'#f9f8fc', display:'flex', alignItems:'center', justifyContent:'center', padding:'48px 32px' },
  card:     { width:'100%', maxWidth:420, background:'#fff', borderRadius:16, padding:'36px 32px', boxShadow:'0 0 0 1px rgba(31,27,46,0.08),0 8px 32px rgba(31,27,46,0.06)' },
  cardTitle:{ fontSize:22, fontWeight:700, color:'#1f1b2e', margin:'0 0 6px', letterSpacing:'-0.02em' },
  cardSub:  { fontSize:13, color:'#7b7990', margin:0 },
  label:    { fontSize:12, fontWeight:600, color:'#3d3a52', letterSpacing:'0.01em' },
  input:    { padding:'10px 12px', borderRadius:8, border:'1px solid #e8e7ef', background:'#faf9fd', color:'#1f1b2e', fontSize:13, outline:'none', transition:'border-color .15s,box-shadow .15s', width:'100%', boxSizing:'border-box' },
  inputFocus:{ borderColor:'#5d5fef', boxShadow:'0 0 0 3px rgba(93,95,239,0.12)', background:'#fff' },
  inputBlur: { borderColor:'#e8e7ef', boxShadow:'none', background:'#faf9fd' },
  showBtn:  { fontSize:11, fontWeight:500, color:'#5d5fef', background:'none', border:'none', cursor:'pointer', padding:0 },
  btn:      { padding:'11px 16px', borderRadius:8, background:'#5d5fef', color:'#fff', fontSize:13, fontWeight:600, border:'none', cursor:'pointer', transition:'background .15s,opacity .15s', letterSpacing:'0.01em' },
  divider:      { display:'flex', alignItems:'center', gap:12, margin:'20px 0 14px' },
  dividerLine:  { flex:1, height:1, background:'#f0eff7' },
  dividerLabel: { fontSize:11, color:'#a8a5bb', fontWeight:500 },
  googleBtn: {
    display:'flex', alignItems:'center', justifyContent:'center', gap:10,
    width:'100%', padding:'10px 16px', borderRadius:8,
    border:'1px solid #e8e7ef', background:'#fff', color:'#3d3a52',
    fontSize:13, fontWeight:500, cursor:'pointer',
    transition:'background .12s, border-color .12s',
    marginBottom:16,
  },
  foot:     { fontSize:12, color:'#7b7990', textAlign:'center', margin:'4px 0 0' },
  link:     { color:'#5d5fef', fontWeight:600, textDecoration:'none' },
}

export function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  )
}

export function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 12px', borderRadius:8,
      background:'#fef2f2', border:'1px solid #fecaca', fontSize:12, color:'#dc2626', fontWeight:500 }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:'#dc2626', flexShrink:0, display:'block' }} />
      {msg}
    </div>
  )
}

export function LoadingRow({ label }: { label: string }) {
  return (
    <span style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'center' }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation:'spin .8s linear infinite' }}>
        <circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5"/>
        <path d="M7 1.5A5.5 5.5 0 0112.5 7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </svg>
      {label}
    </span>
  )
}
