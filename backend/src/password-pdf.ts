import PDFDocument from 'pdfkit';

export const PASSWORDS_PER_PAGE = 80;

export async function createPasswordPdf(input: {
  churchName: string;
  electionDate: string;
  batchNumber: number;
  voterUrl: string;
  codes: string[];
}) {
  const document = new PDFDocument({
    size: 'A4',
    margin: 0,
    compress: true,
    info: { Title: `Senhas de votação - lote ${input.batchNumber}` }
  });
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const columns = 4;
  const rows = 20;
  const cellWidth = pageWidth / columns;
  const cellHeight = pageHeight / rows;
  const fontSize = 18;

  function drawCutGuides() {
    document.save().lineWidth(0.35).strokeColor('#000000');
    for (let column = 1; column < columns; column += 1) {
      const x = column * cellWidth;
      document.moveTo(x, 0).lineTo(x, pageHeight).stroke();
    }
    for (let row = 1; row < rows; row += 1) {
      const y = row * cellHeight;
      document.moveTo(0, y).lineTo(pageWidth, y).stroke();
    }
    document.restore();
  }

  input.codes.forEach((code, index) => {
    if (index > 0 && index % PASSWORDS_PER_PAGE === 0) document.addPage({ size: 'A4', margin: 0 });
    if (index % PASSWORDS_PER_PAGE === 0) drawCutGuides();
    const withinPage = index % PASSWORDS_PER_PAGE;
    const column = withinPage % columns;
    const row = Math.floor(withinPage / columns);
    const x = column * cellWidth;
    const y = row * cellHeight;

    document
      .fillColor('#000000')
      .font('Helvetica-Bold')
      .fontSize(fontSize)
      .text(code, x, y + (cellHeight - fontSize) / 2 - 1.5, {
        width: cellWidth,
        align: 'center',
        characterSpacing: 0.8,
        lineBreak: false
      });
  });

  document.end();
  return done;
}
