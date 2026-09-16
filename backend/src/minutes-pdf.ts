import PDFDocument from 'pdfkit';

export interface MinutesWinner {
  name: string;
  roundNumber: number;
  votes: number;
}

export async function createMinutesPdf(input: {
  churchName: string;
  electionDate: string;
  presentMembers: number | null;
  elders: MinutesWinner[];
  deacons: MinutesWinner[];
}) {
  const document = new PDFDocument({
    size: 'A4',
    margins: { top: 48, right: 48, bottom: 48, left: 48 },
    compress: true,
    info: { Title: `Resultado da eleição de oficiais - ${input.churchName}` }
  });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  const pageWidth = document.page.width;
  const contentWidth = pageWidth - document.page.margins.left - document.page.margins.right;
  const green = '#003d25';
  const ink = '#17231d';
  const muted = '#5f6964';
  const line = '#cfd6d2';

  const formattedDate = new Date(`${input.electionDate.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric'
  });

  document.rect(0, 0, pageWidth, 9).fill(green);
  document.fillColor(green).font('Helvetica-Bold').fontSize(9).text('ELEIÇÃO DE OFICIAIS', { characterSpacing: 1.2 });
  document.moveDown(0.45).fillColor(ink).font('Helvetica-Bold').fontSize(18).text(input.churchName);
  document.moveDown(0.25).fillColor(muted).font('Helvetica').fontSize(9).text(formattedDate);
  document.moveDown(1.5).fillColor(muted).font('Helvetica-Bold').fontSize(9).text('RESULTADO FINAL', { characterSpacing: 1 });
  document.moveDown(0.35).fillColor(ink).font('Helvetica-Bold').fontSize(20).text('Oficiais eleitos');
  document.moveDown(1.1);

  function ensureSpace(height: number) {
    if (document.y + height <= document.page.height - document.page.margins.bottom) return;
    document.addPage();
    document.rect(0, 0, pageWidth, 6).fill(green);
    document.y = document.page.margins.top;
  }

  function drawGroup(title: string, winners: MinutesWinner[]) {
    const headerHeight = 28;
    const rowHeight = 32;
    ensureSpace(48 + headerHeight + Math.max(1, winners.length) * rowHeight);
    document.x = document.page.margins.left;
    document.fillColor(green).font('Helvetica-Bold').fontSize(13).text(title);
    document.moveDown(0.55);
    const startX = document.page.margins.left;
    const nameWidth = contentWidth - 190;
    const roundWidth = 92;
    const votesWidth = 98;
    let y = document.y;

    document.rect(startX, y, contentWidth, headerHeight).fill('#edf1ee');
    document.fillColor('#344139').font('Helvetica-Bold').fontSize(8);
    document.text('NOME', startX + 10, y + 10, { width: nameWidth - 20, lineBreak: false });
    document.text('ESCRUTÍNIO', startX + nameWidth, y + 10, { width: roundWidth, align: 'center', lineBreak: false });
    document.text('VOTOS', startX + nameWidth + roundWidth, y + 10, { width: votesWidth, align: 'center', lineBreak: false });
    y += headerHeight;

    if (winners.length === 0) {
      document.rect(startX, y, contentWidth, rowHeight).strokeColor(line).lineWidth(0.7).stroke();
      document.fillColor(muted).font('Helvetica').fontSize(9).text('Nenhum candidato eleito para este cargo.', startX + 10, y + 11, { width: contentWidth - 20 });
      y += rowHeight;
    } else {
      for (const winner of winners) {
        ensureSpace(rowHeight);
        document.rect(startX, y, contentWidth, rowHeight).strokeColor(line).lineWidth(0.7).stroke();
        document.fillColor(ink).font('Helvetica').fontSize(9.5).text(winner.name, startX + 10, y + 10, { width: nameWidth - 20, ellipsis: true, lineBreak: false });
        document.fillColor(ink).font('Helvetica').fontSize(9).text(`${winner.roundNumber}º escrutínio`, startX + nameWidth, y + 11, { width: roundWidth, align: 'center', lineBreak: false });
        document.text(String(winner.votes), startX + nameWidth + roundWidth, y + 11, { width: votesWidth, align: 'center', lineBreak: false });
        y += rowHeight;
      }
    }
    document.y = y + 22;
  }

  drawGroup('Presbíteros eleitos', input.elders);
  drawGroup('Diáconos eleitos', input.deacons);

  ensureSpace(44);
  document.roundedRect(document.page.margins.left, document.y, contentWidth, 36, 5).fill('#f4f6f4');
  document.fillColor(muted).font('Helvetica').fontSize(9).text(
    `Quórum registrado: ${input.presentMembers ?? '—'} membros presentes`,
    document.page.margins.left + 12,
    document.y + 13,
    { width: contentWidth - 24, lineBreak: false }
  );

  document.end();
  return done;
}
