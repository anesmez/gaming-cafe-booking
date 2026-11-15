/**
 * Station assignment. Customers choose how many stations, not which ones; the
 * system seats a group side by side whenever the floor allows it.
 */

export interface StationCandidate<Id> {
  id: Id;
  /** Position on the floor. Consecutive values are neighbours. */
  sortOrder: number;
  /** Free for the whole requested range. */
  free: boolean;
}

/**
 * Picks `count` stations, or returns null when fewer than `count` are free.
 *
 * Preference order:
 * 1. The smallest run of adjacent free stations that fits the group, so large
 *    runs stay available for larger groups.
 * 2. If no run fits, the free stations packed as closely as possible.
 *
 * `stations` must hold every station of the pool, free or not, so that a taken
 * station correctly breaks a run of neighbours.
 */
export function pickStations<Id>(stations: StationCandidate<Id>[], count: number): Id[] | null {
  if (count < 1) return null;

  const ordered = [...stations].sort((a, b) => a.sortOrder - b.sortOrder);
  const free = ordered.filter((s) => s.free);
  if (free.length < count) return null;

  // 1. Runs of free neighbours.
  const runs: StationCandidate<Id>[][] = [];
  let current: StationCandidate<Id>[] = [];
  for (const [index, station] of ordered.entries()) {
    const previous = ordered[index - 1];
    const adjacent = previous !== undefined && station.sortOrder - previous.sortOrder === 1;
    if (station.free && current.length > 0 && adjacent) {
      current.push(station);
    } else {
      if (current.length > 0) runs.push(current);
      current = station.free ? [station] : [];
    }
  }
  if (current.length > 0) runs.push(current);

  const fitting = runs.filter((run) => run.length >= count);
  if (fitting.length > 0) {
    const tightest = fitting.reduce((best, run) => (run.length < best.length ? run : best));
    return tightest.slice(0, count).map((s) => s.id);
  }

  // 2. No run is long enough: take the window of free stations with the smallest spread.
  let bestStart = 0;
  let bestSpread = Number.POSITIVE_INFINITY;
  for (let i = 0; i + count <= free.length; i++) {
    const spread = free[i + count - 1].sortOrder - free[i].sortOrder;
    if (spread < bestSpread) {
      bestSpread = spread;
      bestStart = i;
    }
  }
  return free.slice(bestStart, bestStart + count).map((s) => s.id);
}
