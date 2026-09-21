import PDFDocument from 'pdfkit';

const SUPPORT = process.env?.SUPPORT_EMAIL || 'astrihub@gmail.com';

function fmt(n) {
  return Number(n).toFixed(2).replace('.', ',') + ' €';
}

export function generateInvoicePDF({ invoiceNo, date, billTo, items, total, paymentMethod }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 48, size: 'A4' });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const dark = '#111827';
      const gray = '#6b7280';


      const subtotal = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 1), 0);
      const iva = subtotal * 0.21;
      const descuento = Math.max(0, subtotal - total);

      let y = 48;


      doc.font('Helvetica-Bold').fontSize(14).fillColor('#6b7280').text('NEXUMO', 350, 55, { width: 197, align: 'right' });


      doc.font('Helvetica-Bold').fontSize(22).fillColor(dark).text('Factura', 48, 48);


      y = 108;
      doc.font('Helvetica').fontSize(10).fillColor(gray);
      doc.text('Número de factura: ', 48, y, { continued: true, lineBreak: false });
      doc.fillColor(dark).text(invoiceNo);
      y += 18;
      doc.fillColor(gray).text('Fecha de emisión: ' + date, 48, y);
      y += 16;
      doc.text('Fecha de vencimiento: ' + date, 48, y);


      y += 30;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(dark);
      doc.text('NEXUMO', 48, y);
      doc.text('Facturar a', 300, y);
      doc.font('Helvetica').fontSize(9.5).fillColor(gray);
      doc.text('España', 48, y + 14);
      doc.text(billTo || '', 300, y + 14);


      y += 44;
      doc.font('Helvetica-Bold').fontSize(26).fillColor(dark).text(fmt(total), 48, y);
      y += 34;
      doc.font('Helvetica').fontSize(10).fillColor(dark);
      doc.text('Método de pago: ', 48, y, { continued: true, lineBreak: false });
      doc.font('Helvetica-Bold').text(paymentMethod || '');
      y += 18;
      doc.font('Helvetica').fontSize(9.5).fillColor(gray);
      doc.text('Soporte: ' + SUPPORT, 48, y);


      const colX = [48, 270, 340, 440];
      const colW = [190, 60, 80, 70];
      const align = ['left', 'center', 'right', 'right'];
      const headers = ['Descripción', 'Cant.', 'Precio unitario', 'Importe'];

      y += 34;
      const writeRow = (cells, yy, bold) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(dark);
        cells.forEach((c, i) => {
          doc.text(String(c), colX[i], yy, { width: colW[i], align: align[i] });
        });
      };


      doc.moveTo(48, y).lineTo(510, y).strokeColor(dark).lineWidth(1.4).stroke();
      writeRow(headers, y + 7, true);
      y += 28;
      doc.moveTo(48, y).lineTo(510, y).strokeColor(dark).lineWidth(0.6).stroke();

      items.forEach(it => {
        const qty = Number(it.qty) || 1;
        const up = Number(it.price) || 0;
        y += 20;
        writeRow([it.name, qty, fmt(up), fmt(up * qty)], y, false);
      });

      y += 22;
      doc.moveTo(48, y).lineTo(510, y).strokeColor(dark).lineWidth(0.6).stroke();


      const tx = 330, tw = 180;
      let ty = y + 16;
      doc.font('Helvetica').fontSize(10).fillColor(gray);
      doc.text('Subtotal', tx, ty, { width: tw, align: 'left' });
      doc.fillColor(dark).text(fmt(subtotal), tx, ty, { width: tw, align: 'right' });
      ty += 20;
      doc.fillColor(gray).text('IVA (21%)', tx, ty, { align: 'left' });
      doc.fillColor(dark).text(fmt(iva), tx, ty, { align: 'right' });
      ty += 20;
      if (descuento > 0.01) {
        doc.fillColor(gray).text('Descuento', tx, ty, { align: 'left' });
        doc.fillColor('#16a34a').text('- ' + fmt(descuento), tx, ty, { align: 'right' });
        ty += 20;
      }
      doc.moveTo(330, ty - 4).lineTo(510, ty - 4).strokeColor(dark).lineWidth(1.4).stroke();
      ty += 8;
      doc.font('Helvetica-Bold').fontSize(14).fillColor(dark);
      doc.text('TOTAL', tx, ty, { align: 'left' });
      doc.text(fmt(total), tx, ty, { align: 'right' });


      const fy = 755;
      doc.moveTo(48, fy).lineTo(510, fy).strokeColor('#e5e7eb').lineWidth(1).stroke();
      doc.font('Helvetica').fontSize(8.5).fillColor(gray);
      doc.text(`${invoiceNo} · ${fmt(total)} · ${SUPPORT}`, 48, fy + 10);

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
