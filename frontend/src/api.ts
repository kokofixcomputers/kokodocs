import { toast } from './ui/Toast'
import { isOnline, setOnline } from './offline/net'
import { addLocalDoc, cached, keepLists, keepPlain, offlineOn, outbox, renameLocal, searchLocal, setAccountZk } from './offline/store'
import { importZkImage, uploadZkImage } from './zk/images'
import { openConversation, openConversationTitle, sealConversation } from './zk/conversations'
import { decorate, decorateAll, decryptComment, docKeyOf, encryptComment, encryptTitle, newDocKey, sealDocKeyForMe, setDocKey, zkNewEncrypted, zkUnlocked, type ZkFields } from './zk/session'
import type { Answers, FormItem, PublicForm } from './forms/model'
export interface User { id: string; email: string; name: string; color: string; is_admin?: boolean; has_password?: boolean; notify_email?: boolean; totp?: boolean; google?: string | null; zk?: boolean; zk_pub?: string | null }
export interface AdminUser { id: string; email: string; name: string; color: string; created_at: number; is_admin: boolean; builtin_admin: boolean; disabled: boolean; used: number; quota_mb: number | null; limit_mb: number; totp: boolean; docs: number; sheets: number }
export interface AdminFile { id: string; title: string; kind: DocKind; created_at: number; updated_at: number; deleted_at: number | null; link_access: LinkAccess; link_role: string; owner_id: string; owner_name: string; owner_email: string }
export type SttProvider = 'groq' | 'mistral' | 'openai' | 'cloudflare' | 'openai-compatible' | 'local'
export interface SttLoaded { idle: number; unload_in: number | null; roles: string[] }
export interface SttModel { repo: string; name: string; builtin: boolean; size: number; loaded?: SttLoaded | null; state: 'ready' | 'downloading' | 'incomplete' | 'error'; total?: number; error?: string | null }
export interface SttModels { dir: string; max_mb: number; installed: boolean; models: SttModel[]; freed?: number; memory_mb?: number | null; idle_unload?: boolean; unloaded?: string[] }
export interface SttAdmin { provider: 'auto' | SttProvider; models: Record<SttProvider, string>; url: string; cf_account: string; cf_models: string[]; language: string; draft_choice: string; draft_options: { value: string; label: string; size: number; builtin: boolean }[]; loaded: string[]; idle_unload: boolean; idle_minutes: number; draft: boolean; draft_model: string | null; key_set: Record<SttProvider, boolean>; env_key: { groq: boolean; mistral: boolean; openai: boolean; cloudflare: boolean }; groq_models: string[]; local_models: string[]; local_installed: boolean; active: { available: boolean; provider: string | null; model: string | null } }
export interface SsoPublic { id: string; name: string; preset: string }
export interface SsoProvider { id: string; preset: string; name: string; enabled: boolean; ready: boolean; secret_set: boolean; linked: number; redirect_uri: string; client_id: string; authorize_url: string; token_url: string; userinfo_url: string; emails_url: string; scopes: string; subject_field: string; email_field: string; name_field: string; verified_field: string; trust_email: boolean; auth_method: 'post' | 'basic' }
export interface SsoAdmin { providers: SsoProvider[]; public_url: string; presets: { id: string; name: string; hint: string }[] }
export interface AdminSettings { stt: SttAdmin; ai: AiAdmin; signup_enabled: boolean; public_url: string; default_quota_mb: number; smtp_host: string; smtp_port: number; smtp_security: 'starttls' | 'ssl' | 'none'; smtp_user: string; smtp_password_set: boolean; smtp_from: string; email_active: boolean }
export type LoginResult = { token: string; user: User } | { mfa_required: true; mfa_token: string }
export interface Storage { used: number; limit: number; documents: number; versions: number; images: number; files?: number; recordings?: number }
export interface StorageItem { id: string; title: string; kind: DocKind; trashed: boolean; text: number; versions: number; images: number; files: number; total: number }
export interface StorageItems { items: StorageItem[]; unattached_images: number; recordings?: number; recording_count?: number }
export interface AdminStats { users: number; documents: number; spreadsheets: number; trashed: number; comments: number; versions: number; upload_bytes: number }
/** May the assistant read this person's other files: not at all, only after asking each time, or freely. */
export type AiFilesMode = 'off' | 'ask' | 'allow'
export interface AiFileEntry { id: string; title: string; kind: DocKind; owner: string; updated_at: number; snippet?: string }
export type DocKind = 'doc' | 'sheet' | 'slides' | 'form' | 'wiki' | 'board'
export type Role = 'owner' | 'manager' | 'editor' | 'viewer'
export type LinkAccess = 'restricted' | 'anyone' | 'password'

export interface DocSummary extends ZkFields {
  id: string; title: string; role: Role; owner: string | null
  updated_at: number; created_at: number; link_access: LinkAccess; folder_id: string | null; kind: DocKind
  deleted_at?: number; starred?: boolean; opened_at?: number; tags?: string[]
}
export interface Folder { id: string; name: string; tags?: string[]; color?: string | null; parent_id: string | null; created_at: number; shared?: number; link_access?: 'restricted' | 'anyone'; link_role?: 'viewer' | 'editor' }
export interface SharedFolder { id: string; name: string; role: 'viewer' | 'editor'; owner: string; created_at: number }
export interface SharedFolderView {
  id: string; name: string; role: 'viewer' | 'editor' | 'owner'; owner: string
  trail: { id: string; name: string }[]
  folders: { id: string; name: string; created_at: number }[]
  docs: DocSummary[]
}
export interface FolderSharing {
  link_access: 'restricted' | 'anyone'; link_role: 'viewer' | 'editor'
  shares: { email: string; role: 'viewer' | 'editor'; name: string | null }[] }
