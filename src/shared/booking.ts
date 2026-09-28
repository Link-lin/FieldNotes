type Endpoint = { airportCode: string | null; localDateTime: string | null; timeZone: string | null };

/** FLIGHT-2: a flight can be marked Booked only with both airport codes, local date-times and time zones. */
export function flightReadyToBook(flight: { departure: Endpoint; arrival: Endpoint }): boolean {
  return [flight.departure, flight.arrival].every((end) => !!end.airportCode && !!end.localDateTime && !!end.timeZone);
}
