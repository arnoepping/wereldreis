export type RatingView = { mine: number | null; other: number | null; otherHidden: boolean };

export function viewRatings(stars: Record<string, number>, me: string, other: string): RatingView {
  const mine = stars[me] ?? null;
  const theirs = stars[other] ?? null;
  if (mine === null) return { mine: null, other: null, otherHidden: theirs !== null };
  return { mine, other: theirs, otherHidden: false };
}
