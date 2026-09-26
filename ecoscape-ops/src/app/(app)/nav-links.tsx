"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavLink = { href: string; label: string };

export function NavLinks({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      {links.map(({ href, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} className={`item${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
            <span className="dot" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
