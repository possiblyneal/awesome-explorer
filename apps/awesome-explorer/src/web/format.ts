const DAY = 86_400_000;

export function compact(value: number): string {
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - Date.parse(iso)) / DAY);
  if (days < 1) return "today";
  if (days < 60) return `${days}d ago`;
  if (days < 730) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function listHref(repo: string): string {
  return `#/list/${repo}`;
}
