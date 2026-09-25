import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRODUCT_FILES, PRICES } from './products.js';
import { DISCOUNTS } from './discounts.js';
import { sendOrderEmail, sendContactEmail } from './email.js';
import { generateInvoicePDF } from './invoice-pdf.js';
import { notify } from './discord-webhook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILES_ROOT = path.join(__dirname, '..', 'files');

const app = express();
app.use(cors({ origin: (process.env.ALLOWED_ORIGIN || 'https://www.nexumo.store').split(',') }));
app.use(express.json());
app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

const FRONT_URL = process.env.FRONT_URL || 'https://www.nexumo.store';
const PAYPAL_MODE = (process.env.PAYPAL_MODE || 'live').toLowerCase();
const PAYPAL_BASE = PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';
const SIGN_SECRET = process.env.TOKEN_SECRET || PAYPAL_CLIENT_SECRET;
const TOKEN_TTL = 24 * 60 * 60 * 1000;

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
}

function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const i of items) {
    const id = Number(i?.id);
    const qty = Math.min(99, Math.max(1, parseInt(i?.qty) || 1));
    if (!PRODUCT_FILES[id] || PRICES[id] == null) continue;
    out.push({ id, qty });
  }
  return out;
}

function serverTotal(items) {
  const total = items.reduce((s, i) => s + PRICES[i.id] * i.qty, 0);
  return Math.round(total * 100) / 100;
}

function orderSig(items, total) {
  const canon = items.map(i => `${i.id}x${i.qty}`).sort().join(',');
  return crypto.createHmac('sha256', SIGN_SECRET).update(`${canon}|${total.toFixed(2)}`).digest('hex');
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SIGN_SECRET).update(body).digest('hex');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expect = crypto.createHmac('sha256', SIGN_SECRET).update(body).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function grantToken(items, email) {
  const files = [];
  const names = [];
  for (const it of items) {
    const def = PRODUCT_FILES[it.id];
    if (!def) continue;
    names.push(def.name);
    for (const f of def.files) files.push({ name: path.basename(f), rel: f });
  }
  if (!files.length) return null;
  const token = signToken({ f: files, n: names, e: email || '', exp: Date.now() + TOKEN_TTL });
  return { token, names, files };
}

function validEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim()) && !/[\r\n]/.test(e);
}

async function paypalToken() {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) throw new Error('Faltan claves PayPal');
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('PayPal auth error');
  return (await res.json()).access_token;
}

async function paypalRequest(method, urlPath, token, body) {
  const res = await fetch(`${PAYPAL_BASE}${urlPath}`, {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && (data.message || data.error_description)) || `PayPal ${res.status}`);
  return data;
}

app.get('/api/health', (_, res) => res.json({ ok: true, paypal: PAYPAL_MODE }));

app.post('/api/paypal/create-order', async (req, res) => {
  try {
    const items = cleanItems(req.body?.items);
    if (!items.length) return res.status(400).json({ error: 'Carrito vacío' });
    const total = serverTotal(items);
    const value = total.toFixed(2);
    const token = await paypalToken();
    const order = await paypalRequest('POST', '/v2/checkout/orders', token, {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: 'nexumo-' + Date.now(),
        description: 'Pedido NEXUMO',
        amount: {
          currency_code: 'EUR',
          value,
          breakdown: { item_total: { currency_code: 'EUR', value } },
        },
        items: items.map(i => ({
          name: String(PRODUCT_FILES[i.id].name).slice(0, 127),
          unit_amount: { currency_code: 'EUR', value: PRICES[i.id].toFixed(2) },
          quantity: String(i.qty),
        })),
      }],
      application_context: {
        brand_name: 'NEXUMO',
        user_action: 'PAY_NOW',
        return_url: `${FRONT_URL}/pages/pago-exitoso.html`,
        cancel_url: `${FRONT_URL}/pages/pago-cancelado.html`,
      },
    });
    res.json({ id: order.id, sig: orderSig(items, total) });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo crear el pedido' });
  }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  try {
    const { orderId, email = '', sig = '' } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'Falta orderId' });
    if (isBlocked(email)) return blockedRes(req, res, 'la compra');
    const items = cleanItems(req.body?.items);
    if (!items.length) return res.status(400).json({ error: 'Carrito vacío' });
    const total = serverTotal(items);
    if (!SIGN_SECRET || sig !== orderSig(items, total)) {
      return res.status(400).json({ error: 'Pedido no válido' });
    }
    const token = await paypalToken();
    const captured = await paypalRequest('POST', `/v2/checkout/orders/${orderId}/capture`, token);
    if (captured.status !== 'COMPLETED') return res.status(400).json({ error: 'El pago no se completó' });
    const unit = captured.purchase_units?.[0];
    const paid = parseFloat(unit?.amount?.value || unit?.payments?.captures?.[0]?.amount?.value || '0');
    if (Math.abs(paid - total) > 0.01) return res.status(400).json({ error: 'El importe no coincide' });
    const payerEmail = captured.payer?.email_address || email;
    if (isBlocked(payerEmail)) {
      req.body.email = payerEmail;
      return blockedRes(req, res, 'la compra (email PayPal)');
    }
    const granted = grantToken(items, payerEmail);
    if (!granted) return res.status(400).json({ error: 'No se pudo identificar el pedido' });
    const billItems = items.map(i => ({ name: PRODUCT_FILES[i.id].name, qty: i.qty, price: PRICES[i.id] }));
    const invDate = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const pdf = await generateInvoicePDF({ invoiceNo: captured.id, date: invDate, billTo: payerEmail, items: billItems, total: paid, paymentMethod: 'PayPal' }).catch(() => null);
    sendOrderEmail({
      to: payerEmail,
      items: billItems,
      total: paid, paymentMethod: 'PayPal', invoiceNo: captured.id,
      files: granted.files, token: granted.token, frontUrl: FRONT_URL,
    }).catch(() => {});
    notify.purchase({
      email: payerEmail,
      items: billItems,
      total: paid, method: 'PayPal', invoiceNo: captured.id, pdf,
    }).catch(() => {});
    res.json({ token: granted.token, pedido: captured.id, names: granted.names });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo confirmar el pago' });
  }
});

