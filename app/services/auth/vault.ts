/**
 * Secure Vault for Web Storage
 *
 * Uses tweetnacl (XSalsa20-Poly1305) for encryption.
 * Provides obscured storage that requires JS execution to read.
 */

import nacl from "tweetnacl"
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from "tweetnacl-util"

// Obscured key derivation - not in obvious variable names
const _k = () => {
  // Derive key from app-specific values mixed with origin
  const _s = `rs_${window.location.origin}_f7k2m9x`
  const _h = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    _h[i] = _s.charCodeAt(i % _s.length) ^ (i * 7 + 13)
  }
  return _h
}

// Key cache
let _c: Uint8Array | null = null
const _g = (): Uint8Array => {
  if (!_c) _c = _k()
  return _c
}

/**
 * Seal data (encrypt)
 */
export function seal(data: string): string {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const msgBytes = decodeUTF8(data)
  const box = nacl.secretbox(msgBytes, nonce, _g())

  // Combine nonce + ciphertext
  const full = new Uint8Array(nonce.length + box.length)
  full.set(nonce)
  full.set(box, nonce.length)

  return encodeBase64(full)
}

/**
 * Unseal data (decrypt)
 */
export function unseal(encoded: string): string | null {
  try {
    const full = decodeBase64(encoded)
    const nonce = full.slice(0, nacl.secretbox.nonceLength)
    const box = full.slice(nacl.secretbox.nonceLength)

    const msgBytes = nacl.secretbox.open(box, nonce, _g())
    if (!msgBytes) return null

    return encodeUTF8(msgBytes)
  } catch {
    return null
  }
}

/**
 * Store sealed value
 */
export function put(key: string, value: string): void {
  try {
    // Use obscured key prefix
    const k = `_rs_${btoa(key).slice(0, 8)}`
    localStorage.setItem(k, seal(value))
  } catch {
    // Silent fail
  }
}

/**
 * Retrieve and unseal value
 */
export function get(key: string): string | null {
  try {
    const k = `_rs_${btoa(key).slice(0, 8)}`
    const v = localStorage.getItem(k)
    if (!v) return null
    return unseal(v)
  } catch {
    return null
  }
}

/**
 * Remove value
 */
export function remove(key: string): void {
  try {
    const k = `_rs_${btoa(key).slice(0, 8)}`
    localStorage.removeItem(k)
  } catch {
    // Silent fail
  }
}
