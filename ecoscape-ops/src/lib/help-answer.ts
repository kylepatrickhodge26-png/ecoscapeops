// "Ask a question" on the Help page: finds the best Help answers for a question typed in
// everyday words ("how do I delay a client?"), not just the app's own words ("move a job").
//
// It runs entirely in the browser over the fixed Help topics: no outside service, nothing
// sent anywhere, nothing stored. How it works:
//   1. Drop filler words ("how do I…") and reduce words to a simple stem (booking → book).
//   2. Widen each word with everyday synonyms (client → customer, bill → invoice).
//   3. Score each topic: a word found in the question counts most, then in the extra
//      keywords below, then in the answer. Rare words count more than common ones.
//   4. Return the best few, dropping weak matches.

import { helpFor, searchHelp, type HelpRole, type HelpTopic } from "./help";

// Words that say nothing about what someone wants to do.
const STOP_WORDS = new Set(
  (
    "a an and are as at be been but by can could did do does doing for from get got had has have how i i'd i'm id im if in " +
    "into is it its it's just let me my need of on one our please should so some someone something that the their them " +
    "then there these they this to too up us want was we were what whats what's when where which who why will with would " +
    "you your yours not no yes ok okay hey hi help app thing things way"
  ).split(/\s+/),
);

// Groups of words people use for the same thing. Any word in a group also matches the others.
const SYNONYMS: string[][] = [
  ["customer", "client", "homeowner", "neighbor"],
  ["move", "delay", "push", "postpone", "reschedule", "bump", "switch", "later", "earlier", "another", "different"],
  ["rain", "weather", "storm", "wet", "raining"],
  ["invoice", "bill", "billing"],
  ["quote", "estimate", "bid", "proposal"],
  ["pay", "paid", "payment", "collect", "owe", "owed", "venmo", "zelle", "cashapp", "paypal"],
  ["crew", "worker", "employee", "guy", "guys", "helper", "team", "staff"],
  ["payroll", "wage", "wages", "timesheet", "hours"],
  ["clock", "punch", "timecard"],
  ["job", "visit", "appointment", "mow", "mowing", "cut", "lawn"],
  ["cancel", "skip"],
  ["stop", "quit", "pause", "season", "winter"],
  ["price", "cost", "charge", "rate", "raise", "increase"],
  ["add", "new", "create"],
  ["phone", "iphone", "android", "install", "icon", "download"],
  ["direction", "map", "navigate", "gps"],
  ["route", "order", "closest"],
  ["photo", "picture", "pic", "image", "camera"],
  ["note", "comment"],
  ["expense", "gas", "fuel", "receipt", "spent", "spend"],
  ["report", "profit", "revenue", "earn", "earned", "made", "make", "income", "tax", "taxes", "accountant", "export"],
  ["text", "sms", "message"],
  ["login", "log", "portal", "password", "account"],
  ["delete", "remove", "erase"],
  ["undo", "mistake", "accident", "accidentally", "wrong", "oops"],
  ["overdue", "late", "behind", "missed", "past"],
  ["day", "weekday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
  ["complete", "completed", "finish", "finished", "done"],
  ["request", "lead", "inquiry", "website", "facebook"],
  ["monthly", "month"],
  ["auto", "automatic", "automatically"],
  ["once", "single", "onetime"],
];

// Extra words for topics, for things people say that the answer itself doesn't.
const KEYWORDS: Record<string, string[]> = {
  move: ["delay", "push", "postpone", "reschedule", "earlier", "later", "today", "tomorrow", "different", "switch"],
  "could-not-service": ["rain", "locked", "gate", "dog", "postpone", "missed", "cant", "behind"],
  "cancel-visit": ["skip", "cancel", "once", "week"],
  "customer-day": ["weekday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "route", "wrong", "usual", "regular", "mowed", "come", "comes"],
  "change-price": ["raise", "increase", "rate", "charge", "cost", "frequency", "weekly", "biweekly", "often"],
  "undo-completed": ["mistake", "accident", "wrong", "undo", "reopen", "done"],
  "undo-crew": ["mistake", "accident", "wrong", "undo", "done"],
  "stop-service": ["season", "quit", "pause", "winter", "done", "anymore", "cancel"],
  invoice: ["bill", "charge", "send"],
  "get-paid": ["venmo", "zelle", "cashapp", "paypal", "card", "payment"],
  "record-payment": ["paid", "cash", "check", "payment", "received", "got"],
  quote: ["estimate", "bid", "price"],
  "add-crew": ["worker", "employee", "hire", "helper", "invite"],
  payroll: ["hours", "wages", "timesheet", "pay", "worked"],
  "forgot-clock-out-owner": ["forgot", "fix", "wrong", "hours", "left"],
  "forgot-clock-out-crew": ["forgot", "left", "running"],
  "home-screen": ["install", "icon", "iphone", "android", "download", "phone"],
  expenses: ["gas", "fuel", "receipt", "cost", "spent", "equipment"],
  reports: ["profit", "revenue", "made", "make", "much", "earned", "taxes", "accountant", "export", "money", "business"],
  requests: ["website", "lead", "form", "facebook", "new"],
  "customer-account": ["login", "portal", "account", "password", "see"],
  routes: ["route", "order", "drive", "closest"],
  directions: ["map", "gps", "navigate", "call", "address"],
  checklist: ["photo", "picture", "note", "checklist"],
  book: ["schedule", "add", "new", "recurring", "repeat", "weekly"],
  "one-time": ["once", "single", "onetime", "time"],
  overdue: ["late", "behind", "missed", "past", "red"],
  "auto-invoice": ["automatic", "auto", "draft"],
  "delete-customer": ["remove", "delete", "erase"],
  monthly: ["month", "once"],
  assign: ["give", "worker", "assign", "send"],
  "clock-in": ["start", "punch", "begin"],
  "clock-out": ["finish", "punch", "done", "leave"],
  workday: ["start", "end", "shift", "home", "hours", "payroll", "timesheet"],
  "crew-now": ["working", "where", "now", "clocked"],
  "no-prices": ["price", "money", "cost", "pay", "paid", "payment", "invoice", "bill", "charge"],
  "my-jobs": ["list", "week", "upcoming"],
  find: ["search", "look", "lookup"],
  offline: ["signal", "service", "internet", "wifi", "connection"],
};

export function keywordsFor(id: string): string[] {
  return KEYWORDS[id] ?? [];
}

export function keywordTopicIds(): string[] {
  return Object.keys(KEYWORDS);
}

// A rough stem, so "booking", "booked" and "books" all match "book".
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 4 && /(ches|shes|xes|sses|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.length > 3 && /([bdfgklmnprtz])\1$/.test(w)) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

// The meaningful words in some text, as stems.
export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map(stem);
}

const SYNONYM_INDEX: Map<string, Set<string>> = (() => {
  const index = new Map<string, Set<string>>();
  for (const group of SYNONYMS) {
    const stems = new Set(group.map(stem));
    for (const s of stems) {
      const existing = index.get(s) ?? new Set<string>();
      for (const t of stems) existing.add(t);
      index.set(s, existing);
    }
  }
  return index;
})();

function expand(term: string): string[] {
  return [term, ...[...(SYNONYM_INDEX.get(term) ?? [])].filter((t) => t !== term)];
}

type Indexed = { topic: HelpTopic; question: Set<string>; keywords: Set<string>; answer: Set<string> };

function indexTopics(topics: HelpTopic[]): { items: Indexed[]; idf: (term: string) => number; known: (term: string) => boolean } {
  const items = topics.map((topic) => ({
    topic,
    question: new Set(terms(topic.question)),
    keywords: new Set(keywordsFor(topic.id).flatMap(terms)),
    answer: new Set(terms(topic.answer.join(" "))),
  }));
  const df = new Map<string, number>();
  for (const it of items) {
    for (const t of new Set([...it.question, ...it.keywords, ...it.answer])) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = Math.max(items.length, 1);
  return { items, idf: (term) => Math.log(1 + n / (df.get(term) ?? n)), known: (term) => df.has(term) };
}

// A word in a short question says more than the same word in a long one.
const questionWeight = (it: Indexed) => 3 * Math.sqrt(2 / Math.max(2, it.question.size));

// The weakest score worth showing, and how close to the best answer the others must be.
const MIN_SCORE = 2;
const NEAR_BEST = 0.45;

// The best Help answers for a question, best first (at most `limit`). Empty when nothing
// fits well, so the page can say so plainly instead of showing something unrelated.
export function answerQuestion(query: string, topics: HelpTopic[], limit = 3): HelpTopic[] {
  const asked = [...new Set(terms(query))];
  if (asked.length === 0) return [];
  const { items, idf, known } = indexTopics(topics);

  const scored = items
    .map((it) => {
      let score = 0;
      for (const term of asked) {
        let best = 0;
        for (const e of expand(term)) {
          const where = it.question.has(e) ? questionWeight(it) : it.keywords.has(e) ? 2 : it.answer.has(e) ? 1 : 0;
          if (where === 0) continue;
          // A rare word counts more. A synonym match counts by both words: the person's own
          // word (how specific their question is) and the word it matched.
          const weight = e === term ? idf(e) : 0.95 * Math.sqrt((known(term) ? idf(term) : idf(e)) * idf(e));
          best = Math.max(best, where * weight);
        }
        score += best;
      }
      return { topic: it.topic, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0]?.score ?? 0;
  if (top < MIN_SCORE) return [];
  return scored
    .filter((r) => r.score >= top * NEAR_BEST)
    .slice(0, limit)
    .map((r) => r.topic);
}

export function answerFor(query: string, role: HelpRole, limit = 3): HelpTopic[] {
  return answerQuestion(query, helpFor(role), limit);
}

// For the search box: exact matches first (it's also used to find customers and invoices,
// so a name shouldn't pull in loosely related help); if there are none, answer it as a question.
export function helpMatches(query: string, role: HelpRole): HelpTopic[] {
  const exact = searchHelp(query, role);
  return exact.length > 0 ? exact : answerFor(query, role);
}

// The questions shown before anything is typed.
export const POPULAR_QUESTIONS: Record<HelpRole, string[]> = {
  owner: ["move", "could-not-service", "invoice", "record-payment", "add-crew", "forgot-clock-out-owner"],
  crew: ["clock-in", "clock-out", "could-not-service", "forgot-clock-out-crew", "directions"],
};
