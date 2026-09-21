import nodemailer from 'nodemailer';
import { generateInvoicePDF } from './invoice-pdf.js';

const SUPPORT = process.env?.SUPPORT_EMAIL || 'astrihub@gmail.com';

let transporter = null;

function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

function fmtEUR(n) {
  return Number(n).toFixed(2).replace('.', ',') + ' €';
}

function invoiceDate() {
  return new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function sendOrderEmail({ to, items, total, paymentMethod, invoiceNo, files, token, frontUrl }) {
  const tr = getTransporter();
  if (!tr) {
    console.log('[email] SMTP no configurado, se omite el envío a', to);
    return;
  }

  const rows = items.map(i => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">${esc(i.name)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${Number(i.qty) || 1}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${fmtEUR(i.price)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700">${fmtEUR((Number(i.price) || 0) * (Number(i.qty) || 1))}</td>
    </tr>`).join('');

  const dwn = files.map(f => {
    const url = `${frontUrl}/api/download/${token}?file=${encodeURIComponent(f.rel)}`;
    return `
      <a href="${url}" style="display:block;background:#1f2937;color:#fff;text-decoration:none;padding:12px 16px;border-radius:10px;margin:6px 0;font-weight:600">
        ⬇ ${esc(f.name)}
      </a>`;
  }).join('');

  const subtotal = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
  const iva = subtotal * 0.21;
  const descuento = Math.max(0, subtotal - Number(total));

  const html = `
  <div style="background:#eef1f5;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111827">
    <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
      <div style="padding:22px 32px;border-bottom:1px solid #e5e7eb">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
          <tr>
            <td style="font-weight:800;font-size:20px;color:#111827;font-family:Arial,sans-serif">Factura</td>
            <td align="right" style="font-weight:800;font-size:18px;color:#6b7280;font-family:Arial,sans-serif;vertical-align:middle">NEXUMO</td>
          </tr>
        </table>
      </div>
      <div style="padding:26px 32px">
        <div style="font-size:13px;color:#6b7280;margin-bottom:14px">
          <div>Número de factura: <b style="color:#111827">${esc(invoiceNo)}</b></div>
          <div>Fecha de emisión: ${invoiceDate()}</div>
        </div>
        <div style="display:flex;gap:24px;font-size:13px;margin-bottom:20px;color:#6b7280;flex-wrap:wrap">
          <div>
            <div style="font-weight:700;color:#111827">NEXUMO</div>
            <div>España</div>
          </div>
          <div>
            <div style="font-weight:700;color:#111827">Facturar a</div>
            <div>${esc(to)}</div>
          </div>
        </div>

        <div style="font-size:26px;font-weight:800;margin:18px 0 6px">${fmtEUR(total)}</div>
        <div style="font-size:13px;color:#6b7280;margin-bottom:4px">Método de pago: <b style="color:#111827">${esc(paymentMethod)}</b></div>
        <div style="font-size:13px;color:#6b7280;margin-bottom:18px">Soporte: <b style="color:#111827">${SUPPORT}</b></div>

        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="border-top:2px solid #111827;border-bottom:1px solid #111827">
              <th style="text-align:left;padding:8px 12px">Descripción</th>
              <th style="text-align:center;padding:8px 12px">Cant.</th>
              <th style="text-align:right;padding:8px 12px">Precio unitario</th>
              <th style="text-align:right;padding:8px 12px">Importe</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div style="text-align:right;font-size:14px;margin-top:8px">
          <div style="padding:3px 0"><span style="color:#6b7280">Subtotal</span> <b style="margin-left:24px">${fmtEUR(subtotal)}</b></div>
          <div style="padding:3px 0"><span style="color:#6b7280">IVA (21%)</span> <b style="margin-left:24px">${fmtEUR(iva)}</b></div>
          ${descuento > 0.01 ? `<div style="padding:3px 0"><span style="color:#6b7280">Descuento</span> <b style="margin-left:24px;color:#16a34a">- ${fmtEUR(descuento)}</b></div>` : ''}
          <div style="border-top:2px solid #111827;margin-top:8px;padding-top:10px;display:flex;justify-content:flex-end;align-items:center;gap:24px"><span style="font-weight:700">TOTAL</span> <b style="font-size:18px">${fmtEUR(total)}</b></div>
        </div>

        ${files.length ? `
        <div style="margin-top:26px;background:#f3f4f6;border-radius:12px;padding:16px">
          <div style="font-weight:800;font-size:14px;margin-bottom:10px">Tus productos (descarga):</div>
          <div style="font-size:12px;color:#6b7280;margin-bottom:8px">Guarda estos enlaces por si necesitas volver a descargar.</div>
          ${dwn}
        </div>` : ''}
      </div>
      <div style="padding:14px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">${esc(invoiceNo)} · ${fmtEUR(total)} · ${SUPPORT}</div>
    </div>
  </div>`;

  const pdf = await generateInvoicePDF({
    invoiceNo,
    date: invoiceDate(),
    billTo: to,
    items,
    total,
    paymentMethod,
  });

  await tr.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject: `Tu factura NEXUMO (${invoiceNo})`,
    html,
    attachments: [{
      filename: `factura-${invoiceNo}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_'),
      content: pdf,
      contentType: 'application/pdf',
    }],
  });
  console.log('[email] Factura enviada a', to);
}

export async function sendContactEmail({ name, email, message }) {
  const tr = getTransporter();
  if (!tr) {
    console.log('[email] SMTP no configurado, sin envío de contacto');
    return;
  }
  await tr.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: process.env.SUPPORT_EMAIL || 'astrihub@gmail.com',
    replyTo: email || undefined,
    subject: 'Nuevo mensaje de soporte · ' + (name || 'cliente'),
    text: `Nombre: ${name}\nEmail: ${email}\n\n${message}`,
  });
  console.log('[email] Mensaje de soporte reenviado a', process.env.SUPPORT_EMAIL || 'astrihub@gmail.com');
}
