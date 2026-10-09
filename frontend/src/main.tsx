import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import { AdminPage } from './pages/AdminPage'
import { AuthCallback, AuthPage, ForgotPage } from './pages/AuthPage'
import { SettingsHost } from './pages/Settings'
import { Dashboard } from './pages/Dashboard'
import { Home } from './pages/Home'
import { Features } from './pages/Features'
import { Why } from './pages/Why'
import { SelfHost } from './pages/SelfHost'
import { VoiceDemoFrame } from './marketing/VoiceDemo'
import { EditorPage } from './pages/EditorPage'
import { MeetPage } from './meet/MeetPage'
import { FolderPage } from './pages/FolderPage'
import { DialogHost } from './ui/Dialogs'
import { Toaster } from './ui/Toast'
import { Tooltips } from './ui/Tooltips'
import { SearchPalette } from './ui/Search'
import { ShortcutsSheet } from './ui/Shortcuts'
import { SyncNotices } from './ui/SyncNotices'
import { KeyboardFit } from './ui/KeyboardFit'
import { UpdateNotice } from './ui/UpdateNotice'
import { DecryptingPage } from './zk/Decrypting'
import { UnlockPage } from './zk/UnlockPage'
import { installEmojiRecovery } from './emoji'
import { installZkImages } from './zk/images'
import './app.css'
import './editor.css'

installEmojiRecovery()
installZkImages()   // pictures in encrypted documents are decrypted here, as they appear

/** Signed-in people land on their documents; everyone else sees the home page. */
function Root() {
  const { user, loading } = useAuth()
  if (loading) return <div className="splash"><span className="spinner" /></div>
  return user ? <Dashboard /> : <Home />
}

/** Over everything: while an encrypted account's keys aren't on this device, nothing else can be used. */
function ZkLock() {
  const { zkLocked, loading } = useAuth()
  return !loading && zkLocked ? <UnlockPage /> : null
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="splash"><span className="spinner" /></div>
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />
  return <>{children}</>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/forgot" element={<ForgotPage />} />
          <Route path="/signup" element={<AuthPage mode="signup" />} />
          <Route path="/" element={<Root />} />
          <Route path="/features" element={<Features />} />
          <Route path="/why" element={<Why />} />
          <Route path="/self-host" element={<SelfHost />} />
          {import.meta.env.DEV && <Route path="/__demo/voice" element={<VoiceDemoFrame />} />}
          <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
          <Route path="/d/:id" element={<EditorPage />} />
          <Route path="/f/:id" element={<FolderPage />} />
          <Route path="/m/:code" element={<MeetPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <Toaster />
        <Tooltips />
        <SearchPalette />
        <ShortcutsSheet />
        <SyncNotices />
        <KeyboardFit />
        <SettingsHost />
        <DialogHost />
        <ZkLock />
        <DecryptingPage />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)

// its own root: if a lazy-loaded file is gone the app below can crash outright, and the reload offer must outlive that
const notice = document.createElement('div'); document.body.appendChild(notice)
ReactDOM.createRoot(notice).render(<UpdateNotice />)
