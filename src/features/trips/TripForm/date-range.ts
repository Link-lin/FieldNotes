type Range = { startDate: string; endDate: string };

/**
 * B3: how many events a new date range pushes outside the trip. Events already outside the
 * current range are not counted again; an incomplete new range counts nothing.
 */
export function newlyOutside(itemDates: readonly string[], current: Range, next: Partial<Range>): number {
  const { startDate, endDate } = next;
  if (!startDate || !endDate) return 0;
  return itemDates.filter((d) => d >= current.startDate && d <= current.endDate && (d < startDate || d > endDate)).length;
}
