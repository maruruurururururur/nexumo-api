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

function tzOffsetMinutes(tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const parts = Object.fromEntries(dtf.formatToParts(new Date()).map(p => [p.type, p.value]));
    const asUTC = Date.UTC(parts.year, Number(parts.month) - 1, parts.day, parts.hour === '24' ? 0 : Number(parts.hour), parts.minute);
    return Math.round((asUTC - Date.now()) / 60000);
  } catch { return null; }
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
  if (cached && Date.now() - cached.ts < GEO_TTL) {
    const info = { ...cached.data };
    if (hint.country && !info.countryCode) { info.country = hint.country; info.countryCode = hint.countryCode || ''; }
    return { ...info, ...vpnCheck(info, hint) };
  }

  try {
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.status !== 'success') throw new Error(data.message || 'geo error');
    const info = {
      country: hint.country || data.country || 'Desconocido',
      countryCode: hint.countryCode || data.countryCode || '',
      region: hint.region || data.regionName || '',
      city: hint.city || data.city || '',
      zip: data.zip || '',
      lat: data.lat, lon: data.lon,
      tz: data.timezone || '',
      isp: data.isp || '',
      org: data.org || '',
      asn: data.as || '',
      mobile: !!data.mobile,
      proxy: !!data.proxy,
      hosting: !!data.hosting,
      src: hint.country ? 'vercel-edge+ip-api' : 'ip-api',
    };
    geoCache.set(ip, { data: info, ts: Date.now() });
    return { ...info, ...vpnCheck(info, hint) };
  } catch (e) {
    if (hint.country) {
      return {
        country: hint.country, countryCode: hint.countryCode || '',
        region: hint.region || '', city: hint.city || '', isp: '',
        src: 'vercel-edge',
      };
    }
    return fallback;
  }
}

function vpnCheck(info, hint) {
  const reasons = [];
  if (info.proxy) reasons.push('proxy declarado');
  if (info.hosting) reasons.push('IP de datacenter/hosting');
  const btz = hint.browserTz || '';
  if (btz && info.tz) {
    const a = tzOffsetMinutes(btz);
    const b = tzOffsetMinutes(info.tz);
    if (a !== null && b !== null && Math.abs(a - b) > 60) reasons.push(`zona horaria no cuadra (navegador ${btz} vs IP ${info.tz})`);
  }
  return { vpn: reasons.length > 0, vpnReasons: reasons };
}


function aliasFor(vid, fph) {
  const adj = ['Veloz','Sigiloso','Nocturno','Bravo','Astuto','Curioso','Feroz','Tranquilo','Audaz','Listo','Sereno','Inquieto','Noble','Picaro','Tenaz','Vivaz'];
  const ani = ['Zorro','Lobo','Cuervo','Tiburon','Aguila','Tigre','Búho','Delfin','Pantera','Halcón','Oso','Lince','Toro','Dragón','Fénix','Jaguar'];
  let h = 5381;
  const s = String(vid || '') + '|' + String(fph || '');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `${ani[h % ani.length]} ${adj[(h >> 4) % adj.length]} #${(h & 0xffff).toString(16).padStart(4, '0').toUpperCase()}`;
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
👤 Nombre: ${aliasFor(vid, fph)}${isNew ? ' · 🆕 primera vez' : ' · 🔁 ya conocido'}
🆔 ID: ${vid || 'desconocido'}${fph ? ` (huella ${fph})` : ''}${botFlags ? `
🤖 SOSPECHOSO: ${botFlags}` : ''}
📄 Página: ${page || '/'}
🌍 País: ${geo.country}${geo.countryCode ? ` (${geo.countryCode})` : ''}${geo.city ? ` — ${geo.city}${geo.region ? ', ' + geo.region : ''}` : ''}${geo.isp ? ` — ${geo.isp}` : ''}
🌐 IP: ${ip || 'desconocida'}${geo.asn ? ` — ${geo.asn}` : ''}${geo.src ? ` (geo: ${geo.src})` : ''}${geo.mobile ? ' · 📶 IP móvil' : ''}
🛡️ VPN/Proxy: ${geo.vpn ? `SÍ (${(geo.vpnReasons || []).join(' + ')})` : 'no'}${(geo.lat && geo.lon) ? `
📍 Mapa: https://www.google.com/maps?q=${geo.lat},${geo.lon}` : ''}
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

  async review({ name, rating, message, ip, published }) {
    const stars = '★'.repeat(Math.min(5, Math.max(1, Number(rating) || 5)));
    await sendDiscord(
`**⭐ Nueva reseña en NEXUMO${published ? ' (PUBLICADA en la web)' : ' (1-3★: solo moderación)'}`
🕐 ${now()}
👤 ${name || 'Anónimo'} · ${stars} (${rating}/5)
🕐 ${now()}
👤 ${name || 'Anónimo'} · ${stars} (${rating}/5)
💬 ${message || ''}
🌐 IP: ${ip || 'desconocida'}`
    );
  },

  async contact({ name, email, message }) {    await sendDiscord(
`**📨 Mensaje de soporte (web)**
🕐 ${now()}
👤 Nombre: ${name || '—'}
📧 Email: ${email || '—'}
💬 Mensaje:
${message || ''}`
    );
  },
};
