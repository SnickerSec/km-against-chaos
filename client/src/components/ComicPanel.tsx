"use client";

import React from "react";

/**
 * ComicPanel — Cyanide & Happiness style comic panel generator.
 * Procedurally generates SVG scenes with expressive stick figures,
 * props, scene elements, and visual effects based on card text/ID.
 */

// ── Seeded random ──

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

function pick<T>(arr: T[], seed: number, index: number): T {
  return arr[Math.floor(seededRandom(seed, index) * arr.length)];
}

// ── Style constants ──

const SHIRT_COLORS = [
  "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6",
  "#1abc9c", "#e67e22", "#e91e63", "#00bcd4", "#ff5722",
];
const SKIN = "#fdd9b5";
const HAIR_COLORS = ["#2c1810", "#8b4513", "#daa520", "#d2691e", "#1a1a1a", "#c0392b", "#e8e8e8"];

// ── Text analysis for context-aware scenes ──

interface TextCues {
  emotion: "neutral" | "happy" | "angry" | "shocked" | "sad" | "dead" | "love" | "drunk" | "scared";
  hasAction: boolean;
  actionType: string | null;
  prop: string | null;
  scene: string | null;
}

function analyzeText(text: string): TextCues {
  const t = (text || "").toLowerCase();
  const cues: TextCues = { emotion: "neutral", hasAction: false, actionType: null, prop: null, scene: null };

  // Emotions
  if (/\bdead\b|\bdied\b|\bkill|\bmurder|\bfuneral|\bcorpse/.test(t)) cues.emotion = "dead";
  else if (/\blove\b|\bheart|\bmarr|\bkiss|\bdate\b|\bsexy/.test(t)) cues.emotion = "love";
  else if (/\bdrunk|\bbeer|\bwine|\bwhiskey|\bvodka|\bbar\b|\bdrink/.test(t)) cues.emotion = "drunk";
  else if (/\bangry|\bhate|\bfight|\bpunch|\bkick|\bslap|\bdamn|\bfuck|\bshit|\bass\b/.test(t)) cues.emotion = "angry";
  else if (/\boh god\b|\bwhat\b|\bholy|\bwtf|\bno!|\bwhy\b|\bshock|\bscream/.test(t)) cues.emotion = "shocked";
  else if (/\bcry|\bsad\b|\bdepress|\blonely|\bsorry|\bmiss you/.test(t)) cues.emotion = "sad";
  else if (/\bscare|\bhelp\b|\brun\b|\bmonster|\bghost|\bspider|\bahhh/.test(t)) cues.emotion = "scared";
  else if (/\bhaha|\blol|\bfunn|\bparty|\byay|\bwoo|\bnice|\bgreat/.test(t)) cues.emotion = "happy";

  // Stage directions in brackets
  const bracketMatch = t.match(/\[([^\]]+)\]/);
  if (bracketMatch) {
    const dir = bracketMatch[1];
    if (/cry/.test(dir)) cues.emotion = "sad";
    if (/dead|dies/.test(dir)) cues.emotion = "dead";
    if (/fire|burning/.test(dir)) { cues.hasAction = true; cues.actionType = "fire"; }
    if (/point/.test(dir)) { cues.hasAction = true; cues.actionType = "pointing"; }
    if (/danc/.test(dir)) { cues.hasAction = true; cues.actionType = "dancing"; }
    if (/fight|punch|hit/.test(dir)) { cues.hasAction = true; cues.actionType = "fighting"; }
    if (/vomit|puk/.test(dir)) { cues.hasAction = true; cues.actionType = "vomiting"; }
    if (/explo/.test(dir)) { cues.hasAction = true; cues.actionType = "explosion"; }
  }

  // Props
  if (/\bgun\b|\bshoot|\bpistol|\brifle/.test(t)) cues.prop = "gun";
  else if (/\bknife|\bstab|\bsword/.test(t)) cues.prop = "knife";
  else if (/\bbeer|\bdrink|\bwine|\bbottle|\bwhiskey/.test(t)) cues.prop = "drink";
  else if (/\bphone|\bcall|\btext/.test(t)) cues.prop = "phone";
  else if (/\bmoney|\bcash|\bdollar|\brich/.test(t)) cues.prop = "money";
  else if (/\bfire\b|\bburn/.test(t)) { cues.hasAction = true; cues.actionType = "fire"; }

  // Scenes
  if (/\bbar\b|\bpub\b|\bdrink/.test(t)) cues.scene = "bar";
  else if (/\bhospital|\bdoctor|\bnurse/.test(t)) cues.scene = "hospital";
  else if (/\bgrave|\bdead\b|\bfuneral|\bcemetery/.test(t)) cues.scene = "graveyard";
  else if (/\boffice|\bwork\b|\bboss\b|\bmeeting/.test(t)) cues.scene = "office";
  else if (/\bbed\b|\bsleep|\bnight/.test(t)) cues.scene = "bedroom";

  return cues;
}

