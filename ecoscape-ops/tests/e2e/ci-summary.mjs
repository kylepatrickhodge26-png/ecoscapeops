// CI only: turns Playwright's JSON results (test-results.json) into one short note per failing
// test, with its error, so failures can be read on the pull request without the full log.
// GitHub shows at most 10 notes per step, so it gives 9 and a count of the rest.
//
//   node tests/e2e/ci-summary.mjs [test-results.json]
import { readFileSync } from "node:fs";

let results;
try {
  results = JSON.parse(readFileSync(process.argv[2] ?? "test-results.json", "utf8"));
} catch {
  console.log("No browser test results to summarize.");
  process.exit(0);
}

const plain = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");
// Workflow commands: the message escapes %, CR and LF; a property also escapes : and ,.
const message = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const property = (text) => message(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

const failures = new Map();
function walk(suite) {
  for (const child of suite.suites ?? []) walk(child);
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      if (test.status !== "unexpected") continue; // passed, skipped, or passed on a retry
      const key = `${spec.file}:${spec.line} ${spec.title}`;
      const entry = failures.get(key) ?? { file: spec.file, line: spec.line, projects: [], error: "" };
      entry.projects.push(test.projectName);
      const last = test.results?.at(-1);
      if (!entry.error) entry.error = plain(last?.error?.message ?? last?.errors?.[0]?.message).split("\n").slice(0, 40).join("\n");
      failures.set(key, entry);
    }
  }
}
for (const suite of results.suites ?? []) walk(suite);

console.log(`${failures.size} failing browser ${failures.size === 1 ? "test" : "tests"}.`);
let shown = 0;
for (const [key, f] of failures) {
  if (shown === 9) {
    console.log(`::error::${message(`…and ${failures.size - 9} more failing tests (see the log).`)}`);
    break;
  }
  const title = property(`${key} [${f.projects.join(" + ")}]`);
  console.log(`::error file=${property(`ecoscape-ops/tests/e2e/${f.file}`)},line=${f.line},title=${title}::${message(f.error || "(no error message)")}`);
  shown += 1;
}
