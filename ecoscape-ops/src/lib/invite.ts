// Invite tokens are 64 lowercase hex characters (see private.new_invite_token()).
export const isInviteToken = (token: string) => /^[0-9a-f]{64}$/.test(token);
