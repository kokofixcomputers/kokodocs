import { toast } from './ui/Toast'
import type { Answers, FormItem, PublicForm } from './forms/model'
export interface User { id: string; email: string; name: string; color: string; is_admin?: boolean; has_password?: boolean; notify_email?: boolean; totp?: boolean; google?: string | null }
export interface AdminUser { id: string; email: string; name: string; color: string; created_at: number; is_admin: boolean; builtin_admin: boolean; disabled: boolean; used: number; quota_mb: number | null; limit_mb: number; totp: boolean; docs: number; sheets: number }
export interface AdminFile { id: string; title: string; kind: DocKind; created_at: number; updated_at: number; deleted_at: number | null; link_access: LinkAccess; link_role: string; owner_id: string; owner_name: string; owner_email: string }
export type SttProvider = 'groq' | 'mistral' | 'openai' | 'openai-compatible' | 'local'
export interface SttLoaded { idle: number; unload_in: number | null; roles: string[] }
export interface SttModel { repo: string; name: string; builtin: boolean; size: number; loaded?: SttLoaded | null; state: 'ready' | 'downloading' | 'incomplete' | 'error'; total?: number; error?: string | null }
export interface SttModels { dir: string; max_mb: number; installed: boolean; models: SttModel[]; freed?: number; memory_mb?: number | null; idle_unload?: boolean; unloaded?: string[] }
export interface SttAdmin { provider: 'auto' | SttProvider; models: Record<SttProvider, string>; url: string; language: string; loaded: string[]; idle_unload: boolean; idle_minutes: number; draft: boolean; draft_model: string | null; key_set: Record<SttProvider, boolean>; env_key: { groq: boolean; mistral: boolean; openai: boolean }; groq_models: string[]; local_models: string[]; local_installed: boolean; active: { available: boolean; provider: string | null; model: string | null } }
export interface AdminSettings { stt: SttAdmin; signup_enabled: boolean; google_client_id: string; google_secret_set: boolean; public_url: string; default_quota_mb: number; smtp_host: string; smtp_port: number; smtp_security: 'starttls' | 'ssl' | 'none'; smtp_user: string; smtp_password_set: boolean; smtp_from: string; email_active: boolean; redirect_uri: string }
export type LoginResult = { token: string; user: User } | { mfa_required: true; mfa_token: string }
export interface Storage { used: number; limit: number; documents: number; versions: number; images: number; files?: number }
export interface StorageItem { id: string; title: string; kind: DocKind; trashed: boolean; text: number; versions: number; images: number; files: number; total: number }
export interface StorageItems { items: StorageItem[]; unattached_images: number }
export interface AdminStats { users: number; documents: number; spreadsheets: number; trashed: number; comments: number; versions: number; upload_bytes: number }
/** May the assistant read this person's other files: not at all, only after asking each time, or freely. */
export type AiFilesMode = 'off' | 'ask' | 'allow'
export interface AiFileEntry { id: string; title: string; kind: DocKind; owner: string; updated_at: number; snippet?: string }
export type DocKind = 'doc' | 'sheet' | 'slides' | 'form' | 'wiki' | 'board'
export type Role = 'owner' | 'manager' | 'editor' | 'viewer'
export type LinkAccess = 'restricted' | 'anyone' | 'password'

