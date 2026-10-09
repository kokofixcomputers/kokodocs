import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken, type User } from './api'
import { startSync } from './offline/sync'
import { forgetEverything } from './offline/store'
import { hideBusy, showBusy, whileBusy } from './zk/busy'
import { finishLogin, loginSecret, restoreSession, unlockWithPassword } from './zk/flows'
import { zkErase, zkOnChange, zkUnlocked } from './zk/session'

interface AuthCtx {
  user: User | null
  loading: boolean
  /** An encrypted account that is signed in but whose keys aren't on this device yet: the password opens them. */
  zkLocked: boolean
  unlock: (password: string) => Promise<void>
  reloadUser: () => Promise<void>
  /** Resolves with an mfa_token when a second factor is needed. */
  login: (email: string, password: string) => Promise<{ mfa_token: string } | null>
  completeMfa: (mfa_token: string, code: string) => Promise<void>
  acceptToken: (token: string) => Promise<void>
  completeSignup: (email: string, code: string) => Promise<void>
  signup: (email: string, name: string, password: string) => Promise<void>
  logout: () => void
}
const Ctx = createContext<AuthCtx>(null!)
export const useAuth = () => useContext(Ctx)

/** The wrapping key made from the password during sign-in, kept only until the second factor is entered. */
let pendingKek: Uint8Array | null = null

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(!!getToken())
  const [unlocked, setUnlocked] = useState(zkUnlocked())
  useEffect(() => zkOnChange(() => setUnlocked(zkUnlocked())), [])

  useEffect(() => {
    if (!getToken()) return
    ;(async () => {
      try {
        const me = await api.me()
        if (me.zk) { showBusy('Decrypting…', 'Opening your encryption keys'); try { await restoreSession(me) } finally { hideBusy() } }
        setUser(me)
      } catch (e) {
        // no connection is not a reason to sign out: with a saved copy the app opens as usual
        if ((e as { status?: number })?.status !== 0) setToken(null)
      } finally { setLoading(false) }
    })()
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    showBusy('Decrypting…', 'Opening your encryption keys')
    try {
      const { secret, kek } = await loginSecret(email, password)
      const r = await api.login({ email, password: secret })
      if ('mfa_required' in r) { pendingKek = kek; return { mfa_token: r.mfa_token } }
      setToken(r.token)
      if (kek) await finishLogin(r.user, kek)
      setUser(r.user)
      return null
    } catch (e) { setToken(null); throw e } finally { hideBusy() }
  }, [])
  const completeMfa = useCallback(async (mfa_token: string, code: string) => {
    const r = await api.login2fa({ mfa_token, code })
    setToken(r.token)
    if (pendingKek) await whileBusy('Decrypting…', () => finishLogin(r.user, pendingKek!), 'Opening your encryption keys')
    pendingKek = null
    setUser(r.user)
  }, [])
  const completeSignup = useCallback(async (email: string, code: string) => {
    const r = await api.signupVerify({ email, code })
    setToken(r.token); setUser(r.user)
  }, [])
  const acceptToken = useCallback(async (token: string) => {
    setToken(token)
    const me = await api.me()
    if (me.zk && !zkUnlocked()) await restoreSession(me)   // single sign-on and the like: no password was typed here, so the keys come from this device or the unlock page
    setUser(me)
  }, [])
  const signup = useCallback(async (email: string, name: string, password: string) => {
    const r = await api.signup({ email, name, password })
    setToken(r.token); setUser(r.user)
  }, [])
  const logout = useCallback(() => { setToken(null); setUser(null); pendingKek = null; void zkErase(); void forgetEverything(); try { localStorage.removeItem('koko.zk') } catch { /* ignore */ } }, [])
  useEffect(() => (user && !user.zk ? startSync() : undefined), [user?.id, user?.zk])   // eslint-disable-line react-hooks/exhaustive-deps
  const unlock = useCallback(async (password: string) => {
    if (!user) return
    await whileBusy('Decrypting…', () => unlockWithPassword(user, password), 'Opening your encryption keys')
  }, [user])
  const reloadUser = useCallback(async () => { setUser(await api.me()) }, [])
  const zkLocked = !!user?.zk && !unlocked

  const value = useMemo(() => ({ user, loading, zkLocked, unlock, reloadUser, login, completeMfa, acceptToken, completeSignup, signup, logout }), [user, loading, zkLocked, unlock, reloadUser, login, completeMfa, acceptToken, completeSignup, signup, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
