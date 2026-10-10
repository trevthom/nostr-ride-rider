// ════════════════════════════════════════════════════════════
//  RATING FORM — Stars + optional review, used by the rider (rating
//  the driver) and the driver (rating the rider). Under 5 stars needs
//  a short reason. Skip is always allowed.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { StarInput } from "./Rating.jsx";
import Button from "./Button.jsx";
import { inputCls } from "./Parts.jsx";

export default function RatingForm({ who, onSubmit, onSkip }) {
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState("");
  const needsReason = stars < 5 && !review.trim();
  return (
    <div>
      <h3 className="text-lg font-bold text-center mb-1">How was your {who}?</h3>
      <p className="text-neutral-500 text-sm text-center mb-3">Your rating helps keep the community safe.</p>
      <StarInput value={stars} onChange={setStars} />
      <textarea
        aria-label="Review"
        value={review}
        onChange={(e) => setReview(e.target.value)}
        placeholder={stars < 5 ? "What went wrong? (required)" : "Add a comment (optional)"}
        rows={2}
        className={`${inputCls} resize-none mt-3`}
      />
      {needsReason && <p className="text-amber-700 text-xs mt-1">Please add a short reason for ratings under 5 stars.</p>}
      <div className="mt-3 space-y-1">
        <Button onClick={() => onSubmit(stars, review.trim())} disabled={needsReason} size="md">Submit rating</Button>
        <Button variant="ghost" onClick={onSkip} size="md">Skip</Button>
      </div>
    </div>
  );
}