export interface Version {
  id: string; created_at: number; kind: 'auto' | 'manual'; label: string | null
  authors: string[]; words: number; preview: string
}
export interface DocInfo extends DocSummary { owner_email: string; link: { access: LinkAccess; role: 'viewer' | 'editor' } }
export interface Sharing {
  link_access: LinkAccess; link_role: 'viewer' | 'editor'; has_password: boolean
  shares: { email: string; role: 'viewer' | 'editor' | 'manager'; name: string | null }[]
}
export interface ProofIssue {
  block: number; offset: number; length: number
  kind: 'spelling' | 'grammar' | 'style'; message: string; suggestions: string[]
}

export interface AiModelEntry { id: string; label: string; scope: 'system' | 'user'; model: string; host: string; base_url?: string; key_hint?: string | null }
export interface AiSettings { configured: boolean; models: AiModelEntry[]; selected: string | null }
export interface AiAdminModel { id: string; label: string; base_url: string; model: string; key_set: boolean; enabled: boolean; default: boolean }
export interface AiAdmin { models: AiAdminModel[]; env: { configured: boolean; url: string; model: string }; using_env: boolean; people_own: number }
export interface SearchHit { id: string; title: string; kind: DocKind; owner: string; updated_at: number; title_match: boolean; snippet: string }
export interface Notice { id: string; kind: 'mention' | 'comment' | 'share'; doc_id: string; doc_title: string; actor: string; text: string; link: string; created_at: number; read: boolean }
export interface MentionSkip { email: string; reason: 'not_shared' }
export interface Comment { anchor: Record<string, unknown> | null; id: string; parent_id: string | null; body: string; quote: string; resolved: boolean; created_at: number; user_id: string; author: string; mentions: string[] }
export interface FormFileRef { id: string; name: string; size: number }
export interface FormResponse { id: string; created_at: number; name: string | null; email: string | null; answers: Record<string, string | string[] | FormFileRef> }
export interface MeetSettings {
  approval: boolean; host_first: boolean; guests: boolean; mute_on_entry: boolean; cam_off_on_entry: boolean
  chat: 'all' | 'host' | 'off'; share: 'all' | 'host'; reactions: boolean; unmute: boolean; captions: boolean; max: number
  camera: boolean; collab: 'all' | 'host'; present: 'all' | 'host'; edit_shared: boolean; seek: boolean
  recording: 'off' | 'host' | 'managers'; record_consent: boolean
}
export interface MeetInfo {
  code: string; title: string; host_name: string; is_host: boolean; ended: boolean; permanent: boolean; guests: boolean; has_passcode: boolean; approval: boolean
  provider: string; created_at: number; live: number; is_cohost?: boolean; signed_in?: boolean; can_join?: boolean
  settings?: MeetSettings; passcode?: string   // only the host sees these (a co-host sees the passcode)
  cohosts?: { id: string; name: string; email: string }[]; role?: 'host' | 'cohost'
  recording?: { required: boolean } | null   // the meeting is being recorded right now
}
export interface RecordingItem { id: string; title: string; code: string; by: string; status: 'recording' | 'done'; mime: string; size: number; duration_ms: number; created_at: number }
export interface MeetTicket { jt: string; cid: string; name: string; host: boolean; title: string; provider: 'mesh' | 'realtimekit' | 'sfu' | 'metered' | 'livekit'; permanent: boolean }
export interface MeetShareToken { doc_id: string; token: string; role: 'viewer' | 'editor'; kind: 'collab' | 'present'; doc_kind: 'doc' | 'sheet' | 'slides' }
export interface MeetMedia { provider: 'mesh' | 'realtimekit' | 'sfu' | 'metered' | 'livekit'; ice_servers?: RTCIceServer[]; max?: number; auth_token?: string; url?: string; token?: string }
export interface MeetCreate { title?: string; permanent?: boolean; passcode?: string; settings?: Partial<MeetSettings>; cohosts?: string[] }
export interface MeetEdit { title?: string; permanent?: boolean; passcode?: string; settings?: Partial<MeetSettings>; cohosts?: string[] }
export interface MeetAdmin {
  enabled: boolean; guests: boolean; provider: string; providers: { id: string; label: string }[]; problem: string | null; warning?: string | null
  turn: { mode: 'none' | 'cloudflare' | 'custom'; key_id: string; token_set: boolean; urls: string; user: string; pass_set: boolean }
  rtk: { account: string; app: string; token_set: boolean; host_preset: string; guest_preset: string }
  sfu: { app: string; secret_set: boolean }
  livekit: { url: string; key: string; secret_set: boolean }
  metered: { app: string; secret_set: boolean }
}
export interface MeetAdminIn {
  enabled?: boolean; guests?: boolean; provider?: string
  turn?: Partial<{ mode: string; key_id: string; token: string; urls: string; user: string; password: string }>
  rtk?: Partial<{ account: string; app: string; token: string; host_preset: string; guest_preset: string }>
  sfu?: Partial<{ app: string; secret: string }>
  livekit?: Partial<{ url: string; key: string; secret: string }>
  metered?: Partial<{ app: string; secret: string }>
}
export interface OcrConfig { available: boolean; model: { id: string; label: string; model: string } | null; locked: boolean; default: '' | 'local' | 'ai' }
export interface OcrAdmin { model_id: string; prompt: string; default_prompt: string; lock: boolean; default: '' | 'local' | 'ai'; models: { id: string; label: string; model: string; host: string }[] }
export interface AiConversationInfo { id: string; title: string; created_at: number; updated_at: number }

