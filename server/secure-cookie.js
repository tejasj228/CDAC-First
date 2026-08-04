import crypto from 'node:crypto'
import { config } from './config.js'

/**
 * AES-256-GCM encryption for cookie values.
 *
 * Why GCM and not plain AES? GCM is "authenticated" encryption: besides hiding
 * the contents it also produces a 16-byte auth tag. If anyone edits even one
 * character of the cookie in their browser, decryption throws instead of
 * silently returning garbage. So we get confidentiality AND tamper-detection.
 *
 * Stored format:  <iv>.<authTag>.<ciphertext>   (all base64url)
 */

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12 // 96-bit nonce, the size recommended for GCM

export function encrypt(value) {
  // A fresh random IV per encryption means the same data never produces the
  // same ciphertext twice. Reusing an IV with GCM would break the encryption.
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, config.prefsKey, iv)

  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ])

  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString('base64url'))
    .join('.')
}

export function decrypt(packed) {
  if (typeof packed !== 'string') return null

  const parts = packed.split('.')
  if (parts.length !== 3) return null

  try {
    const [iv, authTag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64url'))

    const decipher = crypto.createDecipheriv(ALGO, config.prefsKey, iv)
    decipher.setAuthTag(authTag) // throws below if the cookie was tampered with

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(plaintext.toString('utf8'))
  } catch {
    // Wrong key, edited cookie, or corrupted value -> treat as "no cookie".
    return null
  }
}