export interface DocSummary {
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

export interface AiSettings { configured: boolean; source: 'user' | 'server' | null; base_url: string; model: string; key_hint: string | null; server_default: boolean }
export interface SearchHit { id: string; title: string; kind: DocKind; owner: string; updated_at: number; title_match: boolean; snippet: string }
export interface Notice { id: string; kind: 'mention' | 'comment' | 'share'; doc_id: string; doc_title: string; actor: string; text: string; link: string; created_at: number; read: boolean }
export interface MentionSkip { email: string; reason: 'not_shared' }
export interface Comment { anchor: Record<string, unknown> | null; id: string; parent_id: string | null; body: string; quote: string; resolved: boolean; created_at: number; user_id: string; author: string; mentions: string[] }
export interface FormFileRef { id: string; name: string; size: number }
export interface FormResponse { id: string; created_at: number; name: string | null; email: string | null; answers: Record<string, string | string[] | FormFileRef> }
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

async function request<T>(path: string, init: RequestInit = {}, docId?: string): Promise<T> {
  const headers = new Headers(init.headers)
  const t = getToken()
  if (t) headers.set('Authorization', `Bearer ${t}`)
  const dt = docId && getDocToken(docId)
  if (dt) headers.set('X-Doc-Token', dt)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    let detail: any = null
    try { detail = (await res.json()).detail } catch { /* ignore */ }
    const msg = typeof detail === 'string' ? detail : detail?.message ?? res.statusText
    throw new ApiError(res.status, typeof detail === 'object' ? detail?.code ?? null : null, msg, detail)
  }
  return res.json()
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
  passwordReset: (b: { email: string; code: string; password: string }) => request('/api/auth/password/reset', { method: 'POST', ...json(b) }),
  adminEmailTest: () => request<{ sent_to: string }>('/api/admin/email/test', { method: 'POST' }),
  adminEmailRemove: () => request('/api/admin/email', { method: 'DELETE' }),
  authConfig: () => request<{ signup_enabled: boolean; google: boolean; email: boolean }>('/api/auth/config'),
  login2fa: (b: { mfa_token: string; code: string }) => request<{ token: string; user: User }>('/api/auth/login/2fa', { method: 'POST', ...json(b) }),
  changePassword: (b: { current?: string; new: string; code?: string }) => request('/api/auth/password', { method: 'POST', ...json(b) }),
  googleLink: () => request<{ url: string }>('/api/auth/google/link', { method: 'POST' }),
  googleUnlink: () => request('/api/auth/google/unlink', { method: 'POST' }),
  twofaStatus: () => request<{ enabled: boolean; recovery_left: number }>('/api/auth/2fa'),
  twofaSetup: () => request<{ secret: string; uri: string }>('/api/auth/2fa/setup', { method: 'POST' }),
  twofaEnable: (code: string) => request<{ recovery_codes: string[] }>('/api/auth/2fa/enable', { method: 'POST', ...json({ code }) }),
  twofaDisable: (code: string) => request('/api/auth/2fa/disable', { method: 'POST', ...json({ code }) }),
  login: (b: { email: string; password: string }) =>
    request<LoginResult>('/api/auth/login', { method: 'POST', ...json(b) }),
  me: () => request<User>('/api/auth/me'),
  listDocs: () => request<{ mine: DocSummary[]; shared: DocSummary[] }>('/api/docs'),
  createDoc: (title?: string, folder_id?: string | null, kind: DocKind = 'doc') =>
    request<DocSummary>('/api/docs', { method: 'POST', ...json({ title: title ?? null, folder_id: folder_id ?? null, kind }) }),
  moveDoc: (id: string, folder_id: string | null) => request(`/api/docs/${id}/move`, { method: 'POST', ...json({ folder_id }) }, id),
  listFolders: () => request<Folder[]>('/api/folders'),
  createFolder: (name: string, parent_id: string | null) => request<Folder>('/api/folders', { method: 'POST', ...json({ name, parent_id }) }),
  colorFolder: (id: string, color: string | null) => request<Folder>(`/api/folders/${id}`, { method: 'PATCH', ...json({ color }) }),
  renameFolder: (id: string, name: string) => request<Folder>(`/api/folders/${id}`, { method: 'PATCH', ...json({ name }) }),
  moveFolder: (id: string, parent_id: string | null) => request<Folder>(`/api/folders/${id}`, { method: 'PATCH', ...json({ move: true, parent_id }) }),
  deleteFolder: (id: string) => request<{ trashed: number }>(`/api/folders/${id}`, { method: 'DELETE' }),
  getFolderSharing: (id: string) => request<FolderSharing>(`/api/folders/${id}/sharing`),
  putFolderSharing: (id: string, b: { shares: { email: string; role: string }[]; link_access: string; link_role: string }) =>
    request<FolderSharing>(`/api/folders/${id}/sharing`, { method: 'PUT', ...json(b) }),
  listSharedFolders: () => request<SharedFolder[]>('/api/shared/folders'),
  openSharedFolder: (id: string) => request<SharedFolderView>(`/api/shared/folders/${id}`),
  listTrash: () => request<{ purge_days: number; docs: DocSummary[] }>('/api/trash'),
  restoreDoc: (id: string) => request(`/api/docs/${id}/restore`, { method: 'POST' }),
  deleteForever: (id: string) => request(`/api/docs/${id}/permanent`, { method: 'DELETE' }),
  emptyTrash: () => request('/api/trash/empty', { method: 'POST' }),
  listVersions: (id: string) => request<Version[]>(`/api/docs/${id}/versions`, {}, id),
  createVersion: (id: string, label?: string) => request<{ id: string }>(`/api/docs/${id}/versions`, { method: 'POST', ...json({ label: label ?? null }) }, id),
  renameVersion: (id: string, vid: string, label: string) => request(`/api/docs/${id}/versions/${vid}`, { method: 'PATCH', ...json({ label }) }, id),
  versionData: (id: string, vid: string) => requestBlob(`/api/docs/${id}/versions/${vid}/data`, id),
  getDoc: (id: string) => request<DocInfo>(`/api/docs/${id}`, {}, id),
  renameDoc: (id: string, title: string) => request(`/api/docs/${id}`, { method: 'PATCH', ...json({ title }) }, id),
  deleteDoc: (id: string) => request(`/api/docs/${id}`, { method: 'DELETE' }, id),
  getSharing: (id: string) => request<Sharing>(`/api/docs/${id}/sharing`, {}, id),
  putSharing: (id: string, b: { link_access: LinkAccess; link_role: string; password?: string; shares: { email: string; role: string }[] }) =>
    request<Sharing>(`/api/docs/${id}/sharing`, { method: 'PUT', ...json(b) }, id),
  unlock: (id: string, password: string) =>
    request<{ token: string }>(`/api/docs/${id}/unlock`, { method: 'POST', ...json({ password }) }, id),
  importImage: (id: string, url: string) => request<{ url: string }>(`/api/docs/${id}/images/import`, { method: 'POST', ...json({ url }) }, id).then((r) => r.url),
  uploadImage: async (id: string, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return (await request<{ url: string }>(`/api/docs/${id}/images`, { method: 'POST', body: fd }, id)).url
  },
  aiSettings: () => request<AiSettings>('/api/ai/settings'),
  aiFilesMode: () => request<{ mode: AiFilesMode }>('/api/me/ai-files'),
  setAiFilesMode: (mode: AiFilesMode) => request<{ mode: AiFilesMode }>('/api/me/ai-files', { method: 'PUT', ...json({ mode }) }),
  aiFiles: (q: string, exclude: string) => request<AiFileEntry[]>(`/api/ai/files?q=${encodeURIComponent(q)}&exclude=${encodeURIComponent(exclude)}`),
  aiFile: (id: string) => request<AiFileEntry & { text: string; truncated: boolean; empty: boolean }>(`/api/ai/files/${id}`),
  aiFileInfo: (id: string) => request<AiFileEntry>(`/api/ai/files/${id}/info`),
  saveAiSettings: (b: { base_url: string; model: string; api_key?: string }) => request<AiSettings>('/api/ai/settings', { method: 'PUT', ...json(b) }),
  deleteAiSettings: () => request<AiSettings>('/api/ai/settings', { method: 'DELETE' }),
  aiModels: () => request<{ models: string[] }>('/api/ai/models'),
  aiConversations: (docId: string) => request<AiConversationInfo[]>(`/api/docs/${docId}/ai/conversations`, {}, docId),
  aiConversation: (docId: string, cid: string) => request<AiConversationInfo & { data: unknown[] }>(`/api/docs/${docId}/ai/conversations/${cid}`, {}, docId),
  saveAiConversation: (docId: string, cid: string, title: string, data: unknown[]) =>
    request(`/api/docs/${docId}/ai/conversations/${cid}`, { method: 'PUT', ...json({ title, data }) }, docId),
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
  recent: () => request<DocSummary[]>('/api/recent?limit=8'),
  search: (q: string, signal?: AbortSignal) => request<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}`, { signal }),
  notifications: () => request<{ unread: number; items: Notice[] }>('/api/notifications'),
  notificationCount: () => request<{ unread: number }>('/api/notifications/count'),
  markRead: (b: { ids?: string[]; all?: boolean }) => request('/api/notifications/read', { method: 'POST', ...json(b) }),
  wikiProxy: (b: { method: string; url: string; headers: Record<string, string>; body?: string }) => request<{ status: number; status_text: string; ms: number; size: number; binary: boolean; body: string; headers: Record<string, string> }>('/api/wiki/proxy', { method: 'POST', ...json(b) }),
  setProfile: (name: string) => request<{ name: string }>('/api/me/profile', { method: 'PUT', ...json({ name }) }),
  setPrefs: (b: { notify_email: boolean }) => request('/api/me/prefs', { method: 'PUT', ...json(b) }),
  comments: (id: string) => request<Comment[]>(`/api/docs/${id}/comments`, {}, id),
  people: (id: string) => request<{ email: string; name: string | null }[]>(`/api/docs/${id}/people`, {}, id),
  addComment: (id: string, b: { id?: string; body: string; quote?: string; parent_id?: string; anchor?: Record<string, unknown> }) => request<Comment & { skipped?: MentionSkip[] }>(`/api/docs/${id}/comments`, { method: 'POST', ...json(b) }, id).then((c) => { if (c.skipped?.length) toast(`${c.skipped.map((s) => s.email).join(', ')} ${c.skipped.length === 1 ? 'was' : 'were'} not notified: this file isn't shared with ${c.skipped.length === 1 ? 'them' : 'them'}. Share it first, then mention them again.`); return c }),
  resolveComment: (id: string, cid: string, resolved: boolean) => request(`/api/docs/${id}/comments/${cid}/resolved`, { method: 'PUT', ...json({ resolved }) }, id),
  deleteComment: (id: string, cid: string) => request(`/api/docs/${id}/comments/${cid}`, { method: 'DELETE' }, id),
  adminUsers: () => request<AdminUser[]>('/api/admin/users'),
  adminSttModels: () => request<SttModels>('/api/admin/stt/models'),
  adminSttAddModel: (repo: string) => request<SttModels>('/api/admin/stt/models', { method: 'POST', body: JSON.stringify({ repo }) }),
  adminSttUnload: (name?: string) => request<SttModels>('/api/admin/stt/unload', { method: 'POST', ...json({ name: name ?? null }) }),
  adminSttDeleteModel: (repo: string) => request<SttModels>(`/api/admin/stt/models?repo=${encodeURIComponent(repo)}`, { method: 'DELETE' }),
  adminSttTest: () => request<{ ok: boolean; provider: string; model: string; ms: number; note?: string }>('/api/admin/stt/test', { method: 'POST', body: '{}' }),
  adminSettings: () => request<AdminSettings>('/api/admin/settings'),
  adminSaveSettings: (b: Partial<{ stt_provider: string; stt_model: Record<string, string>; stt_key: Record<string, string>; stt_clear_key: string; stt_url: string; stt_language: string; stt_draft: boolean; stt_idle_unload: boolean; stt_idle_minutes: number; smtp_host: string; smtp_port: number; smtp_security: string; smtp_user: string; smtp_password: string; smtp_from: string; default_quota_mb: number; signup_enabled: boolean; google_client_id: string; google_client_secret: string; public_url: string }>) => request<AdminSettings>('/api/admin/settings', { method: 'PUT', ...json(b) }),
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
  proofread: (docId: string, blocks: { id: number; text: string }[], language?: string) =>
    request<{ issues: ProofIssue[] }>(`/api/docs/${docId}/proofread`, { method: 'POST', ...json({ blocks, ...(language ? { language } : {}) }) }, docId),
}

/** Raw streaming call to the assistant proxy (the caller reads the event stream). */
export async function aiChatRequest(body: unknown, signal?: AbortSignal): Promise<Response> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const t = getToken(); if (t) headers.set('Authorization', `Bearer ${t}`)
  return fetch('/api/ai/chat', { method: 'POST', headers, body: JSON.stringify(body), signal })
}
