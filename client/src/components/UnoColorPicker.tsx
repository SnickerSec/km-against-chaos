"use client";

import { UnoColor, UnoDeckTemplate } from "@/lib/store";

const COLORS: { color: UnoColor; bg: string; hover: string }[] = [
  { color: "red",    bg: "bg-red-600",    hover: "hover:bg-red-500" },
  { color: "blue",   bg: "bg-blue-600",   hover: "hover:bg-blue-500" },
  { color: "green",  bg: "bg-green-600",  hover: "hover:bg-green-500" },
  { color: "yellow", bg: "bg-yellow-500", hover: "hover:bg-yellow-400" },
];

export default function UnoColorPicker({
  template,
  onPick,
  onCancel,
}: {
  template: UnoDeckTemplate | null;
  onPick: (color: UnoColor) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onCancel}>
      <div className="bg-gray-900 rounded-2xl p-6 border border-gray-700 max-w-xs w-full" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-center text-white font-bold mb-4">Choose a Color</h3>
        <div className="grid grid-cols-2 gap-3">
          {COLORS.map(({ color, bg, hover }) => (
            <button
              key={color}
              onClick={() => onPick(color)}
              className={`${bg} ${hover} text-white font-bold py-4 rounded-xl transition-colors text-sm`}
            >
              {template?.colorNames?.[color] || color.charAt(0).toUpperCase() + color.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className="mt-3 w-full text-gray-400 hover:text-gray-300 text-xs py-2 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
