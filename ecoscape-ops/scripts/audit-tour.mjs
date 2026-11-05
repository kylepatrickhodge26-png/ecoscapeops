// AUDIT ONLY (not part of the app): signs up a business on a local Supabase, fills it with
// realistic data, then visits every page as the owner, a crew member and a customer, on a
// phone and a computer. Saves a screenshot of each and a report of any page that errored.
//
//   node scripts/audit-tour.mjs <status.json> <out-dir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { chromium, devices } from "playwright";

const [statusFile, out] = process.argv.slice(2);
const status = JSON.parse(readFileSync(statusFile, "utf8"));
const BASE = "http://localhost:3000";
const PASSWORD = "correct-horse-battery";
const tag = randomUUID().slice(0, 6);
mkdirSync(out, { recursive: true });

const report = { pages: [], seedErrors: [] };
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const anon = () => createClient(status.API_URL, status.PUBLISHABLE_KEY, opts);
const iso = (d) => d.toISOString().slice(0, 10);
const todayNY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const day = (n) => {
  const d = new Date(`${todayNY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

async function must(label, promise) {
  try {
    const result = await promise;
    if (result && result.error) report.seedErrors.push({ label, error: result.error.message ?? String(result.error) });
    return result;
  } catch (e) {
    report.seedErrors.push({ label, error: String(e?.message ?? e) });
    return {};
  }
}

const browser = await chromium.launch();
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const phone = await browser.newContext({ ...devices["Pixel 7"] });
let current = null; // the page in use, for a screenshot if something fails
const annotate = (level, message) => console.log(`::${level}::${String(message).replace(/\r?\n/g, " ").slice(0, 900)}`);

try {

// ---------------------------------------------------------------------------
// The owner signs up through the app, then sets the service area and shop in the app.
// ---------------------------------------------------------------------------
const ownerEmail = `kyle-${tag}@example.test`;
const page = await desktop.newPage();
current = page;
page.on("pageerror", (e) => report.seedErrors.push({ label: "owner page error", error: e.message }));
await page.goto(`${BASE}/signup`);
await page.getByLabel("Your name").fill("Kyle");
await page.getByLabel("Business name").fill("EcoScape");
await page.getByLabel("Email").fill(ownerEmail);
await page.getByLabel("Password").fill(PASSWORD);
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(/\/dashboard$/, { timeout: 60_000 });

await page.goto(`${BASE}/weather/area`);
await page.getByLabel(/ZIP/i).fill("11779");
await page.getByRole("button", { name: "Save service area" }).click();
await page.waitForURL(/\/weather/, { timeout: 60_000 });

await page.goto(`${BASE}/settings`);
await page.getByLabel("Shop address").fill("61 Clarendon Rd, Lake Ronkonkoma, NY");
await page.getByRole("button", { name: "Save shop address" }).click();
await page.waitForURL(/notice=shop/, { timeout: 60_000 }).catch(() => {});

const owner = anon();
await must("owner sign in", owner.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD }));
const { data: member } = await owner.from("business_members").select("business_id").single();
const biz = member.business_id;

// ---------------------------------------------------------------------------
// Customers and bookings
// ---------------------------------------------------------------------------
const people = [
  ["John", "Smith", "1 Near St, Lake Ronkonkoma, NY", true],
  ["Karen", "Lopez", "2 Middle St, Lake Ronkonkoma, NY", true],
  ["Hector", "Diaz", "3 Far St, Lake Ronkonkoma, NY", false],
  ["Zina", "Park", "4 West St, Lake Ronkonkoma, NY", true],
  ["Tomy", "Reyes", "5 Lake Ave, Lake Grove, NY", false],
  ["Angelo", "Russo", "8 Home Rd, Lake Ronkonkoma, NY", true],
];
const customers = {};
for (const [first, last, address, sms] of people) {
  const { data } = await must(
    `customer ${first}`,
    owner
      .from("customers")
      .insert({ business_id: biz, first_name: first, last_name: last, phone: `631555${String(Math.floor(Math.random() * 9000) + 1000)}`, email: `${first.toLowerCase()}-${tag}@example.test`, property_address: address, sms_opt_in: sms, access_instructions: first === "John" ? "Gate code 1234" : "" })
      .select("id")
      .single(),
  );
  customers[first] = data?.id;
}
const book = async (who, fields) =>
  (await must(`book ${who}`, owner.from("service_plans").insert({ business_id: biz, customer_id: customers[who], service_name: "Mowing", price: 50, ...fields }).select("id").single())).data?.id;
const plans = {
  john: await book("John", { frequency: "weekly", start_date: day(0) }),
  karen: await book("Karen", { frequency: "biweekly", start_date: day(1) }),
  hector: await book("Hector", { frequency: "weekly", start_date: day(-14) }),
  zina: await book("Zina", { frequency: "weekly", start_date: day(0), price: 45 }),
  tomy: await book("Tomy", { frequency: "triweekly", start_date: day(2), price: 60 }),
  angeloCleanup: await book("Angelo", { frequency: "one_time", start_date: day(3), service_name: "Fall cleanup", price: 350 }),
};
const visitsOf = async (planId) => (await owner.from("jobs").select("id, scheduled_date, status").eq("service_plan_id", planId).order("scheduled_date")).data ?? [];
const johnVisits = await visitsOf(plans.john);
const hectorVisits = await visitsOf(plans.hector);
// Hector: two weeks ago done, last week never marked (overdue).
if (hectorVisits[0]) await must("hector done", owner.from("jobs").update({ status: "completed" }).eq("id", hectorVisits[0].id));
// Tomy is done for the season.
await must("tomy inactive", owner.from("customers").update({ status: "inactive" }).eq("id", customers.Tomy));

// ---------------------------------------------------------------------------
// Crew: Hudson joins with his invite and gets Zina's visits.
// ---------------------------------------------------------------------------
const { data: invite } = await must("add crew", owner.rpc("add_crew_member", { member_name: "Hudson" }).single());
const crewEmail = `hudson-${tag}@example.test`;
const crew = anon();
await must("crew signup", crew.auth.signUp({ email: crewEmail, password: PASSWORD, options: { data: { crew_invite_token: invite?.invite_token, full_name: "Hudson" } } }));
if (invite) await must("assign zina", owner.from("service_plans").update({ assigned_crew_member_id: invite.crew_member_id }).eq("id", plans.zina));
const zinaVisits = await visitsOf(plans.zina);
for (const v of zinaVisits) await must("assign zina visit", owner.from("jobs").update({ assigned_crew_member_id: invite?.crew_member_id }).eq("id", v.id));

// ---------------------------------------------------------------------------
// Money: a quote, invoices (one part-paid), expenses.
// ---------------------------------------------------------------------------
const { data: quoteId } = await must(
  "quote",
  owner.rpc("save_quote", {
    quote_id: null, customer_id: null, prospect_name: "Maria Gomez", prospect_phone: "6315550199", prospect_email: `maria-${tag}@example.test`,
    prospect_address: "9 Pond Rd, Lake Grove, NY", title: "Spring cleanup and mulch", expires_on: day(30), notes: "",
    lines: [{ description: "Spring cleanup", quantity: 1, unit_price: 250 }, { description: "Mulch (yards)", quantity: 4, unit_price: 65 }],
  }),
);
if (quoteId) await must("send quote", owner.rpc("send_quote", { quote_id: quoteId }));
if (johnVisits[0]) await must("john done", owner.from("jobs").update({ status: "completed" }).eq("id", johnVisits[0].id));
const { data: invoiceId } = await must(
  "invoice",
  owner.rpc("save_invoice", { invoice_id: null, customer_id: customers.John, due_date: day(14), notes: "", lines: [{ job_id: johnVisits[0]?.id ?? null, description: "Mowing", quantity: 1, unit_price: 50 }, { description: "Hedge trimming", quantity: 1, unit_price: 40 }] }),
);
if (invoiceId) {
  await must("send invoice", owner.rpc("send_invoice", { invoice_id: invoiceId }));
  await must("payment", owner.rpc("record_manual_payment", { invoice_id: invoiceId, amount: 50, method: "cash", note: "", received_on: day(0), request_id: randomUUID() }));
}
await must("draft invoice", owner.rpc("save_invoice", { invoice_id: null, customer_id: customers.Karen, due_date: day(14), notes: "", lines: [{ job_id: null, description: "Aeration", quantity: 1, unit_price: 120 }] }));
// A draft made a while ago, now past its due date (only the admin key can backdate it).
const { data: oldDraftId } = await must("old draft", owner.rpc("save_invoice", { invoice_id: null, customer_id: customers.Zina, due_date: day(14), notes: "", lines: [{ job_id: null, description: "Leaf cleanup", quantity: 1, unit_price: 150 }] }));
if (oldDraftId && status.SECRET_KEY) {
  const admin = createClient(status.API_URL, status.SECRET_KEY, opts);
  await must("backdate draft", admin.from("invoices").update({ issue_date: day(-16), due_date: day(-2) }).eq("id", oldDraftId));
}
await must("expenses", owner.from("expenses").insert([
  { business_id: biz, category: "fuel", amount: 62.4, vendor: "Speedway", spent_on: day(0) },
  { business_id: biz, category: "equipment", amount: 189.99, vendor: "Home Depot", spent_on: day(-3) },
]));

// ---------------------------------------------------------------------------
// A request from the public form, a rain delay, time on a job, a customer login.
// ---------------------------------------------------------------------------
await must("request link", owner.rpc("set_request_link_enabled", { enabled: true }));
const { data: link } = await owner.from("request_links").select("token").single();
await must("request", anon().rpc("submit_request", { token: link?.token, name: "Sam Lee", phone: "6315550123", email: `sam-${tag}@example.test`, address: "12 Oak St, Ronkonkoma, NY", details: "Weekly mowing please, front and back.", ip_hash: tag }));
const { data: delayId } = await must("rain delay", owner.rpc("move_day_visits", { from_date: day(1), to_date: day(2) }));
await must("rain settings", owner.from("businesses").update({ rain_auto_move: true }).eq("id", biz));
await must("start day", owner.rpc("start_workday"));
const todays = (await owner.from("jobs").select("id").eq("scheduled_date", day(0)).eq("status", "scheduled")).data ?? [];
if (todays[0]) {
  await must("start job", owner.rpc("start_job", { job_id: todays[0].id }));
  await must("finish job", owner.rpc("finish_job", { job_id: todays[0].id, complete: true }));
}
const { data: customerToken } = await must("invite customer", owner.rpc("invite_customer", { customer_id: customers.Karen }));
const customerEmail = `karen-${tag}@example.test`;
const customer = anon();
await must("customer signup", customer.auth.signUp({ email: customerEmail, password: PASSWORD, options: { data: { customer_invite_token: customerToken, full_name: "Karen Lopez" } } }));

// ---------------------------------------------------------------------------
// Visit every page.
// ---------------------------------------------------------------------------
const anyJob = johnVisits[1]?.id ?? johnVisits[0]?.id;
const { data: payLink } = await owner.from("invoices").select("pay_token").eq("id", invoiceId ?? "").maybeSingle();

async function signIn(context, email) {
  const p = await context.newPage();
  await p.goto(`${BASE}/login`);
  // Already signed in (the owner signed up in this window): the login page sends you on.
  if (!new URL(p.url()).pathname.startsWith("/login")) return void (await p.close());
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Password").fill(PASSWORD);
  await p.getByRole("button", { name: /sign in|log in/i }).click();
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.close();
}

async function shoot(context, who, size, path, name) {
  const p = await context.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text().slice(0, 300)}`));
  let statusCode = 0;
  try {
    const res = await p.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 60_000 });
    statusCode = res?.status() ?? 0;
  } catch (e) {
    errors.push(`load: ${e.message.slice(0, 200)}`);
  }
  const text = await p.locator("body").innerText().catch(() => "");
  if (/Something went wrong|Application error|This page could not be found|Unhandled Runtime Error/i.test(text)) errors.push(`error text on page: ${text.slice(0, 300)}`);
  const width = await p.evaluate(() => document.documentElement.scrollWidth).catch(() => 0);
  const file = `${who}-${size}-${name}.png`;
  await p.screenshot({ path: `${out}/${file}`, fullPage: true }).catch((e) => errors.push(`screenshot: ${e.message}`));
  report.pages.push({ who, size, path, file, status: statusCode, finalUrl: p.url().replace(BASE, ""), tooWide: size === "phone" && width > 420 ? width : undefined, errors });
  await p.close();
}

