// The app's menu: five sections instead of a long list, most-used first, with Today (the clock
// and the day's route) always the first tab. Each section owns the pages under it, so the right
// tab stays highlighted wherever you are, and its pages show as a short row of links at the top.

export type SubLink = { href: string; label: string; badge?: number };
export type NavSection = {
  key: "home" | "customers" | "schedule" | "money" | "more" | "my-jobs";
  href: string;
  label: string;
  // Pages (path prefixes) that belong to this section.
  owns: string[];
  links: SubLink[];
  badge?: number;
};

const owns = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

export function ownerSections(opts: { newRequests: number; hasCrew: boolean }): NavSection[] {
  return [
    { key: "home", href: "/dashboard", label: "Today", owns: ["/dashboard"], links: [] },
    {
      key: "schedule",
      href: "/schedule",
      label: "Schedule",
      owns: ["/schedule", "/my-jobs", "/weather"],
      links: [
        { href: "/schedule", label: "Calendar" },
        ...(opts.hasCrew ? [{ href: "/my-jobs", label: "My jobs" }] : []),
        { href: "/weather", label: "Weather" },
      ],
    },
    {
      key: "customers",
      href: "/customers",
      label: "Customers",
      owns: ["/customers", "/requests"],
      badge: opts.newRequests,
      links: [
        { href: "/customers", label: "All customers" },
        { href: "/requests", label: "Requests", badge: opts.newRequests },
      ],
    },
    {
      key: "money",
      href: "/money",
      label: "Money",
      owns: ["/money", "/quotes", "/invoices", "/expenses", "/reports"],
      links: [
        { href: "/quotes", label: "Quotes" },
        { href: "/invoices", label: "Invoices" },
        { href: "/expenses", label: "Expenses" },
        { href: "/reports", label: "Reports" },
      ],
    },
    {
      key: "more",
      href: "/more",
      label: "More",
      owns: ["/more", "/crew", "/time", "/settings", "/help"],
      links: [
        { href: "/crew", label: "Crew" },
        { href: "/time", label: "Time" },
        { href: "/settings", label: "Settings" },
        { href: "/help", label: "Help" },
      ],
    },
  ];
}

// Crew members only ever get their own jobs: Today (clock and route) and all their jobs.
export function crewSections(): NavSection[] {
  return [
    { key: "home", href: "/dashboard", label: "Today", owns: ["/dashboard"], links: [] },
    { key: "my-jobs", href: "/my-jobs", label: "My jobs", owns: ["/my-jobs"], links: [] },
  ];
}

export function activeSection(sections: NavSection[], pathname: string): NavSection | undefined {
  return sections.find((s) => s.owns.some((p) => owns(pathname, p)));
}

export function isCurrent(pathname: string, href: string): boolean {
  return owns(pathname, href);
}
