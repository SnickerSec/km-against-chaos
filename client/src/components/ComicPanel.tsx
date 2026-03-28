"use client";

import React from "react";

/**
 * ComicPanel — Minimalist stick figure comic panel in the Cyanide & Happiness style.
 * Renders an SVG with 1-2 characters and a speech bubble containing card text.
 * Uses a deterministic seed (card ID) for consistent character poses/colors.
 */

// Simple hash to get deterministic random from card ID
function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRandom(seed: number, index: number): number {
  const x = Math.sin(seed + index) * 10000;
  return x - Math.floor(x);
}

// Character colors (C&H style — simple colored shirts)
const SHIRT_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c", "#e67e22", "#e91e63"];
const SKIN = "#fdd9b5";

interface CharacterProps {
  x: number;
  y: number;
  shirtColor: string;
  pose: number; // 0-4
  facing: "left" | "right";
  speaking: boolean;
}

function Character({ x, y, shirtColor, pose, facing, speaking }: CharacterProps) {
  const flip = facing === "left" ? -1 : 1;
  const tx = facing === "left" ? x + 30 : x;

  // All poses share: round head, stick body, stick legs
  const headY = y;
  const bodyTop = y + 18;
  const bodyBottom = y + 48;
  const legSpread = 10;

  // Arm variations by pose
  const arms: Record<number, React.ReactNode> = {
    0: ( // Arms at sides
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-14 * flip} y2={bodyBottom - 5} stroke="black" strokeWidth="3" strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={14 * flip} y2={bodyBottom - 5} stroke="black" strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
    1: ( // One arm raised
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-15 * flip} y2={bodyTop - 10} stroke="black" strokeWidth="3" strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={14 * flip} y2={bodyBottom - 5} stroke="black" strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
    2: ( // Both arms up
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-14 * flip} y2={bodyTop - 12} stroke="black" strokeWidth="3" strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={14 * flip} y2={bodyTop - 12} stroke="black" strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
    3: ( // Arms on hips
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-14 * flip} y2={bodyTop + 18} stroke="black" strokeWidth="3" strokeLinecap="round" />
        <line x1={-14 * flip} y1={bodyTop + 18} x2={-6 * flip} y2={bodyBottom - 2} stroke="black" strokeWidth="3" strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={14 * flip} y2={bodyTop + 18} stroke="black" strokeWidth="3" strokeLinecap="round" />
        <line x1={14 * flip} y1={bodyTop + 18} x2={6 * flip} y2={bodyBottom - 2} stroke="black" strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
    4: ( // Pointing
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-20 * flip} y2={bodyTop} stroke="black" strokeWidth="3" strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={14 * flip} y2={bodyBottom - 5} stroke="black" strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
  };

  // Mouth expression
  const mouths: Record<number, React.ReactNode> = {
    0: <line x1={-3} y1={headY + 5} x2={3} y2={headY + 5} stroke="black" strokeWidth="1.5" strokeLinecap="round" />, // neutral
    1: <path d={`M -3 ${headY + 4} Q 0 ${headY + 8} 3 ${headY + 4}`} fill="none" stroke="black" strokeWidth="1.5" />, // smile
    2: <ellipse cx={0} cy={headY + 5} rx={3} ry={3} fill="black" />, // open mouth (speaking/shocked)
    3: <path d={`M -3 ${headY + 7} Q 0 ${headY + 3} 3 ${headY + 7}`} fill="none" stroke="black" strokeWidth="1.5" />, // frown
    4: <line x1={-4} y1={headY + 5} x2={4} y2={headY + 5} stroke="black" strokeWidth="2" strokeLinecap="round" />, // flat
  };

  const mouthIndex = speaking ? 2 : pose % 5;

  return (
    <g transform={`translate(${tx}, 0) scale(${flip}, 1)`}>
      {/* Legs */}
      <line x1={0} y1={bodyBottom} x2={-legSpread} y2={bodyBottom + 22} stroke="black" strokeWidth="3" strokeLinecap="round" />
      <line x1={0} y1={bodyBottom} x2={legSpread} y2={bodyBottom + 22} stroke="black" strokeWidth="3" strokeLinecap="round" />

      {/* Body (shirt) */}
      <line x1={0} y1={bodyTop} x2={0} y2={bodyBottom} stroke={shirtColor} strokeWidth="8" strokeLinecap="round" />
      <line x1={0} y1={bodyTop} x2={0} y2={bodyBottom} stroke="black" strokeWidth="8" strokeLinecap="round" strokeOpacity="0.15" />

      {/* Arms */}
      {arms[pose] || arms[0]}

      {/* Head */}
      <circle cx={0} cy={headY} r={12} fill={SKIN} stroke="black" strokeWidth="2.5" />

      {/* Eyes */}
      <circle cx={-4} cy={headY - 2} r={1.8} fill="black" />
      <circle cx={4} cy={headY - 2} r={1.8} fill="black" />

      {/* Mouth */}
      {mouths[mouthIndex] || mouths[0]}
    </g>
  );
}

