import { describe, expect, it } from "vitest";
import { classifyMonth, monthMarks, monthlyAverages } from "../src/logic/weather";
import { monthRanges } from "../src/logic/months";
import { viewRatings } from "../src/logic/ratings";
import { budgetCheck } from "../src/logic/budget";

describe("classifyMonth", () => {
  it.each([
    [{ min: 16, max: 30 }, "good"],
    [{ min: 22, max: 28 }, "good"],
    [{ min: 15.9, max: 30 }, "borderline"],
    [{ min: 16, max: 30.1 }, "borderline"],
    [{ min: 14, max: 32 }, "borderline"],
    [{ min: 13.9, max: 25 }, "poor"],
    [{ min: 20, max: 32.1 }, "poor"],
    [null, "unknown"],
    [{ min: Number.NaN, max: 20 }, "unknown"],
  ] as const)("%j → %s", (t, mark) => {
    expect(classifyMonth(t as never)).toBe(mark);
  });
});

describe("monthMarks", () => {
  it("uses sighting months for wildlife ideas", () => {
    const marks = monthMarks({ season_basis: "wildlife", climate: null, wildlife_months: [7, 8, 9] });
    expect(marks[6]).toBe("good");
    expect(marks[0]).toBe("poor");
  });
  it("is unknown everywhere without climate data", () => {
    expect(new Set(monthMarks({ season_basis: "weather", climate: null, wildlife_months: null }))).toEqual(
      new Set(["unknown"]),
    );
  });
});

describe("monthlyAverages", () => {
  it("averages per calendar month and skips nulls", () => {
    const avg = monthlyAverages(
      ["2024-01-01", "2024-01-02", "2025-01-01", "2024-02-01"],
      [10, 12, null, 5],
      [20, 22, 30, 15],
    );
    expect(avg[0]).toEqual({ min: 11, max: 21 });
    expect(avg[1]).toEqual({ min: 5, max: 15 });
    expect(avg[2]).toBeNull();
  });
});

describe("monthRanges", () => {
  it.each([
    [[4, 5, 6, 7, 8, 9, 10, 11], "Apr–Nov"],
    [[11, 12, 1, 2, 3], "Nov–Mar"],
    [[4, 11], "Apr, Nov"],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "all year"],
    [[], ""],
  ])("%j → %s", (months, text) => {
    expect(monthRanges(months)).toBe(text);
  });
});

describe("viewRatings", () => {
  it("hides the other rating until I rate", () => {
    expect(viewRatings({ b: 5 }, "a", "b")).toEqual({ mine: null, other: null, otherHidden: true });
  });
  it("reveals the other rating once I rated", () => {
    expect(viewRatings({ a: 3, b: 5 }, "a", "b")).toEqual({ mine: 3, other: 5, otherHidden: false });
  });
  it("is not hidden when nobody rated", () => {
    expect(viewRatings({}, "a", "b")).toEqual({ mine: null, other: null, otherHidden: false });
  });
});

describe("budgetCheck", () => {
  const loved = { a: 5, b: 4 };
  it("uses per-country medians of ideas both rated ≥ 4", () => {
    const r = budgetCheck(
      [
        { country_iso: "CHE", cost_pp_day: 180, stars: loved },
        { country_iso: "CHE", cost_pp_day: 170, stars: loved },
        { country_iso: "IDN", cost_pp_day: 45, stars: { a: 5, b: 5 } },
        { country_iso: "JPN", cost_pp_day: 300, stars: { a: 5, b: 3 } },
        { country_iso: "PRT", cost_pp_day: null, stars: loved },
      ],
      ["a", "b"],
      50000,
      5000,
    );
    // CHE median 175, IDN 45 → mean 110 → ×2 = 220/day; 45000 / (220 × 30.4) = 6.73
    expect(r).toEqual({ qualifying: 4, dailyForTwo: 220, months: 6.7, budget: 50000, flightReserve: 5000 });
  });
  it("returns nulls when nothing qualifies", () => {
    expect(budgetCheck([], ["a", "b"], 50000, 5000)).toEqual({
      qualifying: 0,
      dailyForTwo: null,
      months: null,
      budget: 50000,
      flightReserve: 5000,
    });
  });
  it("returns null months when the daily cost is zero", () => {
    const r = budgetCheck([{ country_iso: "XXX", cost_pp_day: 0, stars: loved }], ["a", "b"], 50000, 5000);
    expect(r.months).toBeNull();
  });
});
