"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { activeSection, isCurrent, type NavSection } from "@/lib/nav";

const ICONS: Record<NavSection["key"], React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  customers: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <circle cx="17.5" cy="9" r="2.5" />
      <path d="M16 14.6c2.6-.3 4.8 1.2 5.5 4.4" />
    </>
  ),
  schedule: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  money: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </>
  ),
  "my-jobs": (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M8.5 12l2.5 2.5 4.5-5" />
    </>
  ),
};

function Icon({ name }: { name: NavSection["key"] }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

// The main menu: a sidebar on computers, a tab bar along the bottom on phones.
export function NavLinks({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const active = activeSection(sections, pathname);
  return (
    <nav aria-label="Main" className="main-nav">
      {sections.map((s) => {
        const on = s === active;
        return (
          <Link key={s.key} href={s.href} className={`item${on ? " active" : ""}`} aria-current={on ? "page" : undefined}>
            <Icon name={s.key} />
            <span className="nav-label">{s.label}</span>
            {s.badge ? (
              <span className="nav-badge" aria-label={`${s.badge} new`}>
                {s.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

// The pages inside the current section, as a short row of links above the page.
export function SectionLinks({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const active = activeSection(sections, pathname);
  if (!active || active.links.length < 2) return null;
  return (
    <nav aria-label={active.label} className="section-links">
      {active.links.map((l) => {
        const on = isCurrent(pathname, l.href);
        return (
          <Link key={l.href} href={l.href} className={on ? "active" : undefined} aria-current={on ? "page" : undefined}>
            {l.label}
            {l.badge ? <span className="nav-badge">{l.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
