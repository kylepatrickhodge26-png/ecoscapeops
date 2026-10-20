// A link that opens turn-by-turn directions to an address in the phone's maps app (Google Maps
// on Android, and in the browser or app on iPhone).
export function directionsLink(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
