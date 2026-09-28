import type { Stop } from "../../trip-days";

/** Keep road routes within one day and break at flights; an arrival can start a ground leg. */
export function roadRuns(stops: Stop[]): Stop[][] {
  const runs: Stop[][] = [];
  let run: Stop[] = [];
  for (const stop of stops) {
    if (stop.flight || (run.length && run[run.length - 1]!.day !== stop.day)) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    run.push(stop);
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** Maps Embed directions accepts at most 20 intermediate waypoints. */
export function routeChunks(stops: Stop[]): Stop[][] {
  return roadRuns(stops).flatMap((run) => {
    const chunks: Stop[][] = [];
    for (let start = 0; start < run.length - 1; start += 21) {
      chunks.push(run.slice(start, start + 22));
    }
    return chunks;
  });
}
