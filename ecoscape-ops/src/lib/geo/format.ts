// "LAKE RONKONKOMA" → "Lake Ronkonkoma" (the Census geocoder answers in capitals).
export function titleCase(text: string): string {
  return text.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

export const formatMiles = (miles: number) => `${miles < 10 ? miles.toFixed(1) : Math.round(miles).toLocaleString("en-US")} mi`;

export const LOOKUP_UNAVAILABLE = "The address lookup (U.S. Census Bureau) isn't answering right now. Please try again in a minute.";
