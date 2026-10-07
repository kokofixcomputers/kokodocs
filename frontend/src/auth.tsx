import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken, type User } from './api'

interface AuthCtx {
  user: User | null
  loading: boolean
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(!!getToken())

  useEffect(() => {
    if (!getToken()) return
    api.me().then(setUser).catch(() => setToken(null)).finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login({ email, password })
    if ('mfa_required' in r) return { mfa_token: r.mfa_token }
    setToken(r.token); setUser(r.user)
    return null
  }, [])
  const completeMfa = useCallback(async (mfa_token: string, code: string) => {
    const r = await api.login2fa({ mfa_token, code })
    setToken(r.token); setUser(r.user)
  }, [])
  const completeSignup = useCallback(async (email: string, code: string) => {
    const r = await api.signupVerify({ email, code })
    setToken(r.token); setUser(r.user)
  }, [])
  const acceptToken = useCallback(async (token: string) => { setToken(token); setUser(await api.me()) }, [])
  const signup = useCallback(async (email: string, name: string, password: string) => {
    const r = await api.signup({ email, name, password })
    setToken(r.token); setUser(r.user)
  }, [])
  const logout = useCallback(() => { setToken(null); setUser(null) }, [])

  const value = useMemo(() => ({ user, loading, login, completeMfa, acceptToken, completeSignup, signup, logout }), [user, loading, login, completeMfa, acceptToken, completeSignup, signup, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
