// Zero-knowledge encryption: the primitives. Everything here runs in the browser; nothing it produces from a password or a key is ever sent anywhere.
//
//   password --Argon2id--> 64 bytes --HKDF--> login secret (sent to the server)  +  wrapping key (never leaves the browser)
//   wrapping key  wraps  the master key;  recovery key  wraps  it a second time
//   master key    wraps  the private half of the person's X25519 keypair
//   each document has its own random key; a person's copy of it is "sealed" to their public key (ephemeral X25519 + HKDF + AES-GCM)
//   edits, titles and comments are AES-GCM with the document key, bound to the document by its id
import { x25519 } from '@noble/curves/ed25519.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

export const ARGON = { m: 65536, t: 3, p: 1 }   // 64 MiB, 3 passes: about a second on a phone
export type ArgonParams = typeof ARGON

// ── encoding ──
export function b64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function unb64(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export const utf8 = (s: string) => enc.encode(s)
export const fromUtf8 = (b: Uint8Array) => dec.decode(b)
export const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))
const concat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length } return o }
// WebCrypto wants plain ArrayBuffer-backed views
const ab = (b: Uint8Array): BufferSource => b as unknown as BufferSource

// ── key derivation ──
export async function stretch(password: string, salt: Uint8Array, p: ArgonParams = ARGON): Promise<Uint8Array> {
  const { argon2id } = await import('hash-wasm')
  return argon2id({ password: password.normalize('NFKC'), salt, parallelism: p.p, iterations: p.t, memorySize: p.m, hashLength: 64, outputType: 'binary' })
}

export async function hkdf(secret: Uint8Array, info: string, length = 32, salt: Uint8Array = new Uint8Array(0)): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', ab(secret), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: ab(salt), info: ab(utf8(info)) }, k, length * 8))
}

/** What a password turns into: the secret the server checks, and the key that wraps the master key. */
export async function fromPassword(password: string, salt: Uint8Array, p: ArgonParams = ARGON) {
  const out = await stretch(password, salt, p)
  return { auth: b64(await hkdf(out, 'koko-zk-login-v1')), kek: await hkdf(out, 'koko-zk-wrap-v1') }
}

// ── symmetric encryption (AES-256-GCM; output is nonce || ciphertext) ──
async function aesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ab(raw), 'AES-GCM', false, usage)
}
export async function seal256(key: Uint8Array, data: Uint8Array, aad = ''): Promise<Uint8Array> {
  const nonce = random(12)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(nonce), additionalData: ab(utf8(aad)) }, await aesKey(key, ['encrypt']), ab(data)))
  return concat(nonce, ct)
}
export async function open256(key: Uint8Array, blob: Uint8Array, aad = ''): Promise<Uint8Array> {
  if (blob.length < 29) throw new Error('That data is too short to be valid')
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ab(blob.subarray(0, 12)), additionalData: ab(utf8(aad)) }, await aesKey(key, ['decrypt']), ab(blob.subarray(12))))
}
export const sealText = async (key: Uint8Array, text: string, aad = '') => b64(await seal256(key, utf8(text), aad))
export const openText = async (key: Uint8Array, s: string, aad = '') => fromUtf8(await open256(key, unb64(s), aad))

// ── public-key sealing (a key for one specific person) ──
export function newKeypair() {
  const priv = x25519.utils.randomSecretKey()
  return { priv, pub: x25519.getPublicKey(priv) }
}
export async function sealTo(pub: Uint8Array, secret: Uint8Array): Promise<string> {
  const eph = x25519.utils.randomSecretKey(), epub = x25519.getPublicKey(eph)
  const key = await hkdf(x25519.getSharedSecret(eph, pub), 'koko-zk-seal-v1', 32, concat(epub, pub))
  return b64(concat(epub, await seal256(key, secret)))
}
export async function openSealed(priv: Uint8Array, sealed: string): Promise<Uint8Array> {
  const blob = unb64(sealed), epub = blob.subarray(0, 32), pub = x25519.getPublicKey(priv)
  const key = await hkdf(x25519.getSharedSecret(priv, epub), 'koko-zk-seal-v1', 32, concat(epub, pub))
  return open256(key, blob.subarray(32))
}

/** Something to compare out loud or in a message to make sure a public key is really theirs. */
export async function fingerprint(pub: Uint8Array | string): Promise<string> {
  const p = typeof pub === 'string' ? unb64(pub) : pub
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', ab(p))).subarray(0, 15)
  return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase().replace(/(.{5})/g, '$1 ').trim()
}

// ── the recovery key: 32 random bytes shown as 52 characters ──
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'   // Crockford base32: no I, L, O or U, so it is hard to misread
export function recoveryToText(raw: Uint8Array): string {
  let bits = 0, acc = 0, out = ''
  for (const byte of raw) { acc = (acc << 8) | byte; bits += 8; while (bits >= 5) { out += ALPHABET[(acc >> (bits - 5)) & 31]; bits -= 5 } }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31]
  return out.replace(/(.{4})/g, '$1-').replace(/-$/, '')
}
export function recoveryFromText(text: string): Uint8Array | null {
  const t = text.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  if (t.length !== 52) return null
  let bits = 0, acc = 0
  const out: number[] = []
  for (const ch of t) {
    const v = ALPHABET.indexOf(ch)
    if (v < 0) return null
    acc = (acc << 5) | v; bits += 5
    if (bits >= 8) { out.push((acc >> (bits - 8)) & 255); bits -= 8 }
  }
  return out.length >= 32 ? new Uint8Array(out.slice(0, 32)) : null
}
export const recoveryWrapKey = (raw: Uint8Array) => hkdf(raw, 'koko-zk-recovery-v1')

// ── per-purpose keys derived from the master key ──
export const privWrapKey = (master: Uint8Array) => hkdf(master, 'koko-zk-private-key-v1')
