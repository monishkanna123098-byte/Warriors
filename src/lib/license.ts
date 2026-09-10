/**
 * Licence numbers contain slashes ("MFG/TN/001"), which cannot appear as a single
 * path segment. The public verify URL therefore carries the slug form
 * ("MFG-TN-001") — acceptance A13 uses exactly that.
 *
 * Slugging is lossy: "MFG/TN/001" and "MFG-TN-001" slug identically. Lookup
 * therefore resolves against a set of candidates rather than assuming a single
 * inverse, and a slug that matches more than one organisation is treated as
 * unresolved rather than guessed at.
 */
export function licenseSlug(licenseNo: string): string {
  return licenseNo.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-");
}

/** Candidate literal licence numbers a slug could have come from. */
export function licenseCandidates(slug: string): string[] {
  const s = slug.trim().toUpperCase();
  const parts = s.split("-");
  const withSlashes = parts.join("/");
  return Array.from(new Set([s, withSlashes, s.replace(/-/g, "/")]));
}