interface SpeechBubbleProps {
  x: number;
  y: number;
  text: string;
  maxWidth: number;
  tailX: number;
  tailY: number;
}

function SpeechBubble({ x, y, text, maxWidth, tailX, tailY }: SpeechBubbleProps) {
  // Estimate text wrapping
  const charWidth = 6.5;
  const lineHeight = 14;
  const padding = 10;
  const charsPerLine = Math.floor((maxWidth - padding * 2) / charWidth);
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if ((currentLine + " " + word).trim().length > charsPerLine && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + " " + word : word;
    }
  }
  if (currentLine) lines.push(currentLine);

  const textWidth = Math.min(maxWidth, Math.max(...lines.map((l) => l.length * charWidth)) + padding * 2);
  const textHeight = lines.length * lineHeight + padding * 2;

  const bx = x - textWidth / 2;
  const by = y - textHeight;

  return (
    <g>
      {/* Bubble */}
      <rect x={bx} y={by} width={textWidth} height={textHeight} rx={8} ry={8} fill="white" stroke="black" strokeWidth="2" />
      {/* Tail */}
      <polygon
        points={`${tailX - 5},${by + textHeight} ${tailX + 5},${by + textHeight} ${tailX},${tailY}`}
        fill="white"
        stroke="black"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* White cover for tail base */}
      <line x1={tailX - 6} y1={by + textHeight - 1} x2={tailX + 6} y2={by + textHeight - 1} stroke="white" strokeWidth="3" />

      {/* Text */}
      {lines.map((line, i) => (
        <text
          key={i}
          x={x}
          y={by + padding + 10 + i * lineHeight}
          textAnchor="middle"
          fontFamily="Arial, sans-serif"
          fontSize="11"
          fontWeight="600"
          fill="black"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

interface ComicPanelProps {
  text?: string;
  cardId?: string;
  borderColor?: "black" | "red" | "green" | "purple" | "gray";
  label?: string;
  labelColor?: string;
  empty?: boolean;
  emptyText?: string;
  className?: string;
}

export default function ComicPanel({
  text,
  cardId = "",
  borderColor = "black",
  label,
  labelColor = "text-gray-400",
  empty = false,
  emptyText = "...",
  className = "",
}: ComicPanelProps) {
  const seed = hashSeed(cardId || text || "empty");
  const pose = Math.floor(seededRandom(seed, 0) * 5);
  const shirtIdx = Math.floor(seededRandom(seed, 1) * SHIRT_COLORS.length);
  const numChars = seededRandom(seed, 2) > 0.5 ? 2 : 1;
  const facing = seededRandom(seed, 3) > 0.5 ? "right" as const : "left" as const;
  const pose2 = Math.floor(seededRandom(seed, 4) * 5);
  const shirtIdx2 = (shirtIdx + 3) % SHIRT_COLORS.length;

  const borderColors: Record<string, string> = {
    black: "border-gray-600",
    red: "border-red-500",
    green: "border-green-500",
    purple: "border-purple-500",
    gray: "border-gray-700 border-dashed",
  };

  if (empty) {
    return (
      <div className={`flex-1 bg-gray-900 border-2 ${borderColors[borderColor]} rounded-xl p-3 ${className}`}>
        {label && (
          <p className={`text-xs font-semibold mb-1 uppercase tracking-wider ${labelColor}`}>{label}</p>
        )}
        <div className="aspect-[4/3] bg-gray-800/50 rounded-lg flex items-center justify-center">
          <p className="text-gray-600 text-sm italic">{emptyText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 bg-gray-900 border-2 ${borderColors[borderColor]} rounded-xl p-3 ${className}`}>
      {label && (
        <p className={`text-xs font-semibold mb-1 uppercase tracking-wider ${labelColor}`}>{label}</p>
      )}
      <div className="aspect-[4/3] bg-white rounded-lg overflow-hidden">
        <svg viewBox="0 0 200 150" className="w-full h-full">
          {/* Background */}
          <rect width="200" height="150" fill="white" />

          {numChars === 1 ? (
            <>
              <Character
                x={100}
                y={75}
                shirtColor={SHIRT_COLORS[shirtIdx]}
                pose={pose}
                facing={facing}
                speaking={true}
              />
              <SpeechBubble
                x={100}
                y={65}
                text={text || ""}
                maxWidth={170}
                tailX={100}
                tailY={70}
              />
            </>
          ) : (
            <>
              <Character
                x={55}
                y={78}
                shirtColor={SHIRT_COLORS[shirtIdx]}
                pose={pose}
                facing="right"
                speaking={true}
              />
              <Character
                x={145}
                y={78}
                shirtColor={SHIRT_COLORS[shirtIdx2]}
                pose={pose2}
                facing="left"
                speaking={false}
              />
              <SpeechBubble
                x={90}
                y={65}
                text={text || ""}
                maxWidth={150}
                tailX={70}
                tailY={72}
              />
            </>
          )}

          {/* Panel border */}
          <rect width="200" height="150" fill="none" stroke="black" strokeWidth="3" />
        </svg>
      </div>
    </div>
  );
}
