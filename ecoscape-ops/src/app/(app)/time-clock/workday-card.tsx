import { requireMembership } from "@/lib/auth";
import { formatClock } from "@/lib/time/format";

import { endWorkday, startWorkday } from "./actions";
import { getMyClock } from "./clock-state";
import { WorkdayButtons } from "./workday-buttons";

// The signed-in person's workday clock, for payroll hours.
export async function WorkdayCard() {
  const [{ business }, clock] = await Promise.all([requireMembership(), getMyClock()]);
  return (
    <section className="panel workday-panel" aria-label="Workday">
      <div className="panel-body">
        <WorkdayButtons
          since={clock.workdayStartedAt}
          sinceText={clock.workdayStartedAt ? formatClock(clock.workdayStartedAt, business.time_zone) : null}
          onJob={clock.jobId !== null}
          start={startWorkday}
          end={endWorkday}
        />
      </div>
    </section>
  );
}
