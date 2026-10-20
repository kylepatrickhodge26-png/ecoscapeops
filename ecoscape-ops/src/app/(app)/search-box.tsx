"use client";

import Form from "next/form";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { SEARCH_MAX_LENGTH } from "@/lib/search";

function SearchForm({ q = "", autoFocus = false }: { q?: string; autoFocus?: boolean }) {
  return (
    <Form action="/search" role="search" className="search-box">
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder="Search customers, jobs, invoices…"
        aria-label="Search"
        maxLength={SEARCH_MAX_LENGTH}
        enterKeyHint="search"
        autoComplete="off"
        autoFocus={autoFocus}
      />
      <button type="submit" aria-label="Search">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
      </button>
    </Form>
  );
}

// On the search page the box shows what was searched for (and is ready to type in when
// nothing was); everywhere else it starts empty.
function LiveSearchForm() {
  const onSearchPage = usePathname() === "/search";
  const params = useSearchParams();
  const q = onSearchPage ? (params.get("q") ?? "") : "";
  return <SearchForm key={onSearchPage ? `q:${q}` : "elsewhere"} q={q} autoFocus={onSearchPage && q === ""} />;
}

// The owner's search box at the top of every screen.
export function SearchBox() {
  return (
    <Suspense fallback={<SearchForm />}>
      <LiveSearchForm />
    </Suspense>
  );
}
