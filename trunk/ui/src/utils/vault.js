// =============================================================================
// lib/vault.js — Bitwarden/Vaultwarden client-side crypto helpers
// All operations use browser-native crypto.subtle; no dependencies.
// =============================================================================

export const VAULT_TOKEN_KEY = 'thrive.vaultToken'
export const VAULT_SYM_KEY   = 'thrive.vaultSymKey'

// ── Encoding helpers ──────────────────────────────────────────────────────────
const b64ToBytes = s => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const bytesToB64 = b => btoa(String.fromCharCode(...b))

// ── Key derivation ────────────────────────────────────────────────────────────

// PBKDF2-SHA-256: password + email → 32-byte master key
export async function deriveMasterKey(password, email, iterations = 600000) {
    const enc = new TextEncoder()
    const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(email.toLowerCase()), iterations, hash: 'SHA-256' },
        km, 256
    )
    return new Uint8Array(bits)
}

// PBKDF2-SHA-256 (1 iteration): master key + password → base64 auth hash
export async function deriveMasterPasswordHash(masterKey, password) {
    const enc = new TextEncoder()
    const km = await crypto.subtle.importKey('raw', masterKey, 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(password), iterations: 1, hash: 'SHA-256' },
        km, 256
    )
    return bytesToB64(new Uint8Array(bits))
}

// HKDF-Expand-only (Bitwarden's actual implementation — not Web Crypto's Extract+Expand).
// Treats the master key directly as the PRK and expands via a single HMAC-SHA-256 round:
//   T(1) = HMAC-SHA-256(prk, info || 0x01)
async function hkdfExpand(prk, info) {
    const enc = new TextEncoder()
    const hmacKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const infoBytes = enc.encode(info)
    const data = new Uint8Array(infoBytes.length + 1)
    data.set(infoBytes)
    data[infoBytes.length] = 1
    return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, data))
}

// 32-byte master key → 64-byte symmetric key (enc[0..31] + mac[32..63])
export async function stretchMasterKey(masterKeyBytes) {
    const [encKey, macKey] = await Promise.all([
        hkdfExpand(masterKeyBytes, 'enc'),
        hkdfExpand(masterKeyBytes, 'mac'),
    ])
    const symKey = new Uint8Array(64)
    symKey.set(encKey, 0)
    symKey.set(macKey, 32)
    return symKey
}

// ── EncString decryption ──────────────────────────────────────────────────────
// Supports type 2: AES-256-CBC + HMAC-SHA-256 ("2.{iv}|{ct}|{mac}", all base64)
// symKey is Uint8Array(64): bytes 0-31 = AES key, bytes 32-63 = HMAC key

// → raw bytes (use for decrypting another key)
export async function decryptEncStringToBytes(encString, symKey) {
    if (!encString?.includes('|')) return null
    const raw = encString.includes('.') ? encString.slice(encString.indexOf('.') + 1) : encString
    const parts = raw.split('|')
    if (parts.length < 3) return null
    const [iv, ct, mac] = parts.map(b64ToBytes)

    // Verify HMAC-SHA-256 over iv ‖ ct
    const macKey = await crypto.subtle.importKey(
        'raw', symKey.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const toVerify = new Uint8Array(iv.length + ct.length)
    toVerify.set(iv); toVerify.set(ct, iv.length)
    const valid = await crypto.subtle.verify('HMAC', macKey, mac, toVerify)
    if (!valid) return null

    // AES-256-CBC decrypt
    const aesKey = await crypto.subtle.importKey('raw', symKey.slice(0, 32), 'AES-CBC', false, ['decrypt'])
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, aesKey, ct)
    return new Uint8Array(plain)
}

// → UTF-8 string (use for cipher names, URIs, notes)
export async function decryptEncString(encString, symKey) {
    const bytes = await decryptEncStringToBytes(encString, symKey)
    return bytes ? new TextDecoder().decode(bytes) : null
}

// ── EncString encryption ────────────────────────────────────────────────────
// Inverse of decryptEncString: UTF-8 string → type-2 EncString
// ("2.{iv}|{ct}|{mac}"). AES-256-CBC with a fresh random IV, then HMAC-SHA-256
// over iv ‖ ct — exactly what Bitwarden/Vaultwarden expects on write.
export async function encryptEncString(plaintext, symKey) {
    const iv = crypto.getRandomValues(new Uint8Array(16))
    const aesKey = await crypto.subtle.importKey('raw', symKey.slice(0, 32), 'AES-CBC', false, ['encrypt'])
    const ctBuf  = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aesKey, new TextEncoder().encode(plaintext))
    const ct = new Uint8Array(ctBuf)

    const macKey = await crypto.subtle.importKey('raw', symKey.slice(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const toMac = new Uint8Array(iv.length + ct.length)
    toMac.set(iv); toMac.set(ct, iv.length)
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', macKey, toMac))

    return `2.${bytesToB64(iv)}|${bytesToB64(ct)}|${bytesToB64(mac)}`
}

// ── localStorage helpers ──────────────────────────────────────────────────────

export function loadVaultSymKey() {
    const b64 = localStorage.getItem(VAULT_SYM_KEY)
    return b64 ? b64ToBytes(b64) : null
}

export function saveVaultSymKey(bytes) {
    localStorage.setItem(VAULT_SYM_KEY, bytesToB64(bytes))
}

export function clearVaultStorage() {
    localStorage.removeItem(VAULT_TOKEN_KEY)
    localStorage.removeItem(VAULT_SYM_KEY)
}