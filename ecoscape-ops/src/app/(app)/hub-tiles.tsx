import Link from "next/link";

export type Tile = { href: string; title: string; text: string; stat?: string };

// Big, plain buttons for a section's pages.
export function HubTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <ul className="hub-tiles">
      {tiles.map((t) => (
        <li key={t.href}>
          <Link href={t.href} className="hub-tile">
            <span className="hub-title">{t.title}</span>
            {t.stat && <span className="hub-stat">{t.stat}</span>}
            <span className="hub-text">{t.text}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