// ── Character component ──

interface CharacterProps {
  x: number;
  y: number;
  shirtColor: string;
  hairColor: string;
  hairStyle: number;
  pose: number;
  facing: "left" | "right";
  speaking: boolean;
  emotion: TextCues["emotion"];
  prop: string | null;
  scale?: number;
}

function Character({ x, y, shirtColor, hairColor, hairStyle, pose, facing, speaking, emotion, prop, scale = 1 }: CharacterProps) {
  const flip = facing === "left" ? -1 : 1;
  const tx = facing === "left" ? x + 30 * scale : x;

  const headY = y;
  const bodyTop = y + 18 * scale;
  const bodyBottom = y + 48 * scale;
  const legSpread = 10 * scale;
  const headR = 12 * scale;

  // Arm variations
  const armW = 3 * scale;
  const arms: Record<number, React.ReactNode> = {
    0: ( // Arms at sides
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-14 * flip * scale} y2={bodyBottom - 5} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={14 * flip * scale} y2={bodyBottom - 5} stroke="black" strokeWidth={armW} strokeLinecap="round" />
      </g>
    ),
    1: ( // One arm raised
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-15 * flip * scale} y2={bodyTop - 10 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={14 * flip * scale} y2={bodyBottom - 5} stroke="black" strokeWidth={armW} strokeLinecap="round" />
      </g>
    ),
    2: ( // Both arms up (celebration/shock)
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-14 * flip * scale} y2={bodyTop - 14 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={14 * flip * scale} y2={bodyTop - 14 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
      </g>
    ),
    3: ( // Arms on hips (confident/angry)
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-16 * flip * scale} y2={bodyTop + 18 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={-16 * flip * scale} y1={bodyTop + 18 * scale} x2={-8 * flip * scale} y2={bodyBottom - 2} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={16 * flip * scale} y2={bodyTop + 18 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={16 * flip * scale} y1={bodyTop + 18 * scale} x2={8 * flip * scale} y2={bodyBottom - 2} stroke="black" strokeWidth={armW} strokeLinecap="round" />
      </g>
    ),
    4: ( // Pointing
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-24 * flip * scale} y2={bodyTop - 2 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={14 * flip * scale} y2={bodyBottom - 5} stroke="black" strokeWidth={armW} strokeLinecap="round" />
      </g>
    ),
    5: ( // Arms crossed
      <g>
        <line x1={0} y1={bodyTop + 8 * scale} x2={-12 * flip * scale} y2={bodyTop + 16 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 8 * scale} x2={12 * flip * scale} y2={bodyTop + 16 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={-12 * flip * scale} y1={bodyTop + 16 * scale} x2={6 * flip * scale} y2={bodyTop + 14 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={12 * flip * scale} y1={bodyTop + 16 * scale} x2={-6 * flip * scale} y2={bodyTop + 14 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
      </g>
    ),
    6: ( // Shrugging
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-18 * flip * scale} y2={bodyTop - 5 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={-18 * flip * scale} y1={bodyTop - 5 * scale} x2={-20 * flip * scale} y2={bodyTop + 2 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={18 * flip * scale} y2={bodyTop - 5 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={18 * flip * scale} y1={bodyTop - 5 * scale} x2={20 * flip * scale} y2={bodyTop + 2 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
      </g>
    ),
    7: ( // One arm reaching out
      <g>
        <line x1={0} y1={bodyTop + 5} x2={-22 * flip * scale} y2={bodyTop + 8 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        <line x1={0} y1={bodyTop + 5} x2={10 * flip * scale} y2={bodyBottom - 8} stroke="black" strokeWidth={armW} strokeLinecap="round" />
      </g>
    ),
  };

  // Override pose based on emotion
  let effectivePose = pose % 8;
  if (emotion === "shocked") effectivePose = 2;
  else if (emotion === "angry") effectivePose = 3;
  else if (emotion === "dead") effectivePose = 0;

  // Face expressions — the key to C&H feel
  const sw = scale;
  const face = (() => {
    switch (emotion) {
      case "happy":
        return (
          <g>
            <circle cx={-4 * sw} cy={headY - 2 * sw} r={2 * sw} fill="black" />
            <circle cx={4 * sw} cy={headY - 2 * sw} r={2 * sw} fill="black" />
            <path d={`M ${-5 * sw} ${headY + 3 * sw} Q 0 ${headY + 10 * sw} ${5 * sw} ${headY + 3 * sw}`} fill="black" stroke="black" strokeWidth={sw} />
          </g>
        );
      case "angry":
        return (
          <g>
            {/* Angry eyebrows */}
            <line x1={-6 * sw} y1={headY - 6 * sw} x2={-2 * sw} y2={headY - 4 * sw} stroke="black" strokeWidth={2 * sw} strokeLinecap="round" />
            <line x1={6 * sw} y1={headY - 6 * sw} x2={2 * sw} y2={headY - 4 * sw} stroke="black" strokeWidth={2 * sw} strokeLinecap="round" />
            <circle cx={-4 * sw} cy={headY - 2 * sw} r={1.8 * sw} fill="black" />
            <circle cx={4 * sw} cy={headY - 2 * sw} r={1.8 * sw} fill="black" />
            <path d={`M ${-5 * sw} ${headY + 6 * sw} Q 0 ${headY + 2 * sw} ${5 * sw} ${headY + 6 * sw}`} fill="none" stroke="black" strokeWidth={1.5 * sw} />
          </g>
        );
      case "shocked":
        return (
          <g>
            {/* Wide eyes */}
            <circle cx={-4 * sw} cy={headY - 2 * sw} r={3 * sw} fill="white" stroke="black" strokeWidth={1.5 * sw} />
            <circle cx={-4 * sw} cy={headY - 2 * sw} r={1.5 * sw} fill="black" />
            <circle cx={4 * sw} cy={headY - 2 * sw} r={3 * sw} fill="white" stroke="black" strokeWidth={1.5 * sw} />
            <circle cx={4 * sw} cy={headY - 2 * sw} r={1.5 * sw} fill="black" />
            {/* O mouth */}
            <ellipse cx={0} cy={headY + 5 * sw} rx={3 * sw} ry={4 * sw} fill="black" />
          </g>
        );
      case "sad":
        return (
          <g>
            <circle cx={-4 * sw} cy={headY - 2 * sw} r={1.8 * sw} fill="black" />
            <circle cx={4 * sw} cy={headY - 2 * sw} r={1.8 * sw} fill="black" />
            <path d={`M ${-5 * sw} ${headY + 7 * sw} Q 0 ${headY + 3 * sw} ${5 * sw} ${headY + 7 * sw}`} fill="none" stroke="black" strokeWidth={1.5 * sw} />
            {/* Tears */}
            <ellipse cx={-6 * sw} cy={headY + 2 * sw} rx={1 * sw} ry={2 * sw} fill="#5dade2" opacity="0.8" />
            <ellipse cx={6 * sw} cy={headY + 2 * sw} rx={1 * sw} ry={2 * sw} fill="#5dade2" opacity="0.8" />
          </g>
        );
      case "dead":
        return (
          <g>
            {/* X eyes */}
            <line x1={-6 * sw} y1={headY - 4 * sw} x2={-2 * sw} y2={headY} stroke="black" strokeWidth={2 * sw} strokeLinecap="round" />
            <line x1={-2 * sw} y1={headY - 4 * sw} x2={-6 * sw} y2={headY} stroke="black" strokeWidth={2 * sw} strokeLinecap="round" />
            <line x1={2 * sw} y1={headY - 4 * sw} x2={6 * sw} y2={headY} stroke="black" strokeWidth={2 * sw} strokeLinecap="round" />
            <line x1={6 * sw} y1={headY - 4 * sw} x2={2 * sw} y2={headY} stroke="black" strokeWidth={2 * sw} strokeLinecap="round" />
            {/* Tongue out */}
            <path d={`M ${-2 * sw} ${headY + 5 * sw} L ${2 * sw} ${headY + 5 * sw} L ${1 * sw} ${headY + 9 * sw} Q 0 ${headY + 10 * sw} ${-1 * sw} ${headY + 9 * sw} Z`} fill="#e74c3c" stroke="black" strokeWidth={sw} />
          </g>
        );
      case "love":
        return (
          <g>
            {/* Heart eyes */}
            <path d={`M ${-6 * sw} ${headY - 3 * sw} C ${-6 * sw} ${headY - 6 * sw} ${-2 * sw} ${headY - 6 * sw} ${-4 * sw} ${headY - 1 * sw} C ${-6 * sw} ${headY - 6 * sw} ${-2 * sw} ${headY - 6 * sw} ${-2 * sw} ${headY - 3 * sw} Z`} fill="#e74c3c" />
            <path d={`M ${2 * sw} ${headY - 3 * sw} C ${2 * sw} ${headY - 6 * sw} ${6 * sw} ${headY - 6 * sw} ${4 * sw} ${headY - 1 * sw} C ${2 * sw} ${headY - 6 * sw} ${6 * sw} ${headY - 6 * sw} ${6 * sw} ${headY - 3 * sw} Z`} fill="#e74c3c" />
            <path d={`M ${-5 * sw} ${headY + 3 * sw} Q 0 ${headY + 10 * sw} ${5 * sw} ${headY + 3 * sw}`} fill="black" stroke="black" strokeWidth={sw} />
          </g>
        );
      case "drunk":
        return (
          <g>
            {/* Squiggly eyes */}
            <path d={`M ${-6 * sw} ${headY - 2 * sw} Q ${-4 * sw} ${headY - 4 * sw} ${-2 * sw} ${headY - 2 * sw}`} fill="none" stroke="black" strokeWidth={2 * sw} />
            <path d={`M ${2 * sw} ${headY - 2 * sw} Q ${4 * sw} ${headY - 4 * sw} ${6 * sw} ${headY - 2 * sw}`} fill="none" stroke="black" strokeWidth={2 * sw} />
            {/* Wobbly smile */}
            <path d={`M ${-5 * sw} ${headY + 4 * sw} Q ${-2 * sw} ${headY + 8 * sw} 0 ${headY + 5 * sw} Q ${2 * sw} ${headY + 8 * sw} ${5 * sw} ${headY + 4 * sw}`} fill="none" stroke="black" strokeWidth={1.5 * sw} />
            {/* Blush */}
            <ellipse cx={-7 * sw} cy={headY + 2 * sw} rx={2.5 * sw} ry={1.5 * sw} fill="#e74c3c" opacity="0.3" />
            <ellipse cx={7 * sw} cy={headY + 2 * sw} rx={2.5 * sw} ry={1.5 * sw} fill="#e74c3c" opacity="0.3" />
          </g>
        );
      case "scared":
        return (
          <g>
            {/* Wide worried eyes */}
            <circle cx={-4 * sw} cy={headY - 2 * sw} r={2.5 * sw} fill="white" stroke="black" strokeWidth={1.5 * sw} />
            <circle cx={-4 * sw} cy={headY - 1 * sw} r={1.2 * sw} fill="black" />
            <circle cx={4 * sw} cy={headY - 2 * sw} r={2.5 * sw} fill="white" stroke="black" strokeWidth={1.5 * sw} />
            <circle cx={4 * sw} cy={headY - 1 * sw} r={1.2 * sw} fill="black" />
            {/* Wavy mouth */}
            <path d={`M ${-4 * sw} ${headY + 5 * sw} Q ${-2 * sw} ${headY + 7 * sw} 0 ${headY + 5 * sw} Q ${2 * sw} ${headY + 3 * sw} ${4 * sw} ${headY + 5 * sw}`} fill="none" stroke="black" strokeWidth={1.5 * sw} />
            {/* Sweat drop */}
            <ellipse cx={-8 * sw} cy={headY - 6 * sw} rx={1.5 * sw} ry={2.5 * sw} fill="#5dade2" opacity="0.7" />
          </g>
        );
      default: // neutral or speaking
        return (
          <g>
            <circle cx={-4 * sw} cy={headY - 2 * sw} r={1.8 * sw} fill="black" />
            <circle cx={4 * sw} cy={headY - 2 * sw} r={1.8 * sw} fill="black" />
            {speaking ? (
              <ellipse cx={0} cy={headY + 5 * sw} rx={3 * sw} ry={3 * sw} fill="black" />
            ) : (
              <line x1={-3 * sw} y1={headY + 5 * sw} x2={3 * sw} y2={headY + 5 * sw} stroke="black" strokeWidth={1.5 * sw} strokeLinecap="round" />
            )}
          </g>
        );
    }
  })();

  // Hair styles
  const hair = (() => {
    const hy = headY - headR;
    switch (hairStyle % 6) {
      case 0: return null; // bald
      case 1: // short flat
        return <rect x={-headR * 0.8} y={hy - 2 * sw} width={headR * 1.6} height={5 * sw} rx={2} fill={hairColor} />;
      case 2: // spiky
        return (
          <g>
            {[-8, -4, 0, 4, 8].map((dx, i) => (
              <line key={i} x1={dx * sw} y1={hy + 2 * sw} x2={dx * sw + (i % 2 ? 2 : -2) * sw} y2={hy - 5 * sw} stroke={hairColor} strokeWidth={2.5 * sw} strokeLinecap="round" />
            ))}
          </g>
        );
      case 3: // side part
        return (
          <g>
            <path d={`M ${-headR * 0.9} ${hy + 4 * sw} Q ${-headR * 0.5} ${hy - 3 * sw} ${headR * 0.3} ${hy + 1 * sw} L ${headR * 0.9} ${hy + 4 * sw}`} fill={hairColor} stroke="none" />
          </g>
        );
      case 4: // long hair (female-ish)
        return (
          <g>
            <path d={`M ${-headR} ${headY - 2 * sw} Q ${-headR - 4 * sw} ${headY + 5 * sw} ${-headR - 2 * sw} ${bodyTop + 5 * sw}`} fill="none" stroke={hairColor} strokeWidth={3 * sw} strokeLinecap="round" />
            <path d={`M ${headR} ${headY - 2 * sw} Q ${headR + 4 * sw} ${headY + 5 * sw} ${headR + 2 * sw} ${bodyTop + 5 * sw}`} fill="none" stroke={hairColor} strokeWidth={3 * sw} strokeLinecap="round" />
            <path d={`M ${-headR * 0.8} ${hy} Q 0 ${hy - 4 * sw} ${headR * 0.8} ${hy}`} fill={hairColor} stroke="none" />
          </g>
        );
      case 5: // hat
        return (
          <g>
            <rect x={-headR * 1.2} y={hy - 1 * sw} width={headR * 2.4} height={3 * sw} fill={hairColor} rx={1} />
            <rect x={-headR * 0.7} y={hy - 9 * sw} width={headR * 1.4} height={9 * sw} fill={hairColor} rx={2} />
          </g>
        );
      default: return null;
    }
  })();

  // Props
  const propElement = (() => {
    if (!prop) return null;
    const px = -20 * flip * scale;
    const py = bodyTop + 10 * scale;
    switch (prop) {
      case "gun":
        return (
          <g>
            <rect x={px} y={py - 2 * sw} width={14 * sw} height={4 * sw} rx={1} fill="#555" stroke="black" strokeWidth={sw} />
            <rect x={px + 2 * sw} y={py + 2 * sw} width={4 * sw} height={6 * sw} rx={1} fill="#555" stroke="black" strokeWidth={sw} />
          </g>
        );
      case "knife":
        return (
          <g>
            <rect x={px} y={py - 1 * sw} width={16 * sw} height={2 * sw} fill="#ccc" stroke="black" strokeWidth={0.5 * sw} />
            <rect x={px - 3 * sw} y={py - 3 * sw} width={4 * sw} height={6 * sw} rx={1} fill="#8b4513" stroke="black" strokeWidth={0.5 * sw} />
          </g>
        );
      case "drink":
        return (
          <g>
            <rect x={px} y={py - 4 * sw} width={6 * sw} height={10 * sw} rx={1} fill="none" stroke="black" strokeWidth={1.5 * sw} />
            <rect x={px + 1 * sw} y={py - 1 * sw} width={4 * sw} height={6 * sw} fill="#f39c12" opacity="0.6" />
          </g>
        );
      case "phone":
        return (
          <g>
            <rect x={px} y={py - 5 * sw} width={5 * sw} height={9 * sw} rx={1} fill="#333" stroke="black" strokeWidth={sw} />
            <rect x={px + 0.5 * sw} y={py - 4 * sw} width={4 * sw} height={5 * sw} fill="#5dade2" />
          </g>
        );
      case "money":
        return (
          <g>
            <rect x={px} y={py - 3 * sw} width={10 * sw} height={6 * sw} rx={1} fill="#27ae60" stroke="#1e8449" strokeWidth={sw} />
            <text x={px + 5 * sw} y={py + 2 * sw} textAnchor="middle" fontSize={6 * sw} fill="white" fontWeight="bold">$</text>
          </g>
        );
      default: return null;
    }
  })();

  // Dead character lies flat
  if (emotion === "dead") {
    return (
      <g transform={`translate(${tx}, 0) scale(${flip}, 1)`}>
        <g transform={`translate(0, ${bodyBottom + 10 * scale}) rotate(-90)`}>
          <line x1={0} y1={0} x2={0} y2={30 * scale} stroke={shirtColor} strokeWidth={8 * scale} strokeLinecap="round" />
          <circle cx={0} cy={-5 * scale} r={headR} fill={SKIN} stroke="black" strokeWidth={2.5 * scale} />
          {face}
          <line x1={0} y1={30 * scale} x2={-legSpread} y2={50 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
          <line x1={0} y1={30 * scale} x2={legSpread} y2={50 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
        </g>
      </g>
    );
  }

  return (
    <g transform={`translate(${tx}, 0) scale(${flip}, 1)`}>
      {/* Legs */}
      <line x1={0} y1={bodyBottom} x2={-legSpread} y2={bodyBottom + 22 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />
      <line x1={0} y1={bodyBottom} x2={legSpread} y2={bodyBottom + 22 * scale} stroke="black" strokeWidth={armW} strokeLinecap="round" />

      {/* Body (shirt) */}
      <line x1={0} y1={bodyTop} x2={0} y2={bodyBottom} stroke={shirtColor} strokeWidth={8 * scale} strokeLinecap="round" />
      <line x1={0} y1={bodyTop} x2={0} y2={bodyBottom} stroke="black" strokeWidth={8 * scale} strokeLinecap="round" strokeOpacity="0.12" />

      {/* Arms */}
      {arms[effectivePose] || arms[0]}

      {/* Prop (behind head) */}
      {propElement}

      {/* Head */}
      <circle cx={0} cy={headY} r={headR} fill={SKIN} stroke="black" strokeWidth={2.5 * scale} />

      {/* Hair */}
      {hair}

      {/* Face */}
      {face}
    </g>
  );
}

// ── Speech / thought bubbles ──

interface BubbleProps {
  x: number;
  y: number;
  text: string;
  maxWidth: number;
  tailX: number;
  tailY: number;
  thought?: boolean;
}

function Bubble({ x, y, text, maxWidth, tailX, tailY, thought = false }: BubbleProps) {
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
      <rect x={bx} y={by} width={textWidth} height={textHeight} rx={thought ? textHeight / 2 : 8} ry={thought ? textHeight / 2 : 8} fill="white" stroke="black" strokeWidth="2" />

      {thought ? (
        // Thought bubble dots
        <g>
          <circle cx={tailX} cy={by + textHeight + 6} r={3} fill="white" stroke="black" strokeWidth="1.5" />
          <circle cx={tailX + 2} cy={by + textHeight + 14} r={2} fill="white" stroke="black" strokeWidth="1.5" />
        </g>
      ) : (
        // Speech tail
        <g>
          <polygon
            points={`${tailX - 5},${by + textHeight} ${tailX + 5},${by + textHeight} ${tailX},${tailY}`}
            fill="white" stroke="black" strokeWidth="2" strokeLinejoin="round"
          />
          <line x1={tailX - 6} y1={by + textHeight - 1} x2={tailX + 6} y2={by + textHeight - 1} stroke="white" strokeWidth="3" />
        </g>
      )}

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

// ── Scene backgrounds ──

function SceneBackground({ scene }: { scene: string | null }) {
  if (!scene) return null;

  switch (scene) {
    case "bar":
      return (
        <g>
          <rect x={0} y={110} width={200} height={40} fill="#4a2c0a" opacity="0.3" />
          <line x1={0} y1={110} x2={200} y2={110} stroke="#3e2409" strokeWidth="3" opacity="0.4" />
          {/* Bottles on shelf */}
          <rect x={165} y={30} width={6} height={18} rx={1} fill="#27ae60" opacity="0.4" />
          <rect x={175} y={34} width={6} height={14} rx={1} fill="#e74c3c" opacity="0.4" />
          <rect x={185} y={32} width={6} height={16} rx={1} fill="#f39c12" opacity="0.4" />
          <line x1={160} y1={48} x2={200} y2={48} stroke="#8b4513" strokeWidth="2" opacity="0.3" />
        </g>
      );
    case "graveyard":
      return (
        <g>
          <line x1={0} y1={130} x2={200} y2={130} stroke="#555" strokeWidth="1" opacity="0.3" />
          {/* Gravestones */}
          <rect x={155} y={105} width={16} height={25} rx={5} ry={5} fill="#888" opacity="0.3" stroke="#666" strokeWidth="1" />
          <rect x={178} y={110} width={14} height={20} rx={4} ry={4} fill="#888" opacity="0.25" stroke="#666" strokeWidth="1" />
          <text x={163} y={122} textAnchor="middle" fontSize="6" fill="#666" opacity="0.5">RIP</text>
        </g>
      );
    case "hospital":
      return (
        <g>
          {/* Cross */}
          <rect x={175} y={10} width={4} height={16} fill="#e74c3c" opacity="0.3" />
          <rect x={171} y={14} width={12} height={4} fill="#e74c3c" opacity="0.3" />
          {/* Monitor line */}
          <rect x={160} y={50} width={30} height={22} rx={2} fill="#1a1a1a" opacity="0.15" stroke="#333" strokeWidth="1" strokeOpacity="0.2" />
          <polyline points="163,62 168,58 172,66 176,56 180,62 185,62" fill="none" stroke="#2ecc71" strokeWidth="1.5" opacity="0.3" />
        </g>
      );
    case "office":
      return (
        <g>
          {/* Desk */}
          <rect x={0} y={108} width={200} height={4} fill="#8b6914" opacity="0.3" />
          <rect x={10} y={112} width={4} height={28} fill="#8b6914" opacity="0.25" />
          <rect x={186} y={112} width={4} height={28} fill="#8b6914" opacity="0.25" />
        </g>
      );
    case "bedroom":
      return (
        <g>
          {/* Window/moon */}
          <rect x={160} y={10} width={25} height={25} rx={2} fill="#1a237e" opacity="0.2" stroke="#555" strokeWidth="1" strokeOpacity="0.3" />
          <circle cx={172} cy={20} r={5} fill="#f9e79f" opacity="0.4" />
        </g>
      );
    default:
      return null;
  }
}

// ── Visual effects ──

function Effects({ actionType, x, y }: { actionType: string | null; x: number; y: number }) {
  if (!actionType) return null;

  switch (actionType) {
    case "fire":
      return (
        <g>
          {[0, 8, -6, 14, -12].map((dx, i) => (
            <ellipse key={i} cx={x + dx} cy={y - 10 - i * 4} rx={4 + i} ry={6 + i * 2} fill={i % 2 ? "#e74c3c" : "#f39c12"} opacity={0.5 - i * 0.08} />
          ))}
        </g>
      );
    case "explosion":
      return (
        <g>
          {[0, 60, 120, 180, 240, 300].map((angle, i) => {
            const rad = (angle * Math.PI) / 180;
            return <line key={i} x1={x} y1={y} x2={x + Math.cos(rad) * 20} y2={y + Math.sin(rad) * 20} stroke="#f39c12" strokeWidth="2" opacity="0.5" />;
          })}
          <circle cx={x} cy={y} r={8} fill="#f39c12" opacity="0.3" />
        </g>
      );
    case "vomiting":
      return (
        <g>
          {[0, 1, 2].map((i) => (
            <ellipse key={i} cx={x + 12 + i * 8} cy={y + 5 + i * 3} rx={3} ry={2} fill="#27ae60" opacity={0.5 - i * 0.1} />
          ))}
        </g>
      );
    default:
      return null;
  }
}

// ── Main ComicPanel component ──

interface ComicPanelProps {
  text?: string;
  cardId?: string;
  borderColor?: "black" | "red" | "green" | "purple" | "gray";
  label?: string;
  labelColor?: string;
  empty?: boolean;
  emptyText?: string;
  className?: string;
  imageUrl?: string;
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
  imageUrl,
}: ComicPanelProps) {
  const seed = hashSeed(cardId || text || "empty");
  const cues = analyzeText(text || "");

  // Character generation from seed
  const pose = Math.floor(seededRandom(seed, 0) * 8);
  const shirtIdx = Math.floor(seededRandom(seed, 1) * SHIRT_COLORS.length);
  const numChars = seededRandom(seed, 2) > 0.4 ? 2 : 1; // slightly favor 2 characters
  const facing = seededRandom(seed, 3) > 0.5 ? "right" as const : "left" as const;
  const pose2 = Math.floor(seededRandom(seed, 4) * 8);
  const shirtIdx2 = (shirtIdx + 3 + Math.floor(seededRandom(seed, 5) * 4)) % SHIRT_COLORS.length;
  const hairStyle1 = Math.floor(seededRandom(seed, 6) * 6);
  const hairStyle2 = Math.floor(seededRandom(seed, 7) * 6);
  const hairColor1 = pick(HAIR_COLORS, seed, 8);
  const hairColor2 = pick(HAIR_COLORS, seed, 9);
  const useThought = seededRandom(seed, 10) > 0.85; // 15% chance of thought bubble
  const isStageDirection = (text || "").startsWith("[") && (text || "").endsWith("]");

  // Second character emotion — vary it
  const emotion2: TextCues["emotion"] = cues.emotion === "angry" ? "scared"
    : cues.emotion === "love" ? "love"
    : cues.emotion === "dead" ? "shocked"
    : cues.emotion === "drunk" ? "happy"
    : "neutral";

  const borderStyles: Record<string, string> = {
    black: "border-gray-600",
    red: "border-red-500",
    green: "border-green-500",
    purple: "border-purple-500",
    gray: "border-gray-700 border-dashed",
  };

  if (empty) {
    return (
      <div className={`flex-1 bg-gray-900 border-2 ${borderStyles[borderColor]} rounded-xl p-3 ${className}`}>
        {label && (
          <p className={`text-xs font-semibold mb-1 uppercase tracking-wider ${labelColor}`}>{label}</p>
        )}
        <div className="aspect-[5/7] bg-gray-800/50 rounded-lg flex items-center justify-center">
          <p className="text-gray-600 text-sm italic">{emptyText}</p>
        </div>
      </div>
    );
  }

  const displayText = text || "";
  // For stage directions, show as narration text at bottom
  const showBubble = displayText && !isStageDirection;

  return (
    <div className={`flex-1 bg-gray-900 border-2 ${borderStyles[borderColor]} rounded-xl p-3 ${className}`}>
      {label && (
        <p className={`text-xs font-semibold mb-1 uppercase tracking-wider ${labelColor}`}>{label}</p>
      )}
      <div className="aspect-[5/7] bg-white rounded-lg overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={displayText} className="w-full h-full object-cover" loading="lazy" />
        ) : (
        <svg viewBox="0 0 150 210" className="w-full h-full">
          <rect width="150" height="210" fill="white" />

          {/* Scene background */}
          <SceneBackground scene={cues.scene} />

          {/* Ground line */}
          <line x1="0" y1="198" x2="150" y2="198" stroke="#ddd" strokeWidth="1" />

          {numChars === 1 ? (
            <>
              <Character
                x={75}
                y={120}
                shirtColor={SHIRT_COLORS[shirtIdx]}
                hairColor={hairColor1}
                hairStyle={hairStyle1}
                pose={pose}
                facing={facing}
                speaking={!!showBubble}
                emotion={cues.emotion}
                prop={cues.prop}
              />
              {showBubble && (
                <Bubble
                  x={75}
                  y={40}
                  text={displayText}
                  maxWidth={130}
                  tailX={75}
                  tailY={100}
                  thought={useThought}
                />
              )}
              <Effects actionType={cues.actionType} x={75} y={120} />
            </>
          ) : (
            <>
              <Character
                x={38}
                y={125}
                shirtColor={SHIRT_COLORS[shirtIdx]}
                hairColor={hairColor1}
                hairStyle={hairStyle1}
                pose={pose}
                facing="right"
                speaking={!!showBubble}
                emotion={cues.emotion}
                prop={cues.prop}
              />
              <Character
                x={112}
                y={125}
                shirtColor={SHIRT_COLORS[shirtIdx2]}
                hairColor={hairColor2}
                hairStyle={hairStyle2}
                pose={pose2}
                facing="left"
                speaking={false}
                emotion={emotion2}
                prop={null}
              />
              {showBubble && (
                <Bubble
                  x={65}
                  y={40}
                  text={displayText}
                  maxWidth={120}
                  tailX={50}
                  tailY={105}
                  thought={useThought}
                />
              )}
              <Effects actionType={cues.actionType} x={38} y={125} />
            </>
          )}

          {/* Stage direction as narration box */}
          {isStageDirection && (
            <g>
              <rect x={10} y={8} width={130} height={22} rx={3} fill="#ffeaa7" stroke="#f39c12" strokeWidth="1" opacity="0.9" />
              <text x={75} y={23} textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="10" fontStyle="italic" fill="#333">
                {displayText.slice(1, -1)}
              </text>
            </g>
          )}

          {/* Panel border */}
          <rect width="150" height="210" fill="none" stroke="black" strokeWidth="3" />
        </svg>
        )}
      </div>
    </div>
  );
}
