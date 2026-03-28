import type { CustomDeck } from "./api";

// Card dimensions in inches (standard poker size)
const CARD_W = 2.5;
const CARD_H = 3.5;
const PAGE_MARGIN = 0.25;
const GUTTER = 0.25;
const COLS = 3;
const ROWS = 3;
const CARDS_PER_PAGE = COLS * ROWS;
const CARD_PADDING = 0.15;
const CORNER_RADIUS = 0.12;

function cardPosition(index: number): { x: number; y: number } {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const x = PAGE_MARGIN + col * (CARD_W + GUTTER);
  const y = PAGE_MARGIN + row * (CARD_H + GUTTER);
  return { x, y };
}

function wrapText(doc: any, text: string, maxWidth: number, fontSize: number): string[] {
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(text, maxWidth) as string[];
}

function renderCard(
  doc: any,
  x: number,
  y: number,
  text: string,
  type: "chaos" | "knowledge",
  pick?: number
) {
  const isChaos = type === "chaos";
  const textArea = CARD_W - CARD_PADDING * 2;

  // Card background
  if (isChaos) {
    doc.setFillColor(20, 20, 20);
  } else {
    doc.setFillColor(255, 255, 255);
  }
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.02);
  doc.roundedRect(x, y, CARD_W, CARD_H, CORNER_RADIUS, CORNER_RADIUS, "FD");

  // Type label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  if (isChaos) {
    doc.setTextColor(200, 50, 50);
    doc.text("PROMPT", x + CARD_PADDING, y + 0.28);
  } else {
    doc.setTextColor(100, 60, 160);
    doc.text("ANSWER", x + CARD_PADDING, y + 0.28);
  }

  // Main text — try font sizes from large to small
  const mainColor = isChaos ? [255, 255, 255] : [20, 20, 20];
  doc.setTextColor(mainColor[0], mainColor[1], mainColor[2]);
  doc.setFont("helvetica", "bold");

  const maxTextHeight = CARD_H - 0.7; // space for label + pick indicator
  let lines: string[] = [];
  let fontSize = 11;

  for (const size of [11, 9, 7.5, 6]) {
    fontSize = size;
    lines = wrapText(doc, text, textArea, size);
    const lineHeight = size / 72 * 1.3;
    if (lines.length * lineHeight <= maxTextHeight) break;
  }

  const lineHeight = fontSize / 72 * 1.3;
  const totalTextHeight = lines.length * lineHeight;
  const startY = y + 0.45 + (maxTextHeight - totalTextHeight) / 2 + lineHeight;

  doc.setFontSize(fontSize);
  for (let i = 0; i < lines.length; i++) {
    doc.text(lines[i], x + CARD_PADDING, startY + i * lineHeight);
  }

  // Pick indicator for chaos cards
  if (isChaos && pick && pick > 1) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(200, 50, 50);
    doc.text(`PICK ${pick}`, x + CARD_PADDING, y + CARD_H - 0.15);
  }
}

function renderCoverPage(doc: any, deck: CustomDeck) {
  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(30, 30, 30);

  const titleLines = doc.splitTextToSize(deck.name, 6);
  doc.text(titleLines, 4.25, 2.5, { align: "center" });

  // Description
  if (deck.description) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    const descLines = doc.splitTextToSize(deck.description, 5.5);
    const descY = 2.5 + titleLines.length * 0.45 + 0.3;
    doc.text(descLines, 4.25, descY, { align: "center" });
  }

  // Card counts
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `${deck.chaosCards.length} prompt cards  ·  ${deck.knowledgeCards.length} answer cards`,
    4.25,
    6,
    { align: "center" }
  );

  // Instructions
  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text("Print on cardstock, cut along card edges.", 4.25, 9, { align: "center" });
  doc.text("Cards are standard poker size (2.5\" × 3.5\").", 4.25, 9.3, { align: "center" });
}

function renderPrintServicesPage(doc: any) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(30, 30, 30);
  doc.text("Order Printed Cards", 4.25, 2, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(80, 80, 80);
  doc.text("Want a professional print? Upload this PDF to one of these services:", 4.25, 2.6, { align: "center" });

  const services = [
    { name: "The Game Crafter", url: "thegamecrafter.com", desc: "Best for card games — poker-size cards with custom backs" },
    { name: "MakePlayingCards", url: "makeplayingcards.com", desc: "Affordable custom cards with many size and finish options" },
    { name: "PrinterStudio", url: "printerstudio.com", desc: "Custom playing cards with premium printing quality" },
  ];

  let y = 3.4;
  for (const svc of services) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(100, 50, 160);
    doc.text(svc.name, 1.5, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(svc.url, 1.5, y + 0.25);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(svc.desc, 1.5, y + 0.5);

    y += 1;
  }

  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  doc.text("Generated by Decked — decked.gg", 4.25, 9.5, { align: "center" });
}

function renderSectionHeader(doc: any, title: string) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(30, 30, 30);
  doc.text(title, 4.25, 5.5, { align: "center" });
}

export async function generateDeckPdf(deck: CustomDeck) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "in", format: "letter" });

  // Cover page
  renderCoverPage(doc, deck);

  // Prompt cards section
  if (deck.chaosCards.length > 0) {
    doc.addPage();
    renderSectionHeader(doc, "Prompt Cards");

    for (let i = 0; i < deck.chaosCards.length; i++) {
      if (i % CARDS_PER_PAGE === 0) {
        doc.addPage();
      }
      const pos = cardPosition(i % CARDS_PER_PAGE);
      const card = deck.chaosCards[i];
      renderCard(doc, pos.x, pos.y, card.text, "chaos", card.pick);
    }
  }

  // Answer cards section
  if (deck.knowledgeCards.length > 0) {
    doc.addPage();
    renderSectionHeader(doc, "Answer Cards");

    for (let i = 0; i < deck.knowledgeCards.length; i++) {
      if (i % CARDS_PER_PAGE === 0) {
        doc.addPage();
      }
      const pos = cardPosition(i % CARDS_PER_PAGE);
      renderCard(doc, pos.x, pos.y, deck.knowledgeCards[i].text, "knowledge");
    }
  }

  // Print services page
  doc.addPage();
  renderPrintServicesPage(doc);

  const safeName = deck.name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  doc.save(`${safeName}_printable.pdf`);
}
