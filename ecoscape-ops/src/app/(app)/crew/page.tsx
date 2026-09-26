import type { Metadata } from "next";

import { ConfirmButton } from "@/components/confirm-button";
import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { getCrew } from "@/lib/crew";
import { formatShortDate, todayInTimeZone } from "@/lib/dates";
import { CLOSED_STATUSES } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { removeCrewMember, renameCrewMember } from "./actions";
import { AddCrewForm, NewInviteLinkButton, RenameCrewMember } from "./crew-forms";

export const metadata: Metadata = { title: "Crew · EcoScape Ops" };

const NOTICES: Record<string, string> = {
  removed: "Crew member removed. Their login no longer has access, and their jobs are now unassigned.",
  renamed: "Name updated.",
};

export default async function CrewPage(props: PageProps<"/crew">) {
  const { business, user } = await requireOwner();
  const { notice } = await props.searchParams;
  const crew = await getCrew(business.id, user.id);
  const today = todayInTimeZone(business.time_zone);

  // Upcoming open jobs per crew member, for the "remove" warning.
  const supabase = await createClient();
  const { data: upcoming } = await supabase
    .from("jobs")
    .select("assigned_crew_member_id")
    .eq("business_id", business.id)
    .gte("scheduled_date", today)
    .not("status", "in", `(${CLOSED_STATUSES.join(",")})`)
    .not("assigned_crew_member_id", "is", null);
  const upcomingFor = (id: string) => (upcoming ?? []).filter((j) => j.assigned_crew_member_id === id).length;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Crew</h1>
          <div className="meta">
            {crew.length} {crew.length === 1 ? "person" : "people"}
          </div>
        </div>
      </div>

      {typeof notice === "string" && NOTICES[notice] && <Notice tone="success">{NOTICES[notice]}</Notice>}

      <div className="panel">
        <div className="panel-body flush">
          <ul className="crew-list">
            {crew.map((member) => {
              const isOwner = member.user_id === user.id;
              const pending = !member.user_id;
              const expired = pending && member.invite_expires_at !== null && new Date(member.invite_expires_at) < new Date();
              const jobs = upcomingFor(member.id);
              return (
                <li key={member.id} className="crew-row" data-crew-member={member.name}>
                  <div className="crew-who">
                    <b>{member.name}</b>
                    {isOwner && <span className="date-tag">You · Owner</span>}
                    <div className="subtext">
                      {isOwner || !pending
                        ? member.email
                        : expired
                          ? "Invite expired — make a new link"
                          : `Invite pending${member.invite_expires_at ? ` · link expires ${formatShortDate(member.invite_expires_at.slice(0, 10))}` : ""}`}
                    </div>
                  </div>
                  <div className="crew-actions">
                    <RenameCrewMember action={renameCrewMember.bind(null, member.id)} current={member.name} />
                    {pending && <NewInviteLinkButton crewMemberId={member.id} name={member.name} />}
                    {!isOwner && (
                      <ConfirmButton
                        action={removeCrewMember.bind(null, member.id)}
                        label="Remove"
                        confirmLabel="Remove"
                        pendingLabel="Removing…"
                        confirmText={
                          <>
                            Remove <b>{member.name}</b>?{" "}
                            {pending ? "Their invite link will stop working." : "Their login loses access right away."}
                            {jobs > 0 && ` Their ${jobs} upcoming ${jobs === 1 ? "job becomes" : "jobs become"} unassigned.`}
                          </>
                        }
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <AddCrewForm />

      <p className="hint">
        Each crew member gets their own login and sees only the jobs assigned to them: no prices, no other customers,
        and nothing assigned to anyone else. Once you have more than one person on the crew, you can assign jobs when
        booking or editing them.
      </p>
    </>
  );
}