export class ApiError extends Error {
  constructor(public status: number, public code: string | null, message: string, public detail?: any) { super(message) }
}

const TOKEN_KEY = 'koko.token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))
const docTokenKey = (id: string) => `koko.doctoken.${id}`
export const getDocToken = (id: string) => sessionStorage.getItem(docTokenKey(id))
export const setDocToken = (id: string, t: string) => sessionStorage.setItem(docTokenKey(id), t)

export async function request<T>(path: string, init: RequestInit = {}, docId?: string): Promise<T> {
  const headers = new Headers(init.headers)
  const t = getToken()
  if (t) headers.set('Authorization', `Bearer ${t}`)
  const dt = docId && getDocToken(docId)
  if (dt) headers.set('X-Doc-Token', dt)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  let res: Response
  try { res = await fetch(path, { ...init, headers }) } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    setOnline(false)   // couldn't reach the server (as opposed to the server saying no): the offline copy takes over
    throw new ApiError(0, 'offline', 'You’re offline.')
  }
  if (!isOnline()) setOnline(true)
  if (!res.ok) {
    let detail: any = null
    try { detail = (await res.json()).detail } catch { /* ignore */ }
    const msg = typeof detail === 'string' ? detail : detail?.message ?? res.statusText
    throw new ApiError(res.status, typeof detail === 'object' ? detail?.code ?? null : null, msg, detail)
  }
  return res.json()
}

/** Like fetch, with the sign-in (and document password) headers; for the few places that need the raw response. */
export async function rawFetch(path: string, init: RequestInit = {}, docId?: string): Promise<Response> {
  const headers = new Headers(init.headers)
  const t = getToken(); if (t) headers.set('Authorization', `Bearer ${t}`)
  const dt = docId && getDocToken(docId); if (dt) headers.set('X-Doc-Token', dt)
  return fetch(path, { ...init, headers })
}

async function requestBlob(path: string, docId: string): Promise<Uint8Array> {
  const headers = new Headers()
  const t = getToken(); if (t) headers.set('Authorization', `Bearer ${t}`)
  const dt = getDocToken(docId); if (dt) headers.set('X-Doc-Token', dt)
  const res = await fetch(path, { headers })
  if (!res.ok) throw new ApiError(res.status, null, res.statusText)
  return new Uint8Array(await res.arrayBuffer())
}

const json = (body: unknown) => ({ body: JSON.stringify(body) })