app.post('/api/free', async (req, res) => {
  try {
    const items = cleanItems(req.body?.items);
    const { email = '', code = '' } = req.body || {};
    if (!items.length) return res.status(400).json({ error: 'Carrito vacío' });
    if (isBlocked(email)) return blockedRes(req, res, 'el pedido gratis');
    const discount = DISCOUNTS[String(code || '').trim().toUpperCase()];
    if (!discount) return res.status(400).json({ error: 'Código no válido' });
    if (discount.products && !items.every(i => discount.products.includes(i.id))) {
      return res.status(400).json({ error: 'Ese código solo vale para productos concretos' });
    }
    if (discount.maxUses) {
      const used = redeemed.get(String(code).trim().toUpperCase()) || 0;
      if (used >= discount.maxUses) return res.status(400).json({ error: 'Ese código ya fue usado' });
    }
    const total = serverTotal(items);
    if (total * (1 - (discount.percent || 0) / 100) > 0.01) {
      return res.status(400).json({ error: 'Ese código solo cubre parte del importe' });
    }
    const granted = grantToken(items, email);
    if (!granted) return res.status(400).json({ error: 'No se pudo identificar el pedido' });
    const invoiceNo = 'FREE-' + Date.now();
    if (discount.maxUses) redeemed.set(String(code).trim().toUpperCase(), (redeemed.get(String(code).trim().toUpperCase()) || 0) + 1);
    const freeItems = items.map(i => ({ name: PRODUCT_FILES[i.id].name, qty: i.qty, price: PRICES[i.id] }));
    const freePdf = await generateInvoicePDF({ invoiceNo, date: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }), billTo: email, items: freeItems, total: 0, paymentMethod: 'Código de descuento' }).catch(() => null);
    sendOrderEmail({
      to: email,
      items: freeItems,
      total: 0, paymentMethod: 'Código de descuento', invoiceNo,
      files: granted.files, token: granted.token, frontUrl: FRONT_URL,
    }).catch(() => {});
    notify.purchase({
      email,
      items: freeItems,
      total: 0, method: 'Código de descuento', invoiceNo, pdf: freePdf,
    }).catch(() => {});
    res.json({ token: granted.token, pedido: invoiceNo, names: granted.names });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo generar el pedido' });
  }
});

app.get('/api/access/:token', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const t = verifyToken(req.params.token);
  if (!t) {
    notify.hack({ reason: 'Token de acceso no válido/caducado', ip: clientIp(req), info: 'Token: ' + shortToken(req.params.token) + '...' }).catch(() => {});
    return res.status(404).json({ error: 'Enlace no válido o caducado' });
  }
  res.json({
    names: t.n,
    files: t.f.map(f => ({ name: f.name, url: `/api/download/${req.params.token}?file=${encodeURIComponent(f.rel)}` })),
  });
});

app.get('/api/download/:token', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const t = verifyToken(req.params.token);
  const ip = clientIp(req);
  if (!t) {
    notify.hack({ reason: 'Descarga con token no válido', ip, info: 'Token: ' + shortToken(req.params.token) + '...' }).catch(() => {});
    return res.status(403).send('Enlace no válido o caducado');
  }
  const rel = req.query.file;
  const file = t.f.find(f => f.rel === rel);
  if (!file) {
    notify.hack({ reason: 'Descarga de archivo no autorizado', ip, info: 'File: ' + String(rel).slice(0, 80) }).catch(() => {});
    return res.status(403).send('Archivo no autorizado');
  }
  const abs = path.resolve(FILES_ROOT, file.rel);
  if (!abs.startsWith(FILES_ROOT)) return res.status(403).send('Acceso denegado');
  if (!fs.existsSync(abs)) return res.status(404).send('Archivo no encontrado');
  res.download(abs, file.name);
});

