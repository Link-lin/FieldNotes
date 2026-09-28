export type Choice = "" | "earlier" | "later";
/** One end of a flight segment as typed in the form. */
export type Endpoint = { code: string; dt: string; zone: string; choice: Choice };

