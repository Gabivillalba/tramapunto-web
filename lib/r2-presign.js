// lib/r2-presign.js
// Firma una URL temporal (presigned PUT) para subir un objeto a Cloudflare R2
// usando el protocolo S3 / AWS Signature V4. Sin dependencias: solo 'crypto' de Node.
//
// Por qué presigned URL y no subir el archivo a través de la función:
//   - El Secret de R2 nunca sale del servidor (igual que el principio "privilegio solo en serverless").
//   - El navegador sube el video DIRECTO a R2, esquivando el límite de 4,5 MB de body de Vercel.
//
// Variables de entorno esperadas (se configuran en Vercel):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE
import crypto from 'node:crypto';

const enc = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
// Igual que enc() pero sin escapar '/', para el path del objeto.
const encPath = (p) => p.split('/').map(enc).join('/');

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/**
 * Devuelve una URL presigned para hacer PUT de un objeto en R2.
 * @param {object} o
 * @param {string} o.accountId  R2_ACCOUNT_ID
 * @param {string} o.accessKeyId
 * @param {string} o.secretAccessKey
 * @param {string} o.bucket
 * @param {string} o.key        ruta del objeto dentro del bucket (sin '/' inicial)
 * @param {number} [o.expiresIn=900]  segundos de validez (máx 7 días)
 * @returns {string} URL lista para PUT del archivo crudo como body
 */
export function presignPutUrl({ accountId, accessKeyId, secretAccessKey, bucket, key, expiresIn = 900 }) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${bucket}/${encPath(key)}`;

  // Query canónica (ordenada alfabéticamente), firmando solo el header 'host'.
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(q)
    .sort()
    .map((k) => `${enc(k)}=${enc(q[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Arma una key única para un video de creador y valida el content-type.
 * @returns {{ key: string, publicUrl: string } | null}  null si el tipo no es video.
 */
export function buildVideoTarget({ scope = 'videos', ownerId = 'anon', contentType = '', publicBase = '' }) {
  if (!/^video\//i.test(contentType)) return null;
  const extMap = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
  const ext = extMap[contentType.toLowerCase()] || 'mp4';
  const rand = (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2) + Date.now()).replace(/-/g, '');
  const safeOwner = String(ownerId).replace(/[^a-zA-Z0-9._-]/g, '') || 'anon';
  const key = `${scope}/${safeOwner}/${Date.now()}_${rand}.${ext}`;
  const publicUrl = `${publicBase.replace(/\/$/, '')}/${key}`;
  return { key, publicUrl };
}