app.post('/api/track', async (req, res) => {
  if (abuseCheck(req, res, 'track')) return;
  try {
    await Promise.race([
      notify.visit({
        page: req.body?.page || '/',
    ip: req.headers['x-real-ip'] || clientIp(req),
    ua: req.headers['user-agent'] || '',
    referrer: req.headers['referer'] || req.body?.referrer || '',
    vid: String(req.body?.vid || '').slice(0, 32),
    isNew: req.body?.isNew === true,
    fp: req.body?.fp || {},
    bots: Array.isArray(req.body?.bots) ? req.body.bots.slice(0, 5) : [],
    fph: String(req.body?.fph || '').slice(0, 16),
    geoHint: {
      browserTz: (req.body?.fp && req.body.fp.tz) || '',
      gps: req.body?.geo || null,
      country: req.headers['x-vercel-ip-country'],
      countryCode: req.headers['x-vercel-ip-country'],
      region: req.headers['x-vercel-ip-country-region'],
      city: req.headers['x-vercel-ip-city']
        ? decodeURIComponent(req.headers['x-vercel-ip-city']) : '',
    },
    }).catch(() => {}),
      new Promise(r => setTimeout(r, 8000)),
    ]);
  } catch (e) {}
  res.json({ ok: true });
});

const hits = new Map();
const warned = new Map();
const redeemed = new Map();

const BLOCKED_EMAILS = new Set(['oskiw.14@gmail.com']);
function isBlocked(email) {
  return BLOCKED_EMAILS.has(String(email || '').trim().toLowerCase());
}
function blockedRes(req, res, where) {
  const email = String(req.body?.email || req.body?.name || '').slice(0, 80);
  notify.hack({ reason: `Email bloqueado de por vida intentó usar ${where}`, ip: clientIp(req), info: 'Email: ' + (req.body?.email || '') }).catch(() => {});
  return res.status(403).json({ error: 'No podemos procesar tu solicitud' });
}
function abuseCheck(req, res, kind) {
  const ip = clientIp(req);
  const nowTs = Date.now();
  const arr = (hits.get(ip) || []).filter(t => nowTs - t < 60000);
  arr.push(nowTs);
  hits.set(ip, arr);
  if (arr.length > 40 && nowTs - (warned.get(ip) || 0) > 600000) {
    warned.set(ip, nowTs);
    notify.hack({ reason: `Posible botnet/abuso en ${kind}: ${arr.length} peticiones/min`, ip, info: '' }).catch(() => {});
  }
  if (arr.length > 200) { res.status(429).json({ error: 'Demasiadas peticiones' }); return true; }
  return false;
}

function shortToken(t) { return String(t || '').slice(0, 8); }

const publishedReviews = [];

app.post('/api/review', (req, res) => {
  if (abuseCheck(req, res, 'reviews')) return;
  if (isBlocked(req.body?.name) || String(req.body?.message || '').toLowerCase().includes('oskiw.14@gmail.com')) return blockedRes(req, res, 'las reseñas');
  try {
    const { name = '', rating = 5, message = '' } = req.body || {};
    const r = Math.min(5, Math.max(1, parseInt(rating) || 5));
    if (!String(message).trim() || String(message).length > 500) return res.status(400).json({ error: 'Reseña no válida' });
    const cleanName = String(name).slice(0, 60) || 'Anónimo';
    const cleanMsg = String(message).slice(0, 500);
    const published = r >= 4;
    if (published) {
      publishedReviews.unshift({ name: cleanName, rating: r, message: cleanMsg, ts: Date.now() });
      if (publishedReviews.length > 50) publishedReviews.length = 50;
    }
    notify.review({ name: cleanName, rating: r, message: cleanMsg, ip: clientIp(req), published }).catch(() => {});
    res.json({ ok: true, published });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo enviar' });
  }
});

app.get('/api/reviews', (_, res) => {
  res.json({ reviews: publishedReviews.slice(0, 12) });
});

app.post('/api/contact', async (req, res) => {
  if (abuseCheck(req, res, 'contact')) return;
  if (isBlocked(req.body?.email)) return blockedRes(req, res, 'el contacto');
  try {
    const { name = '', email = '', message = '' } = req.body || {};
    if (!message || String(message).length > 2000) return res.status(400).json({ error: 'Mensaje no válido' });
    if (email && !validEmail(email)) return res.status(400).json({ error: 'Email no válido' });
    notify.contact({ name: String(name).slice(0, 100), email, message }).catch(() => {});
    sendContactEmail({ name, email, message }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'No se pudo enviar' });
  }
});

export default app;