export const api = {
  signup: (b: { email: string; name: string; password: string }) =>
    request<{ token: string; user: User }>('/api/auth/signup', { method: 'POST', ...json(b) }),
  signupStart: (b: { email: string; name: string; password: string }) => request<{ sent: boolean; cooldown: number }>('/api/auth/signup/start', { method: 'POST', ...json(b) }),
  signupResend: (email: string) => request<{ cooldown: number }>('/api/auth/signup/resend', { method: 'POST', ...json({ email }) }),
  signupVerify: (b: { email: string; code: string }) => request<{ token: string; user: User }>('/api/auth/signup/verify', { method: 'POST', ...json(b) }),
  passwordForgot: (email: string) => request<{ cooldown: number }>('/api/auth/password/forgot', { method: 'POST', ...json({ email }) }),
  passwordReset: (b: { email: string; code: string; password: string }) => request<{ ok: true; zk?: boolean; token?: string; keys?: import('./zk/flows').ServerKeys }>('/api/auth/password/reset', { method: 'POST', ...json(b) }),
  adminEmailTest: () => request<{ sent_to: string }>('/api/admin/email/test', { method: 'POST' }),
  adminEmailRemove: () => request('/api/admin/email', { method: 'DELETE' }),
  authConfig: () => request<{ signup_enabled: boolean; providers: SsoPublic[]; email: boolean }>('/api/auth/config'),
  login2fa: (b: { mfa_token: string; code: string }) => request<{ token: string; user: User }>('/api/auth/login/2fa', { method: 'POST', ...json(b) }),
  changePassword: (b: { current?: string; new: string; code?: string }) => request('/api/auth/password', { method: 'POST', ...json(b) }),
  ssoLink: (id: string) => request<{ url: string }>(`/api/auth/sso/${id}/link`, { method: 'POST' }),
  ssoUnlink: (id: string) => request(`/api/auth/sso/${id}/unlink`, { method: 'POST' }),
  ssoIdentities: () => request<{ provider: string; name: string; label: string }[]>('/api/auth/sso/identities'),
  adminSso: () => request<SsoAdmin>('/api/admin/sso'),
  adminSsoAdd: (preset: string) => request<SsoProvider>('/api/admin/sso', { method: 'POST', ...json({ preset }) }),
  adminSsoSave: (id: string, b: Partial<Omit<SsoProvider, 'id' | 'preset' | 'ready' | 'secret_set' | 'linked' | 'redirect_uri'> & { client_secret: string }>) => request<SsoProvider>(`/api/admin/sso/${id}`, { method: 'PUT', ...json(b) }),
  adminSsoDelete: (id: string) => request(`/api/admin/sso/${id}`, { method: 'DELETE' }),
  adminSsoDiscover: (issuer: string) => request<{ authorize_url: string; token_url: string; userinfo_url: string; scopes: string; name: string }>('/api/admin/sso/discover', { method: 'POST', ...json({ issuer }) }),
  twofaStatus: () => request<{ enabled: boolean; recovery_left: number }>('/api/auth/2fa'),
  twofaSetup: () => request<{ secret: string; uri: string }>('/api/auth/2fa/setup', { method: 'POST' }),
  twofaEnable: (code: string) => request<{ recovery_codes: string[] }>('/api/auth/2fa/enable', { method: 'POST', ...json({ code }) }),
  twofaDisable: (code: string) => request('/api/auth/2fa/disable', { method: 'POST', ...json({ code }) }),
  login: (b: { email: string; password: string }) =>
    request<LoginResult>('/api/auth/login', { method: 'POST', ...json(b) }),
  me: async () => { const u = await cached('me', () => request<User>('/api/auth/me'), (u) => (u.zk ? (undefined as unknown as User) : u)); setAccountZk(!!u.zk); return u },
  listDocs: () => cached('docs', async () => { const r = await request<{ mine: DocSummary[]; shared: DocSummary[] }>('/api/docs'); await Promise.all([decorateAll(r.mine), decorateAll(r.shared)]); return r }, keepLists),
  /** With encryption on, new documents are encrypted (forms can't be, and a person can ask for plain ones in Settings). */
  createDoc: async (title?: string, folder_id?: string | null, kind: DocKind = 'doc', opts: { plain?: boolean } = {}): Promise<DocSummary> => {
    if (zkUnlocked() && kind !== 'form' && zkNewEncrypted() && !opts.plain) {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => x.toString(16).padStart(2, '0')).join(''), key = newDocKey()
      const name = title?.trim() || { doc: 'Untitled document', sheet: 'Untitled spreadsheet', slides: 'Untitled presentation', wiki: 'Untitled wiki', board: 'Untitled board' }[kind]
      const r = await request<DocSummary>('/api/zk/docs', { method: 'POST', ...json({ id, kind, folder_id: folder_id ?? null, title_enc: await encryptTitle(key, id, name), sealed: await sealDocKeyForMe(key) }) })
      setDocKey(id, key)
      return decorate(r)
    }
    if (!offlineOn()) return request<DocSummary>('/api/docs', { method: 'POST', ...json({ title: title ?? null, folder_id: folder_id ?? null, kind }) })
    // the id is chosen here, so the document can be made with no connection and created on the server later (creating the same id twice is harmless)
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => x.toString(16).padStart(2, '0')).join('')
    const op = { op: 'create' as const, id, title: title ?? '', folder_id: folder_id ?? null, kind }
    if (isOnline()) {
      try { return await request<DocSummary>('/api/docs', { method: 'POST', ...json({ id, title: title ?? null, folder_id: folder_id ?? null, kind }) }) } catch (e) { if ((e as ApiError).status !== 0) throw e }
    }
    await outbox.push(op)
    return addLocalDoc(op, (await cached<User>('me', () => request<User>('/api/auth/me')).catch(() => null))?.name ?? '')
  },
  moveDoc: (id: string, folder_id: string | null) => request(`/api/docs/${id}/move`, { method: 'POST', ...json({ folder_id }) }, id),
  listFolders: () => cached('folders', () => request<Folder[]>('/api/folders')),
  createFolder: (name: string, parent_id: string | null) => request<Folder>('/api/folders', { method: 'POST', ...json({ name, parent_id }) }),
  colorFolder: (id: string, color: string | null) => request<Folder>(`/api/folders/${id}`, { method: 'PATCH', ...json({ color }) }),
  renameFolder: (id: string, name: string) => request<Folder>(`/api/folders/${id}`, { method: 'PATCH', ...json({ name }) }),
  moveFolder: (id: string, parent_id: string | null) => request<Folder>(`/api/folders/${id}`, { method: 'PATCH', ...json({ move: true, parent_id }) }),
  deleteFolder: (id: string) => request<{ trashed: number }>(`/api/folders/${id}`, { method: 'DELETE' }),
  getFolderSharing: (id: string) => request<FolderSharing>(`/api/folders/${id}/sharing`),
  putFolderSharing: (id: string, b: { shares: { email: string; role: string }[]; link_access: string; link_role: string }) =>
    request<FolderSharing>(`/api/folders/${id}/sharing`, { method: 'PUT', ...json(b) }),
  listSharedFolders: () => cached('sfolders', () => request<SharedFolder[]>('/api/shared/folders')),
  openSharedFolder: (id: string) => cached(`sfolder:${id}`, async () => { const r = await request<SharedFolderView>(`/api/shared/folders/${id}`); await decorateAll(r.docs); return r }, (r) => ({ ...r, docs: keepPlain(r.docs) })),
  listTrash: async () => { const r = await request<{ purge_days: number; docs: DocSummary[] }>('/api/trash'); await decorateAll(r.docs); return r },
  restoreDoc: (id: string) => request(`/api/docs/${id}/restore`, { method: 'POST' }),
  deleteForever: (id: string) => request(`/api/docs/${id}/permanent`, { method: 'DELETE' }),
  emptyTrash: () => request('/api/trash/empty', { method: 'POST' }),
  listVersions: (id: string) => docKeyOf(id) ? Promise.resolve([] as Version[]) : request<Version[]>(`/api/docs/${id}/versions`, {}, id),
  createVersion: (id: string, label?: string) => docKeyOf(id) ? Promise.reject(new Error('Version history isn\'t available in encrypted documents, because the server can\'t read them.')) : request<{ id: string }>(`/api/docs/${id}/versions`, { method: 'POST', ...json({ label: label ?? null }) }, id),
  renameVersion: (id: string, vid: string, label: string) => request(`/api/docs/${id}/versions/${vid}`, { method: 'PATCH', ...json({ label }) }, id),
  versionData: (id: string, vid: string) => requestBlob(`/api/docs/${id}/versions/${vid}/data`, id),
  getDoc: (id: string) => cached(`doc:${id}`, async () => decorate(await request<DocInfo>(`/api/docs/${id}`, {}, id)), (d) => (d.zk || getDocToken(id) ? (undefined as unknown as DocInfo) : d)),
  /** Encrypted documents keep their title encrypted too. */
  renameDoc: async (id: string, title: string) => {
    const key = docKeyOf(id)
    if (key) return request(`/api/docs/${id}`, { method: 'PATCH', ...json({ zk_title: await encryptTitle(key, id, title || 'Untitled') }) }, id)
    const send = () => request(`/api/docs/${id}`, { method: 'PATCH', ...json({ title }) }, id)
    if (!offlineOn()) return send()
    try { if (isOnline()) { const r = await send(); void renameLocal(id, title); return r } } catch (e) { if ((e as ApiError).status !== 0) throw e }
    await outbox.push({ op: 'rename', id, title }); await renameLocal(id, title)
    return { ok: true }
  },
  deleteDoc: (id: string) => request(`/api/docs/${id}`, { method: 'DELETE' }, id),
  getSharing: (id: string) => request<Sharing>(`/api/docs/${id}/sharing`, {}, id),
  putSharing: (id: string, b: { link_access: LinkAccess; link_role: string; password?: string; shares: { email: string; role: string }[] }) =>
    request<Sharing>(`/api/docs/${id}/sharing`, { method: 'PUT', ...json(b) }, id),
  unlock: (id: string, password: string) =>
    request<{ token: string }>(`/api/docs/${id}/unlock`, { method: 'POST', ...json({ password }) }, id),
  importImage: async (id: string, url: string) => {
    const key = docKeyOf(id)
    return key ? importZkImage(id, key, url) : (await request<{ url: string }>(`/api/docs/${id}/images/import`, { method: 'POST', ...json({ url }) }, id)).url
  },
  uploadImage: async (id: string, file: File) => {
    const key = docKeyOf(id)
    if (key) return uploadZkImage(id, key, file)   // encrypted here first: the server only ever holds ciphertext
    const fd = new FormData()
    fd.append('file', file)
    return (await request<{ url: string }>(`/api/docs/${id}/images`, { method: 'POST', body: fd }, id)).url
  },
  aiSettings: () => request<AiSettings>('/api/ai/settings'),
  adminAiModels: () => request<AiAdmin>('/api/admin/ai/models'),
  adminAiAdd: (b: { label: string; base_url: string; model: string; api_key?: string; enabled?: boolean }) => request<AiAdmin>('/api/admin/ai/models', { method: 'POST', ...json(b) }),
  adminAiEdit: (id: string, b: { label?: string; base_url?: string; model?: string; api_key?: string; clear_key?: boolean; enabled?: boolean }) => request<AiAdmin>(`/api/admin/ai/models/${id}`, { method: 'PUT', ...json(b) }),
  adminAiDelete: (id: string) => request<AiAdmin>(`/api/admin/ai/models/${id}`, { method: 'DELETE' }),
  adminAiDefault: (id: string) => request<AiAdmin>(`/api/admin/ai/models/${id}/default`, { method: 'POST' }),
  adminAiTest: (id: string) => request<{ ok: boolean; models: string[]; ms: number; model_ok: boolean }>(`/api/admin/ai/models/${id}/test`, { method: 'POST' }),
  aiFilesMode: () => request<{ mode: AiFilesMode }>('/api/me/ai-files'),
  setAiFilesMode: (mode: AiFilesMode) => request<{ mode: AiFilesMode }>('/api/me/ai-files', { method: 'PUT', ...json({ mode }) }),
  aiFiles: (q: string, exclude: string) => request<AiFileEntry[]>(`/api/ai/files?q=${encodeURIComponent(q)}&exclude=${encodeURIComponent(exclude)}`),
  aiFile: (id: string) => request<AiFileEntry & { text: string; truncated: boolean; empty: boolean }>(`/api/ai/files/${id}`),
  aiFileInfo: (id: string) => request<AiFileEntry>(`/api/ai/files/${id}/info`),
  addAiModel: (b: { label: string; base_url: string; model: string; api_key?: string }) => request<AiSettings>('/api/ai/connections', { method: 'POST', ...json(b) }),
  editAiModel: (id: string, b: { label: string; base_url: string; model: string; api_key?: string }) => request<AiSettings>(`/api/ai/connections/${id}`, { method: 'PUT', ...json(b) }),
  deleteAiModel: (id: string) => request<AiSettings>(`/api/ai/connections/${id}`, { method: 'DELETE' }),
  pickAiModel: (id: string) => request<AiSettings>('/api/ai/selection', { method: 'PUT', ...json({ id }) }),
  aiModels: (id?: string) => request<{ models: string[] }>(`/api/ai/models${id ? `?id=${encodeURIComponent(id)}` : ''}`),
  aiConversations: async (docId: string) => {
    const list = await request<AiConversationInfo[]>(`/api/docs/${docId}/ai/conversations`, {}, docId)
    return docKeyOf(docId) ? Promise.all(list.map(async (c) => ({ ...c, title: await openConversationTitle(docId, c.id, c.title) }))) : list
  },
  aiConversation: async (docId: string, cid: string) => {
    const c = await request<AiConversationInfo & { data: unknown[] }>(`/api/docs/${docId}/ai/conversations/${cid}`, {}, docId)
    if (!docKeyOf(docId)) return c
    return { ...c, title: await openConversationTitle(docId, cid, c.title), data: await openConversation(docId, cid, c.data) }
  },
  /** In an encrypted document the conversation is kept encrypted with a key only this person has, so the server stores nothing it can read. */
  saveAiConversation: async (docId: string, cid: string, title: string, data: unknown[]) =>
    request(`/api/docs/${docId}/ai/conversations/${cid}`, { method: 'PUT', ...json(docKeyOf(docId) ? await sealConversation(docId, cid, title, data) : { title, data }) }, docId),
  deleteAiConversation: (docId: string, cid: string) => request(`/api/docs/${docId}/ai/conversations/${cid}`, { method: 'DELETE' }, docId),
  getForm: (id: string) => request<PublicForm & { role: Role; submitted: boolean }>(`/api/forms/${id}`, {}, id),
  submitForm: (id: string, answers: Answers) => request<{ ok: boolean }>(`/api/forms/${id}/responses`, { method: 'POST', ...json({ answers }) }, id),
  formResponses: (id: string) => request<{ items: FormItem[]; responses: FormResponse[] }>(`/api/forms/${id}/responses`, {}, id),
  uploadFormFile: async (id: string, item: string, file: File) => {
    const fd = new FormData(); fd.append('item', item); fd.append('file', file)
    return request<FormFileRef>(`/api/forms/${id}/files`, { method: 'POST', body: fd }, id)
  },
  downloadFormFile: async (id: string, fid: string, name: string) => {
    const bytes = await requestBlob(`/api/forms/${id}/files/${fid}`, id)
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000)
  },
  deleteFormResponse: (id: string, rid: string) => request(`/api/forms/${id}/responses/${rid}`, { method: 'DELETE' }, id),
  clearFormResponses: (id: string) => request(`/api/forms/${id}/responses`, { method: 'DELETE' }, id),
  setTags: (kind: 'doc' | 'folder', id: string, tags: string[]) => request<{ tags: string[] }>(`/api/tags/${kind}/${id}`, { method: 'PUT', ...json({ tags }) }, kind === 'doc' ? id : undefined),
  renameTag: (old: string, name: string) => request<{ name: string }>('/api/tags/rename', { method: 'POST', ...json({ old, new: name }) }),
  deleteTag: (name: string) => request('/api/tags/delete', { method: 'POST', ...json({ name }) }),
  star: (id: string) => request(`/api/docs/${id}/star`, { method: 'PUT' }, id),
  unstar: (id: string) => request(`/api/docs/${id}/star`, { method: 'DELETE' }, id),
  recent: () => cached('recent', async () => { const r = await request<DocSummary[]>('/api/recent?limit=8'); await decorateAll(r); return r }, keepPlain),
  /** The server searches what it can read. Titles of encrypted documents are only readable here, so those are matched in the browser. */
  search: async (q: string, signal?: AbortSignal) => {
    let hits: SearchHit[]
    try { hits = await request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`, { signal }) } catch (e) {
      if (!offlineOn() || (e as ApiError).status !== 0) throw e
      return (await searchLocal(q)).map((d) => ({ id: d.id, title: d.title, kind: d.kind, owner: d.owner ?? '', updated_at: d.updated_at, title_match: true, snippet: '' }))   // offline: titles on this device
    }
    if (!zkUnlocked()) return hits
    const needle = q.trim().toLowerCase(), seen = new Set(hits.map((h) => h.id))
    const { mine, shared } = await api.listDocs()
    const own = [...mine, ...shared].filter((d) => d.zk && !d.zk_locked && !seen.has(d.id) && d.title.toLowerCase().includes(needle))
    return [...hits, ...own.map((d) => ({ id: d.id, title: d.title, kind: d.kind, owner: d.owner ?? '', updated_at: d.updated_at, title_match: true, snippet: '' }))]
  },
  notifications: () => request<{ unread: number; items: Notice[] }>('/api/notifications'),
  notificationCount: () => request<{ unread: number }>('/api/notifications/count'),
  markRead: (b: { ids?: string[]; all?: boolean }) => request('/api/notifications/read', { method: 'POST', ...json(b) }),
  wikiProxy: (b: { method: string; url: string; headers: Record<string, string>; body?: string }) => request<{ status: number; status_text: string; ms: number; size: number; binary: boolean; body: string; headers: Record<string, string> }>('/api/wiki/proxy', { method: 'POST', ...json(b) }),
  setProfile: (name: string) => request<{ name: string }>('/api/me/profile', { method: 'PUT', ...json({ name }) }),
  setPrefs: (b: { notify_email: boolean }) => request('/api/me/prefs', { method: 'PUT', ...json(b) }),
  comments: async (id: string) => {
    const list = await request<Comment[]>(`/api/docs/${id}/comments`, {}, id), key = docKeyOf(id)
    if (!key) return list
    return Promise.all(list.map(async (c) => { try { return { ...c, body: await decryptComment(key, id, c.body), quote: c.quote ? await decryptComment(key, id, c.quote) : '' } } catch { return { ...c, body: '(couldn’t be decrypted)', quote: '' } } }))
  },
  people: (id: string) => request<{ email: string; name: string | null }[]>(`/api/docs/${id}/people`, {}, id),
  addComment: async (id: string, b: { id?: string; body: string; quote?: string; parent_id?: string; anchor?: Record<string, unknown> }) => {
    const key = docKeyOf(id)
    const sent = key ? { ...b, mentions: [...new Set([...b.body.matchAll(/@([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)].map((m) => m[1].toLowerCase()))], body: await encryptComment(key, id, b.body), quote: b.quote ? await encryptComment(key, id, b.quote) : '' } : b
    const c = await request<Comment & { skipped?: MentionSkip[] }>(`/api/docs/${id}/comments`, { method: 'POST', ...json(sent) }, id)
    if (c.skipped?.length) toast(`${c.skipped.map((s) => s.email).join(', ')} ${c.skipped.length === 1 ? 'was' : 'were'} not notified: this file isn't shared with them. Share it first, then mention them again.`)
    return key ? { ...c, body: b.body, quote: b.quote ?? '' } : c
  },
  resolveComment: (id: string, cid: string, resolved: boolean) => request(`/api/docs/${id}/comments/${cid}/resolved`, { method: 'PUT', ...json({ resolved }) }, id),
  deleteComment: (id: string, cid: string) => request(`/api/docs/${id}/comments/${cid}`, { method: 'DELETE' }, id),
  adminUsers: () => request<AdminUser[]>('/api/admin/users'),
  adminSttModels: () => request<SttModels>('/api/admin/stt/models'),
  adminSttAddModel: (repo: string) => request<SttModels>('/api/admin/stt/models', { method: 'POST', body: JSON.stringify({ repo }) }),
  adminSttUnload: (name?: string) => request<SttModels>('/api/admin/stt/unload', { method: 'POST', ...json({ name: name ?? null }) }),
  adminSttDeleteModel: (repo: string) => request<SttModels>(`/api/admin/stt/models?repo=${encodeURIComponent(repo)}`, { method: 'DELETE' }),
  adminSttTest: () => request<{ ok: boolean; provider: string; model: string; ms: number; note?: string }>('/api/admin/stt/test', { method: 'POST', body: '{}' }),
  adminSettings: () => request<AdminSettings>('/api/admin/settings'),
  adminSaveSettings: (b: Partial<{ ai_url: string; ai_model: string; ai_key: string; ai_clear_key: boolean; ai_enabled: boolean; stt_provider: string; stt_model: Record<string, string>; stt_key: Record<string, string>; stt_clear_key: string; stt_url: string; stt_cf_account: string; stt_language: string; stt_draft: boolean; stt_draft_model: string; stt_idle_unload: boolean; stt_idle_minutes: number; smtp_host: string; smtp_port: number; smtp_security: string; smtp_user: string; smtp_password: string; smtp_from: string; default_quota_mb: number; signup_enabled: boolean; public_url: string }>) => request<AdminSettings>('/api/admin/settings', { method: 'PUT', ...json(b) }),
  adminFiles: (p: { owner?: string; q?: string }) => request<AdminFile[]>(`/api/admin/files?${new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][])}`),
  adminDeleteFile: (id: string) => request(`/api/admin/files/${id}`, { method: 'DELETE' }),
  deleteAccount: (b: { email: string; password?: string; code?: string }) => request('/api/auth/delete', { method: 'POST', ...json(b) }),
  myStorageItems: () => request<StorageItems>('/api/me/storage/items'),
  myStorage: () => request<Storage>('/api/me/storage'),
  adminStats: () => request<AdminStats>('/api/admin/stats'),
  adminPatch: (id: string, b: { quota_mb?: number; clear_quota?: boolean; reset_2fa?: boolean; is_admin?: boolean; disabled?: boolean; name?: string; password?: string }) => request<AdminUser>(`/api/admin/users/${id}`, { method: 'PATCH', ...json(b) }),
  adminDelete: (id: string) => request(`/api/admin/users/${id}`, { method: 'DELETE' }),
  sttStatus: () => request<{ available: boolean; provider: string | null; draft?: boolean }>('/api/stt/status'),
  transcribe: async (id: string, wav: Blob) => {
    const fd = new FormData()
    fd.append('file', wav, 'speech.wav')
    return (await request<{ text: string }>(`/api/docs/${id}/transcribe`, { method: 'POST', body: fd }, id)).text
  },
  /** A rough preview of a recording still in progress (small local model); the final text still comes from `transcribe`. */
  transcribeDraft: async (id: string, wav: Blob, signal?: AbortSignal) => {
    const fd = new FormData()
    fd.append('file', wav, 'speech.wav')
    return (await request<{ text: string }>(`/api/docs/${id}/transcribe/draft`, { method: 'POST', body: fd, signal }, id)).text
  },
  meetConfig: () => request<{ enabled: boolean; guests: boolean; captions: boolean }>('/api/meet/config'),
  meetCreate: (b: MeetCreate) => request<MeetInfo>('/api/meet', { method: 'POST', ...json(b) }),
  meetMine: () => request<MeetInfo[]>('/api/meet'),
  meetInfo: (code: string) => request<MeetInfo>(`/api/meet/${encodeURIComponent(code)}`),
  meetEdit: (code: string, b: MeetEdit) => request<MeetInfo>(`/api/meet/${encodeURIComponent(code)}`, { method: 'PUT', ...json(b) }),
  meetDelete: (code: string) => request<{ ok: true }>(`/api/meet/${encodeURIComponent(code)}`, { method: 'DELETE' }),
  meetJoin: (code: string, name: string, passcode = '') => request<MeetTicket>(`/api/meet/${encodeURIComponent(code)}/join`, { method: 'POST', ...json({ name, passcode }) }),
  meetMedia: (code: string, jt: string) => request<MeetMedia>(`/api/meet/${encodeURIComponent(code)}/media`, { method: 'POST', ...json({ jt }) }),
  recordings: () => request<{ items: RecordingItem[]; total: number }>('/api/recordings'),
  recording: (id: string) => request<RecordingItem & { url: string }>(`/api/recordings/${id}`),
  deleteRecording: (id: string) => request<{ ok: true }>(`/api/recordings/${id}`, { method: 'DELETE' }),
  /** Calls to Cloudflare's SFU session API, relayed by this server (which holds the app secret). */
  meetSfu: <T = unknown>(code: string, jt: string, path: string, method: 'POST' | 'PUT' = 'POST', body: object = {}) =>
    request<T>(`/api/meet/${encodeURIComponent(code)}/sfu/${path}`, { method, ...json({ jt, body }) }),
  meetShareToken: (code: string, jt: string) => request<MeetShareToken>(`/api/meet/${encodeURIComponent(code)}/share/token`, { method: 'POST', ...json({ jt }) }),
  meetEnd: (code: string) => request<{ ok: true; permanent: boolean }>(`/api/meet/${encodeURIComponent(code)}/end`, { method: 'POST' }),
  meetCaption: (code: string, jt: string, wav: Blob) => { const fd = new FormData(); fd.append('jt', jt); fd.append('file', wav, 'speech.wav'); return request<{ text: string }>(`/api/meet/${encodeURIComponent(code)}/caption`, { method: 'POST', body: fd }) },
  adminMeet: () => request<MeetAdmin>('/api/admin/meet'),
  adminMeetSave: (b: MeetAdminIn) => request<MeetAdmin>('/api/admin/meet', { method: 'PUT', ...json(b) }),
  adminMeetTest: () => request<{ ok: boolean; message: string; turn?: boolean }>('/api/admin/meet/test', { method: 'POST' }),
  ttsConfig: () => request<{ engine: 'browser' | 'cloudflare'; langs: string[] }>('/api/tts/config'),
  /** the server's voice reading one sentence (only when the administrator has switched it on) */
  ttsSpeak: async (text: string, lang: string): Promise<Blob> => {
    const res = await rawFetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang }) })
    if (!res.ok) { let d = ''; try { d = (await res.json()).detail } catch { /* ignore */ } throw new ApiError(res.status, null, typeof d === 'string' && d ? d : res.statusText) }
    return res.blob()
  },
  adminTts: () => request<{ engine: 'browser' | 'cloudflare'; account: string; token_set: boolean; problem: string | null; model: string }>('/api/admin/tts'),
  adminTtsSave: (b: Partial<{ engine: string; account: string; token: string }>) => request<{ engine: 'browser' | 'cloudflare'; account: string; token_set: boolean; problem: string | null; model: string }>('/api/admin/tts', { method: 'PUT', ...json(b) }),
  adminTtsTest: () => request<{ ok: boolean; message: string }>('/api/admin/tts/test', { method: 'POST' }),
  ocrConfig: () => request<OcrConfig>('/api/ocr/config'),
  adminOcr: () => request<OcrAdmin>('/api/admin/ocr'),
  adminOcrSave: (b: Partial<{ model_id: string; prompt: string; lock: boolean; default: string }>) => request<OcrAdmin>('/api/admin/ocr', { method: 'PUT', ...json(b) }),
  adminOcrTest: async (file: Blob) => { const fd = new FormData(); fd.append('file', file, 'test.jpg'); return request<{ text: string; model: string; ms: number }>('/api/admin/ocr/test', { method: 'POST', body: fd }) },
  /** Read the text in a photo with the chosen AI model (it has to be one that can see pictures). */
  ocr: async (file: Blob, modelId?: string) => {
    const fd = new FormData(); fd.append('file', file, 'page.jpg'); if (modelId) fd.append('model_id', modelId)
    return (await request<{ text: string }>('/api/ocr', { method: 'POST', body: fd })).text
  },
  proofread: (docId: string, blocks: { id: number; text: string }[], language?: string) =>
    docKeyOf(docId) ? Promise.resolve({ issues: [] as ProofIssue[] }) : request<{ issues: ProofIssue[] }>(`/api/docs/${docId}/proofread`, { method: 'POST', ...json({ blocks, ...(language ? { language } : {}) }) }, docId),   // an encrypted document's text never goes to the server
}

/** Raw streaming call to the assistant proxy (the caller reads the event stream). */
export async function aiChatRequest(body: unknown, signal?: AbortSignal): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const t = getToken(); if (t) headers.set('Authorization', `Bearer ${t}`)
  return fetch('/api/ai/chat', { method: 'POST', headers, body: JSON.stringify(body), signal })
}
