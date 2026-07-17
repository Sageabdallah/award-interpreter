// ---------------------------------------------------------------------------
// Dashboard shell — the AXI-WFM-style product chrome: dark full-height
// grouped sidebar (red active item, section labels, user chip + version at
// the bottom) around a light content pane. Pure chrome: pages are rendered
// by the caller; navigation state lives in App.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, LogOut } from 'lucide-react'
import isoftWordmark from '../assets/isoft-wordmark.png'

const SHELL_CSS = `
  .dsh { display: flex; min-height: 100vh; position: relative; z-index: 1; }
  .dsh-side { width: 256px; flex-shrink: 0; background: #17181D; color: #B9BDC7;
    display: flex; flex-direction: column; position: sticky; top: 0;
    height: 100vh; overflow-y: auto; }
  .dsh-side::-webkit-scrollbar-thumb { border-color: #17181D; background: rgba(255,255,255,0.14); }
  .dsh-brand { display: flex; align-items: center; gap: 11px; padding: 18px 18px 14px;
    border-bottom: 1px solid rgba(255,255,255,0.07); }
  .dsh-mark { height: 34px; border-radius: 9px; background: #FFFFFF;
    display: grid; place-items: center; flex-shrink: 0; padding: 0 11px; }
  .dsh-nav { flex: 1; padding: 10px 12px 16px; }
  .dsh-sect { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.18em;
    text-transform: uppercase; color: #6E7380; padding: 0 10px; margin: 18px 0 6px; }
  .dsh-item { display: flex; align-items: center; gap: 10px; width: 100%;
    border: none; background: transparent; text-align: left; cursor: pointer;
    font-family: var(--body); font-size: 13px; font-weight: 500; color: #B9BDC7;
    padding: 8px 10px; border-radius: 8px; margin-bottom: 1px;
    transition: background 0.14s ease, color 0.14s ease; }
  .dsh-item:hover { background: rgba(255,255,255,0.06); color: #FFFFFF; }
  .dsh-item.active { background: var(--ochre); color: #FFFFFF; font-weight: 600; }
  .dsh-item .dsh-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dsh-badge { font-family: var(--mono); font-size: 10px; padding: 1px 7px; flex-shrink: 0;
    border-radius: 999px; background: rgba(225,27,34,0.25); color: #FF8A8F; }
  .dsh-item.active .dsh-badge { background: rgba(255,255,255,0.22); color: #fff; }
  .dsh-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
    border: 1.5px solid rgba(255,255,255,0.25); }
  .dsh-foot { border-top: 1px solid rgba(255,255,255,0.07); padding: 14px 18px; }
  .dsh-signout { display: flex; align-items: center; gap: 8px; width: 100%;
    border: none; background: transparent; cursor: pointer; color: #B9BDC7;
    font-family: var(--body); font-size: 12.5px; padding: 8px 0 0; }
  .dsh-signout:hover { color: #FFFFFF; }
  .dsh-main { flex: 1; min-width: 0; background: var(--paper); }
  .dsh-content { max-width: 1180px; margin: 0 auto; padding: 30px 34px 72px; }
  @media (max-width: 980px) { .dsh-side { display: none; } }
`

export default function DashboardShell({ nav, activePage, onNavigate, badges = {}, ready = {}, user, version, onSignOut, children }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: SHELL_CSS }} />
      <div className="dsh">
        <aside className="dsh-side">
          {/* Brand lockup from the iSOFT asset pack — the red logomark sits on a
              white tile so it reads on the dark rail, as in the original
              prototype masthead. */}
          <div className="dsh-brand">
            <div className="dsh-mark">
              <img src={isoftWordmark} alt="iSOFT" style={{ height: 15, width: 'auto', display: 'block' }} />
            </div>
            <div>
              <div style={{ color: '#FFFFFF', fontWeight: 700, fontSize: 14.5, lineHeight: 1.1 }}>AXI·WFM</div>
              <div style={{ fontSize: 11, color: '#8A8F9B', marginTop: 2 }}>Award Intelligence · iSOFT ANZ</div>
            </div>
          </div>
          <nav className="dsh-nav" aria-label="Product navigation">
            {nav.map((group) => (
              <div key={group.section || 'top'}>
                {group.section && <div className="dsh-sect">{group.section}</div>}
                {group.items.map((item) => {
                  const active = activePage === item.id
                  const unlocked = ready[item.id] !== false
                  return (
                    <button
                      key={item.id}
                      className={`dsh-item${active ? ' active' : ''}`}
                      onClick={() => onNavigate(item.id)}
                      title={item.hint || item.label}
                    >
                      <item.icon size={15} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                      <span className="dsh-label">{item.label}</span>
                      {unlocked && badges[item.id] > 0 && <span className="dsh-badge">{badges[item.id]}</span>}
                      {!unlocked && <span className="dsh-dot" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
          <ShellFooter user={user} version={version} onSignOut={onSignOut} />
        </aside>
        <main className="dsh-main">
          <div className="dsh-content">{children}</div>
        </main>
      </div>
    </>
  )
}

// Two-step sign out: signing out resets the whole demo workspace, so a stray
// click must never wipe a live demo — the first click arms for 3 seconds.
function ShellFooter({ user, version, onSignOut }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const handleClick = () => {
    if (armed) {
      clearTimeout(timer.current)
      setArmed(false)
      onSignOut()
      return
    }
    setArmed(true)
    timer.current = setTimeout(() => setArmed(false), 3000)
  }
  return (
    <div className="dsh-foot">
      {/* Wordmark on a white plate — the brand red needs the light ground to
          read on the dark rail (same treatment as the masthead tile). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', background: '#FFFFFF', borderRadius: 5, padding: '3px 7px' }}>
          <img src={isoftWordmark} alt="iSOFT" style={{ height: 11, width: 'auto', display: 'block' }} />
        </span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, letterSpacing: '0.12em', color: '#8A8F9B', textTransform: 'uppercase' }}>
          ANZ product
        </span>
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: '#6E7380' }}>{version}</div>
      <div style={{ color: '#FFFFFF', fontWeight: 600, fontSize: 13.5, marginTop: 8 }}>{user.name}</div>
      <div style={{ fontSize: 11.5, color: '#8A8F9B' }}>{user.role}</div>
      <button className="dsh-signout" onClick={handleClick} style={armed ? { color: '#FF8A8F' } : undefined} title="Sign out resets the demo workspace">
        {armed
          ? <><AlertTriangle size={13} strokeWidth={1.9} /> Really sign out &amp; reset?</>
          : <><LogOut size={13} strokeWidth={1.9} /> Sign out</>}
      </button>
    </div>
  )
}

/** Standard page header: h1 + one-line purpose, mirroring AXI-WFM's pages. */
export function PageHeader({ title, subtitle, actions = null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', marginBottom: 24 }}>
      <div>
        <h1 className="display" style={{ fontSize: 'clamp(22px, 2.6vw, 30px)' }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 14, color: 'rgba(26,27,30,0.66)', margin: '8px 0 0', maxWidth: 760, lineHeight: 1.55 }}>{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}
