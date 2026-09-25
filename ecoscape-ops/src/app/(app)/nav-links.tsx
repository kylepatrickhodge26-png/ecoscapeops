"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [{ href: "/customers", label: "Customers" }];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      {LINKS.map(({ href, label }) => {
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
