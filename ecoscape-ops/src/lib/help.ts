// The Help page: plain answers to "how do I…?" for owners and crew, written for a phone.
// Each topic says who it's for, so crew only see what applies to them (and never anything
// about prices or money).

export type HelpRole = "owner" | "crew";

export type HelpTopic = {
  id: string;
  section: string;
  question: string;
  answer: string[];
  for: HelpRole[];
};

const BOTH: HelpRole[] = ["owner", "crew"];
const OWNER: HelpRole[] = ["owner"];
const CREW: HelpRole[] = ["crew"];

export const HELP_TOPICS: HelpTopic[] = [
  // Today and the clock
  {
    id: "clock-in",
    section: "Today and the clock",
    question: "How do I clock in to a job?",
    answer: [
      "Open Today. Your next job is the big card at the top. Tap Clock in.",
      "That one tap starts your workday (if it hasn't started), clocks you in and marks the job In progress.",
    ],
    for: BOTH,
  },
  {
    id: "clock-out",
    section: "Today and the clock",
    question: "How do I clock out?",
    answer: [
      "Done with the job? Tap Clock out & finish. It's marked completed and your next stop comes up.",
      "Coming back to it later? Tap Clock out, not finished. The job stays open.",
    ],
    for: BOTH,
  },
  {
    id: "workday",
    section: "Today and the clock",
    question: "How do I start and end my workday?",
    answer: [
      "Tap Start my day at the top of Today, or just clock in to your first job, which starts it too.",
      "Tap End my day when you head home. It asks once, so a stray tap can't end your day. Ending the day also clocks you out of a job if you forgot.",
    ],
    for: BOTH,
  },
  {
    id: "cant-clock-in",
    section: "Today and the clock",
    question: "Why can't I clock in to a job?",
    answer: [
      "You can only be clocked in at one job at a time. Clock out of the other job first; the message tells you which one.",
      "Crew can only clock in to jobs assigned to them, and nobody can clock in to a job that's completed or cancelled.",
    ],
    for: BOTH,
  },
  {
    id: "forgot-clock-out-crew",
    section: "Today and the clock",
    question: "I forgot to clock out. What happens?",
    answer: [
      "A clock left running more than 16 hours closes itself the next time you clock in, so you're never stuck.",
      "It's flagged for your boss to fix. Tell them the times you really worked.",
    ],
    for: CREW,
  },
  {
    id: "forgot-clock-out-owner",
    section: "Today and the clock",
    question: "Someone forgot to clock out. How do I fix it?",
    answer: [
      "Go to More → Time. Forgotten clocks close themselves after 16 hours and show \"check it\".",
      "Tap Edit, set the real times, and add a note saying why. The note is required so there's a record of every change.",
    ],
    for: OWNER,
  },
  {
    id: "directions",
    section: "Today and the clock",
    question: "How do I get directions or call the customer?",
    answer: ["Tap the address on the job card to open directions in your maps app. Tap Call to phone the customer."],
    for: BOTH,
  },
  {
    id: "checklist",
    section: "Today and the clock",
    question: "Where are the checklist, photos and notes?",
    answer: ["Tap Checklist, photos & notes on the job card. Tick items off as you go, add photos and leave a note."],
    for: BOTH,
  },
  {
    id: "could-not-service",
    section: "Today and the clock",
    question: "What if I can't do a job?",
    answer: [
      "Open the job and tap Could not service. Add a reason (locked gate, dog in the yard…), then pick a new day or cancel it.",
      "The reason is saved on the job so everyone knows what happened.",
    ],
    for: BOTH,
  },
  {
    id: "crew-now",
    section: "Today and the clock",
    question: "How do I see who's working right now?",
    answer: ["On Today, Crew right now shows who's on the clock, since when, and which job they're at. It appears once you have someone on your crew."],
    for: OWNER,
  },
  {
    id: "my-jobs",
    section: "Today and the clock",
    question: "Where are all my jobs?",
    answer: ["Today shows today's jobs in route order. My jobs shows anything overdue, today, and the next 14 days."],
    for: CREW,
  },
  {
    id: "no-prices",
    section: "Today and the clock",
    question: "Why don't I see prices?",
    answer: ["Crew logins never show prices, invoices or money. Ask the owner if you need to know."],
    for: CREW,
  },
  {
    id: "undo-crew",
    section: "Today and the clock",
    question: "I finished a job by mistake. What do I do?",
    answer: ["Tell the owner. They can open the visit, tap Edit and set its Status back to Scheduled."],
    for: CREW,
  },

  // Customers
  {
    id: "find",
    section: "Customers",
    question: "How do I find something fast?",
    answer: [
      "Use the search box at the top of the screen. Type part of a name, a phone number, a street, a service, or an invoice or quote number (#1001, Q-1001).",
      "Results show matching customers, visits, quotes, invoices and requests. Tap one to open it.",
    ],
    for: OWNER,
  },
  {
    id: "add-customer",
    section: "Customers",
    question: "How do I add a customer?",
    answer: [
      "Customers → + Add customer. A name, phone or email is enough to save. Add the property address so they show up on routes.",
      "Only tick \"Customer has opted in to SMS\" if they've agreed to get texts. The app never texts anyone who hasn't.",
    ],
    for: OWNER,
  },
  {
    id: "customer-account",
    section: "Customers",
    question: "Can my customers log in and see their visits?",
    answer: [
      "Yes. On their customer page tap Invite to their account and send them the link (it works once, for 14 days).",
      "They see their upcoming visits, quotes and invoices, can pay, ask for more work, and read your FAQ. They never see notes, gate codes, crew or other customers.",
    ],
    for: OWNER,
  },
  {
    id: "requests",
    section: "Customers",
    question: "How do new customers ask me for work?",
    answer: [
      "Customers → Requests has your request form link. Turn it on and share it: on your website, Facebook, or in a text.",
      "Requests land in the inbox. Add customer + quote or Add customer + book turns one into a customer in a tap.",
    ],
    for: OWNER,
  },
  {
    id: "customer-faq",
    section: "Customers",
    question: "How do I answer the questions customers always ask?",
    answer: [
      "Settings → Customer FAQ. Write each question and your answer (rain days, how to pay, what's included…).",
      "Customers see them on their account page and on your request form.",
    ],
    for: OWNER,
  },
  {
    id: "delete-customer",
    section: "Customers",
    question: "How do I delete a customer?",
    answer: [
      "Open the customer and tap Delete. That also removes their visits, invoices and photos.",
      "If they're only done for the season, tap Stop next to their service instead, so their history stays.",
    ],
    for: OWNER,
  },

  // Schedule
  {
    id: "book",
    section: "Schedule",
    question: "How do I book a job?",
    answer: [
      "Tap Book a job (on Today or the Schedule). Pick the customer, the service, the price, how often and the first visit.",
      "For repeat work the app keeps the next 6 visits on the schedule, adding the next one as each is done.",
    ],
    for: OWNER,
  },
  {
    id: "move",
    section: "Schedule",
    question: "How do I move a job to another day?",
    answer: [
      "Open the visit (find it on the Schedule, or search the customer's name) and tap Move. Pick Today, Tomorrow, another day this week, or any date, then tap the button to move it. Their other visits stay where they are, and you get a ready-made text for customers who agreed to texts.",
      "Their regular day is changing? Tick Also move their later visits by the same number of days. All their upcoming visits shift, and the new weekday becomes their regular day.",
      "Several at once: open the day on the Schedule, tick the visits, pick the day and tap Move. On Today you can also tap Move next to a stop you won't get to.",
      "Rain day? Use Move a day's jobs on the Weather page to move the whole day at once. It gets a text ready for each customer who agreed to texts.",
    ],
    for: OWNER,
  },
  {
    id: "stop-service",
    section: "Schedule",
    question: "How do I pause a customer for the season, or stop a service?",
    answer: [
      "End of the season: open the customer and tap Done for the season. Their upcoming repeat visits come off the schedule; one-time jobs (like a fall cleanup) stay.",
      "When they're back, tap Start again. Their repeat visits return on their regular day, with the same crew member. Marking them Inactive or Active on Edit does the same.",
      "To end one service for good, tap Stop next to it, then Stop service. Past visits stay in their history.",
    ],
    for: OWNER,
  },
  {
    id: "routes",
    section: "Schedule",
    question: "How does route order work?",
    answer: [
      "Set your shop address in Settings. Each day's visits are put in driving order starting from the shop.",
      "Open a day on the Schedule to see each person's route. Use the arrows to change the order; your order is kept for that day.",
    ],
    for: OWNER,
  },
  {
    id: "assign",
    section: "Schedule",
    question: "How do I give a job to someone on my crew?",
    answer: ["Add them under More → Crew first. Then an Assign to choice appears when you book a job or edit a visit."],
    for: OWNER,
  },
  {
    id: "customer-day",
    section: "Schedule",
    question: "How do I set which day each customer gets done?",
    answer: [
      "Open the customer, tap Edit and set Preferred day. When you book them, First visit starts on that day, and repeat visits stay on that weekday.",
      "Already booked on the wrong day? Open their next visit, tap Move, pick the right day and tick Also move their later visits. Every upcoming visit moves, and that weekday becomes their regular day.",
    ],
    for: OWNER,
  },
  {
    id: "change-price",
    section: "Schedule",
    question: "How do I change a customer's price or how often they're done?",
    answer: [
      "Just one visit: open it, tap Edit and change the Price.",
      "From now on: on their customer page tap Stop next to the service, then + Book a service with the new price or How often. Past visits keep the price they had.",
    ],
    for: OWNER,
  },
  {
    id: "one-time",
    section: "Schedule",
    question: "How do I book a one-time job?",
    answer: ["Tap + Book a job, set How often to One time and pick the Visit date. It won't repeat."],
    for: OWNER,
  },
  {
    id: "cancel-visit",
    section: "Schedule",
    question: "How do I cancel or skip one visit?",
    answer: [
      "Open the visit and tap Could not service, then Cancel visit. The reason you type is kept on it. The rest of their visits stay booked.",
      "To remove it completely instead, tap Delete.",
    ],
    for: OWNER,
  },
  {
    id: "overdue",
    section: "Schedule",
    question: "What does Overdue mean?",
    answer: [
      "The visit's date has passed but it isn't marked completed or cancelled.",
      "If you did it, open it and tap Mark completed. If not, tap Could not service to give it a new day or cancel it.",
    ],
    for: OWNER,
  },
  {
    id: "undo-completed",
    section: "Schedule",
    question: "I marked a visit completed by mistake. How do I undo it?",
    answer: ["Open the visit, tap Edit, change Status back to Scheduled and Save."],
    for: OWNER,
  },

  // Money
  {
    id: "invoice",
    section: "Money",
    question: "How do I send an invoice?",
    answer: [
      "Money → Invoices → New invoice. Add the visits or anything else, then Send to customer.",
      "Open text sends the pay link from your phone, Copy link lets you email it, and Mark as sent is for a paper invoice.",
    ],
    for: OWNER,
  },
  {
    id: "get-paid",
    section: "Money",
    question: "How do customers pay me?",
    answer: [
      "Add your payment apps on the Invoices page (Venmo, Cash App, PayPal, Zelle, or your own pay link).",
      "The invoice's pay link shows a button for each. The money goes straight to you, with no fees from the app.",
    ],
    for: OWNER,
  },
  {
    id: "record-payment",
    section: "Money",
    question: "How do I mark an invoice paid?",
    answer: ["Open the invoice and tap Record a payment when the money arrives. Payment apps don't tell the app, so record it yourself."],
    for: OWNER,
  },
  {
    id: "monthly",
    section: "Money",
    question: "Can I bill a customer once a month?",
    answer: ["Tick Bill monthly on their customer page. Then on the Invoices page, pick the month and tap Generate invoices. You review each draft before sending."],
    for: OWNER,
  },
  {
    id: "quote",
    section: "Money",
    question: "How do I send a quote?",
    answer: [
      "Money → Quotes → New quote. Send it by text, copy it, or print it.",
      "When they say yes, open the quote and use They said yes (Accept & book it) to put the work on the schedule.",
    ],
    for: OWNER,
  },
  {
    id: "reports",
    section: "Money",
    question: "Where do I see how the business is doing?",
    answer: [
      "Money → Reports shows revenue, expenses and profit for any dates, and Export for your accountant (CSV).",
      "Log fuel, equipment and other costs under Money → Expenses.",
    ],
    for: OWNER,
  },
  {
    id: "expenses",
    section: "Money",
    question: "How do I log gas or equipment costs?",
    answer: [
      "On Today, under Quick actions, tap Log gas or Log equipment and type the amount.",
      "For anything else, go to Money → Expenses → + Add expense.",
    ],
    for: OWNER,
  },
  {
    id: "auto-invoice",
    section: "Money",
    question: "Can invoices be made for me automatically?",
    answer: [
      "Yes. On Money → Invoices, tick Auto-create a draft invoice when a visit is marked completed.",
      "You still look over each draft and send it yourself.",
    ],
    for: OWNER,
  },

  // Crew
  {
    id: "add-crew",
    section: "Crew",
    question: "How do I add someone to my crew?",
    answer: [
      "More → Crew. Type their name and tap Add and get invite link, then text them the link.",
      "They open it and make their own login. The link works once, for 14 days.",
    ],
    for: OWNER,
  },
  {
    id: "crew-sees",
    section: "Crew",
    question: "What can my crew see?",
    answer: ["Only their own jobs: the customer's name, address, phone, gate notes and job notes. Never prices, invoices, other people's jobs or any money."],
    for: OWNER,
  },
  {
    id: "payroll",
    section: "Crew",
    question: "Where do I see hours for payroll?",
    answer: ["More → Time shows Workday hours (for payroll) for each person, the hours on each job, and what each job earned per hour."],
    for: OWNER,
  },

  // Your phone
  {
    id: "home-screen",
    section: "Your phone",
    question: "Can I put the app on my phone's home screen?",
    answer: [
      "iPhone: open the app in Safari, tap Share, then Add to Home Screen.",
      "Android: open it in Chrome, tap the menu, then Install app.",
    ],
    for: BOTH,
  },
  {
    id: "offline",
    section: "Your phone",
    question: "Does it work without signal?",
    answer: ["No. The app needs a connection to show jobs. If you lose signal, it says you're offline; try again when you're back in range."],
    for: BOTH,
  },
];

export function helpFor(role: HelpRole): HelpTopic[] {
  return HELP_TOPICS.filter((t) => t.for.includes(role));
}

// Every word typed has to appear in the question or answer, ignoring capitals.
export function searchHelp(query: string, role: HelpRole): HelpTopic[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (words.join("").length < 2) return [];
  return helpFor(role).filter((t) => {
    const text = `${t.question} ${t.answer.join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

export function helpSections(topics: HelpTopic[]): { section: string; topics: HelpTopic[] }[] {
  const sections: { section: string; topics: HelpTopic[] }[] = [];
  for (const t of topics) {
    const last = sections.at(-1);
    if (last && last.section === t.section) last.topics.push(t);
    else sections.push({ section: t.section, topics: [t] });
  }
  return sections;
}
