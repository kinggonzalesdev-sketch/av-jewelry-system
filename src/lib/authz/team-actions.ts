'use server';

import { revalidatePath } from 'next/cache';

import {
  changeMyPassword,
  createTeamMember,
  deleteTeamMember,
  setTeamMemberPassword,
} from '@/lib/authz/team-accounts';
import type { TeamActionState } from '@/lib/authz/team-action-state';

/**
 * Team Members portal actions (transport only). Authority — Owner-only for the
 * admin operations — is enforced in the domain module and the service-role
 * boundary, never here.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function addTeamMemberAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const result = await createTeamMember({
    fullName: text(formData, 'fullName') ?? '',
    email: text(formData, 'email') ?? '',
  });
  if (!result.ok) return { error: result.error, success: null, reveal: null };

  revalidatePath('/settings');
  return {
    error: null,
    success: `Added ${result.email}. Give them the temporary password below.`,
    reveal: { email: result.email, tempPassword: result.tempPassword },
  };
}

export async function setTeamPasswordAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const staffProfileId = text(formData, 'staffProfileId');
  if (!staffProfileId) {
    return { error: 'Missing team member.', success: null, reveal: null };
  }
  const result = await setTeamMemberPassword(
    staffProfileId,
    text(formData, 'newPassword') ?? '',
  );
  if (!result.ok) return { error: result.error, success: null, reveal: null };

  revalidatePath('/settings');
  return {
    error: null,
    success: result.self
      ? 'Your password was set.'
      : `Password set for ${result.email}. They can change it themselves at sign-in.`,
    reveal: null,
  };
}

export async function deleteTeamMemberAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const staffProfileId = text(formData, 'staffProfileId');
  if (!staffProfileId) {
    return { error: 'Missing team member.', success: null, reveal: null };
  }
  const result = await deleteTeamMember(staffProfileId);
  if (!result.ok) return { error: result.error, success: null, reveal: null };

  revalidatePath('/settings');
  return { error: null, success: 'Team member deleted.', reveal: null };
}

export async function changeMyPasswordAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const result = await changeMyPassword(text(formData, 'newPassword') ?? '');
  if (!result.ok) return { error: result.error, success: null, reveal: null };

  revalidatePath('/settings');
  return { error: null, success: 'Your password was changed.', reveal: null };
}
