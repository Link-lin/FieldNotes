import "server-only";
import airportsData from "@/data/airports.json";

const airports = airportsData as unknown as Record<string, [number, number]>;

export function airportPoint(code: string | null): { latitude: number; longitude: number } | null {
  if (!code) return null;
  const p = airports[code];
  return p ? { latitude: p[0], longitude: p[1] } : null;
}