const ownerPages = [
  ["/dashboard", "today"],
  ["/schedule", "schedule-calendar"],
  ["/schedule?view=list&filter=upcoming", "schedule-list"],
  ["/schedule?view=list&filter=attention", "schedule-attention"],
  [`/schedule/day/${day(0)}`, "schedule-day-today"],
  [`/schedule/day/${day(2)}`, "schedule-day-rain-moved"],
  [`/schedule/jobs/${anyJob}`, "visit"],
  [`/schedule/jobs/${anyJob}?move=1`, "visit-move"],
  [`/schedule/jobs/${anyJob}/edit`, "visit-edit"],
  ["/schedule/new", "book"],
  ["/my-jobs", "my-jobs"],
  ["/weather", "weather"],
  [`/weather/delays/${delayId}`, "rain-delay"],
  ["/weather/move", "weather-move"],
  ["/customers", "customers"],
  [`/customers/${customers.John}`, "customer-john"],
  [`/customers/${customers.Tomy}`, "customer-tomy-inactive"],
  [`/customers/${customers.John}/edit`, "customer-edit"],
  ["/customers/new", "customer-new"],
  ["/requests", "requests"],
  ["/money", "money"],
  ["/quotes", "quotes"],
  [`/quotes/${quoteId}`, "quote"],
  ["/quotes/new", "quote-new"],
  ["/invoices", "invoices"],
  [`/invoices/${invoiceId}`, "invoice"],
  [`/invoices/${oldDraftId}`, "invoice-draft-past-due"],
  ["/invoices/new", "invoice-new"],
  ["/invoices/payment-options", "payment-options"],
  ["/expenses", "expenses"],
  ["/expenses/new", "expense-new"],
  ["/reports", "reports"],
  ["/more", "more"],
  ["/crew", "crew"],
  ["/time", "time"],
  ["/settings", "settings"],
  ["/settings/checklists", "checklists"],
  ["/settings/faq", "faq"],
  ["/help", "help"],
  ["/search?q=john", "search"],
];

