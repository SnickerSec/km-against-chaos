"use client";

import { useState } from "react";

export default function StarRating({
  value,
  onChange,
  readonly,
  size = "text-base",
}: {
  value: number;
  onChange?: (rating: number) => void;
  readonly?: boolean;
  size?: string;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          className={`${size} ${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"} transition-transform`}
          title={readonly ? `${value.toFixed(1)} stars` : `Rate ${star} star${star > 1 ? "s" : ""}`}
        >
          <span
            className={
              (hover || value) >= star
                ? "text-yellow-400"
                : "text-gray-700"
            }
          >
            &#9733;
          </span>
        </button>
      ))}
    </div>
  );
}
