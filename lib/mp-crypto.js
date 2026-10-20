// lib/mp-crypto.js
// Cifrado simétrico de los tokens de MercadoPago de cada creador (en reposo).
// AES-256-GCM. Clave: env var MP_TOKEN_ENC_KEY (32 bytes en base64).
// Valor almacenado: "v1:" + base64( iv[12] | authTag[16] | ciphertext )
// decrypt() es retrocompatible: si no empieza con "v1:" devuelve el valor tal cual.

import crypto from 'node:crypto';

const PREFIX = 'v1:';

function getKey() {
  const raw = process.env.MP_TOKEN_ENC_KEY || '';
  if (!raw) throw new Error('MP_TOKEN_ENC_KEY no está configurada');
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('MP_TOKEN_ENC_KEY inválida: se requieren 32 bytes (base64 o hex)');
  }
  return buf;
}

export function encrypt(plain) {
  if (plain === null || plain === undefined) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(blob) {
  if (blob === null || blob === undefined || blob === '') return null;
  const s = String(blob);
  if (!s.startsWith(PREFIX)) return s;
  const key = getKey();
  const raw = Buffer.from(s.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
