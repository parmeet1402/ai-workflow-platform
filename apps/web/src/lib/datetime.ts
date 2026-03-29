/**
 * UTC instants for JSON payloads and logs. Database columns use `timestamp without time zone`
 * with UTC semantics; wire format uses ISO-8601 with `Z`.
 */
export function utcIsoNow(): string {
  return new Date().toISOString();
}
