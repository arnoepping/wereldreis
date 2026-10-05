export type RatingView = { mine: number | null; other: number | null; otherHidden: boolean };

export function viewRatings(stars: Record<string, number>, me: string, other: string): RatingView {
  const mine = stars[me] ?? null;
  const theirs = stars[other] ?? null;
  // Before you rate, reveal nothing about the other rating, not even whether it exists.
  if (mine === null) return { mine: null, other: null, otherHidden: true };
  return { mine, other: theirs, otherHidden: false };
}
