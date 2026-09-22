import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || '';

if (!WEBHOOK) {
  console.warn('[discord] DISCORD_WEBHOOK_URL no está definida en .env — las notificaciones a Discord no se enviarán.');
}

export async function sendDiscord(text) {
  if (!WEBHOOK) return;
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) console.error('[discord] status', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.error('[discord] error', e.message);
  }
}

function fmtEUR(n) { return '€' + Number(n).toFixed(2).replace('.', ','); }
function now() { return new Date().toLocaleString('es-ES'); }


const geoCache = new Map();
const GEO_TTL = 60 * 60 * 1000;

function isPrivateIp(ip) {
  return !ip || ip === '::1' || ip === '127.0.0.1' ||
    /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

async function geoLookup(ip, hint = {}) {
  const fallback = { country: 'Desconocido', countryCode: '', region: '', city: '', isp: '', src: '' };
  if (hint.country) {
    return {
      country: hint.country, countryCode: hint.countryCode || '',
      region: hint.region || '', city: hint.city || '', isp: '',
      src: 'vercel-edge',
    };
  }
  if (isPrivateIp(ip)) return { ...fallback, country: 'Local/Privada' };

  const cached = geoCache.get(ip);
  if (cached && Date.now() - cached.ts < GEO_TTL) return cached.data;

  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    const data = await res.json();
    if (data.error) throw new Error(data.reason || 'geo error');
    const info = {
      country: data.country_name || 'Desconocido',
      countryCode: data.country_code || '',
      region: data.region || '',
      city: data.city || '',
      isp: data.org || '',
      src: 'ipapi',
    };
    geoCache.set(ip, { data: info, ts: Date.now() });
    return info;
  } catch (e) {
    console.error('[geo] error:', e.message);
    return fallback;
  }
}


function parseUA(ua = '') {
  let device = 'Escritorio';
  if (/Tablet|iPad|Nexus 7|Nexus 9|SM-T\d/i.test(ua)) device = 'Tablet';
  else if (/Mobile|Mobi|Android|iPhone|iPod|Windows Phone|BlackBerry|Opera Mini/i.test(ua)) device = 'Móvil';

  let os = 'Desconocido';
  if (/Windows NT 10/i.test(ua)) os = 'Windows 10/11';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iOS/i.test(ua)) os = 'iOS';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Desconocido';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\//i.test(ua)) browser = 'Opera';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';

  return { device, os, browser };
}


const DATA_DIR = path.join(__dirname, 'data');
const VISITS_FILE = path.join(DATA_DIR, 'visits.jsonl');

function saveVisitRecord(record) {
}

export const notify = {
  async visit({ page, ip, ua, referrer, geoHint, vid, isNew, fp, bots, fph }) {
    const geo = await geoLookup(ip, geoHint);
    const { device, os, browser } = parseUA(ua);
    const rawUa = String(ua || '').slice(0, 180) || 'sin user-agent';
    const f = fp || {};
    const botFlags = (bots || []).join(', ');
    const fpLine = [f.plat, f.scr, f.lang, f.tz].filter(Boolean).join(' · ') || '—';

    await sendDiscord(
`**📢 ${isNew ? 'Nuevo visitante' : 'Visita recurrente'} en NEXUMO**
🕐 ${now()}
🆔 Visitante: ${vid || 'desconocido'}${fph ? ` (huella ${fph})` : ''}${isNew ? ' · 🆕 primera vez' : ' · 🔁 ya conocido'}
🤖 Bot: ${botFlags ? `SOSPECHOSO (${botFlags})` : 'no (parece humano)'}
📄 Página: ${page || '/'}
🌍 País: ${geo.country}${geo.countryCode ? ` (${geo.countryCode})` : ''}${geo.city ? ` — ${geo.city}${geo.region ? ', ' + geo.region : ''}` : ''}${geo.isp ? ` — ${geo.isp}` : ''}
🌐 IP: ${ip || 'desconocida'}${geo.src ? ` (geo: ${geo.src})` : ''}
📱 Dispositivo: ${device} · ${os} · ${browser}
🖥️ Huella: ${fpLine}${f.cores ? ` · ${f.cores} núcleos` : ''}${f.touch ? ` · táctil x${f.touch}` : ''}
🔗 Referrer: ${referrer || 'directo'}
🧾 UA: ${rawUa}`
    );
  },

  async purchase({ email, items, total, method, invoiceNo }) {
    const lineas = (items || []).map(i =>
      `• ${i.name} x${i.qty} — ${fmtEUR((Number(i.price) || 0) * (Number(i.qty) || 1))}`
    ).join('\n') || '—';
    await sendDiscord(
`**💰 Nueva compra en NEXUMO**
🕐 ${now()}
🧾 Factura: ${invoiceNo || '—'}
📧 Cliente: ${email || '—'}
💳 Método: ${method || '—'}
📦 Productos:
${lineas}
**TOTAL: ${fmtEUR(total || 0)}**`
    );
  },

  async hack({ reason, ip, info }) {
    await sendDiscord(
`**🔒 ALERTA — Posible intrusión en NEXUMO**
🕐 ${now()}
⚠️ Motivo: ${reason}
🌐 IP: ${ip || 'desconocida'}
📋 Info: ${info || ''}`
    );
  },

  async contact({ name, email, message }) {
    await sendDiscord(
`**📨 Mensaje de soporte (web)**
🕐 ${now()}
👤 Nombre: ${name || '—'}
📧 Email: ${email || '—'}
💬 Mensaje:
${message || ''}`
    );
  },
};
