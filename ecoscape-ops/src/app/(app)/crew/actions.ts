"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { siteOrigin } from "@/lib/site-origin";
import { createClient } from "@/lib/supabase/server";

const crewName = z.string().trim().min(1, "Enter their name").max(80, "Name must be 80 characters or fewer");
const uuid = z.uuid();

const inviteUrl = async (token: string) => `${await siteOrigin()}/join/${token}`;

export type AddCrewState = { error?: string; name?: string; inviteUrl?: string };

export async function addCrewMember(_prev: AddCrewState, formData: FormData): Promise<AddCrewState> {
  await requireOwner();
  const parsed = crewName.safeParse(formData.get("name") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_crew_member", { member_name: parsed.data }).single();
  if (error || !data) {
    console.error("Add crew member failed", error);
    return { error: "We couldn't add this crew member. Please try again." };
  }

  refresh();
  return { name: parsed.data, inviteUrl: await inviteUrl(data.invite_token) };
}

export type InviteLinkState = { error?: string; inviteUrl?: string };

export async function newInviteLink(crewMemberId: string): Promise<InviteLinkState> {
  await requireOwner();
  if (!uuid.safeParse(crewMemberId).success) return { error: "This crew member no longer exists." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("regenerate_crew_invite", { crew_member_id: crewMemberId });
  if (error || !data) {
    if (error?.code === "P0002") return { error: "They've already joined, or were removed." };
    console.error("New invite link failed", error);
    return { error: "We couldn't make a new link. Please try again." };
  }

  refresh();
  return { inviteUrl: await inviteUrl(data) };
}

export type RenameState = { error?: string; value?: string };

export async function renameCrewMember(crewMemberId: string, _prev: RenameState, formData: FormData): Promise<RenameState> {
  await requireOwner();
  const value = String(formData.get("name") ?? "");
  const parsed = crewName.safeParse(value);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, value };
  if (!uuid.safeParse(crewMemberId).success) return { error: "This crew member no longer exists.", value };

  const supabase = await createClient();
  const { data, error } = await supabase.from("crew_members").update({ name: parsed.data }).eq("id", crewMemberId).select("id");
  if (error || data.length === 0) {
    if (error) console.error("Rename crew member failed", error);
    return { error: "We couldn't rename this crew member. Please try again.", value };
  }

  redirect("/crew?notice=renamed");
}

export async function removeCrewMember(crewMemberId: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(crewMemberId).success) return { error: "This crew member no longer exists." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_crew_member", { crew_member_id: crewMemberId });
  if (error) {
    if (error.code === "P0002") return { error: "This crew member no longer exists." };
    if (error.code === "42501") return { error: "The owner can't be removed from the crew." };
    console.error("Remove crew member failed", error);
    return { error: "We couldn't remove this crew member. Please try again." };
  }

  redirect("/crew?notice=removed");
}