await signIn(desktop, ownerEmail);
await signIn(phone, ownerEmail);
for (const [path, name] of ownerPages) {
  await shoot(desktop, "owner", "desktop", path, name);
  await shoot(phone, "owner", "phone", path, name);
}

for (const [ctxName, email, pages] of [
  ["crew", crewEmail, [["/dashboard", "today"], ["/my-jobs", "my-jobs"], ["/help", "help"], ["/customers", "blocked-customers"]]],
  ["customer", customerEmail, [["/portal", "portal"], ["/dashboard", "blocked-dashboard"]]],
]) {
  const ctx = await browser.newContext({ ...devices["Pixel 7"] });
  await signIn(ctx, email);
  for (const [path, name] of pages) await shoot(ctx, ctxName, "phone", path, name);
  await ctx.close();
}

const publicCtx = await browser.newContext({ ...devices["Pixel 7"] });
for (const [path, name] of [
  ["/", "home"],
  ["/login", "login"],
  ["/signup", "signup"],
  [`/request/${link?.token}`, "request-form"],
  [`/pay/${payLink?.pay_token}`, "pay"],
]) await shoot(publicCtx, "public", "phone", path, name);

} catch (error) {
  report.fatal = String(error?.stack ?? error);
  annotate("error", `tour stopped: ${error?.message ?? error} at ${current?.url?.() ?? "?"}`);
  if (current) await current.screenshot({ path: `${out}/fail.png`, fullPage: true }).catch(() => {});
  if (current) writeFileSync(`${out}/fail.txt`, await current.locator("body").innerText().catch(() => ""));
}

writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
await browser.close();
for (const e of report.seedErrors) annotate("warning", `seed ${e.label}: ${e.error}`);
for (const p of report.pages.filter((p) => p.errors.length || p.tooWide)) annotate("warning", `${p.who} ${p.size} ${p.path}: ${p.errors.join(" | ")}${p.tooWide ? ` too wide (${p.tooWide}px)` : ""}`);
console.log(`Pages: ${report.pages.length}, with errors: ${report.pages.filter((p) => p.errors.length).length}, seed errors: ${report.seedErrors.length}`);
