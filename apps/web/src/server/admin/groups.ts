import { z } from "zod";

import { AdminError, dbError, parseInput, requireSuperAdmin, type AdminDb } from "./index";

/**
 * Group administration contract (super admins only): the groups of people ("KAS" and its members)
 * behind `/admin/groups`. A group grants nothing by itself; it is only a set of internal users.
 * Every function re-checks the caller (`FORBIDDEN`), and Postgres checks again in each
 * `admin_*_group*` function; changes are audited (`group.*`).
 *
 * ```ts
 * const { groups } = await listGroups(db);
 * const { groupId } = await createGroup(db, { name: "KAS" });
 * await addGroupMembers(db, { groupId, userIds: [anId] });
 * ```
 */

export const GROUP_NAME_MAX = 80;
export const GROUP_DESCRIPTION_MAX = 500;
export const GROUP_MEMBERS_BATCH_MAX = 100;
export const GROUP_SEARCH_MAX = 200;

export const groupSchema = z.object({
  id: z.guid(),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z.number().int(),
  /** ISO 8601 (UTC). */
  createdAt: z.string(),
});
export type Group = z.infer<typeof groupSchema>;

export const groupMemberSchema = z.object({
  userId: z.guid(),
  email: z.string(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** ISO 8601 (UTC). */
  addedAt: z.string(),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const groupCandidateSchema = groupMemberSchema.omit({ addedAt: true });
export type GroupCandidate = z.infer<typeof groupCandidateSchema>;

export const listGroupsOutputSchema = z.object({ groups: z.array(groupSchema) });
export type ListGroupsOutput = z.infer<typeof listGroupsOutputSchema>;

export const listGroupsExample: ListGroupsOutput = {
  groups: [
    {
      id: "7a0f0000-0000-4000-8000-000000000001",
      name: "KAS",
      description: "Key account sales",
      memberCount: 12,
      createdAt: "2026-10-12T02:00:00+00:00",
    },
  ],
};

const nameSchema = z.string().trim().min(1).max(GROUP_NAME_MAX);
const descriptionSchema = z.string().trim().max(GROUP_DESCRIPTION_MAX).optional();

export const createGroupInputSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
});
export type CreateGroupInput = z.input<typeof createGroupInputSchema>;

export const createGroupOutputSchema = z.object({ groupId: z.guid() });
export type CreateGroupOutput = z.infer<typeof createGroupOutputSchema>;

export const updateGroupInputSchema = z.object({
  groupId: z.guid(),
  name: nameSchema,
  description: descriptionSchema,
});
export type UpdateGroupInput = z.input<typeof updateGroupInputSchema>;

export const groupIdInputSchema = z.object({ groupId: z.guid() });
export type GroupIdInput = z.input<typeof groupIdInputSchema>;

export const getGroupOutputSchema = z.object({
  group: groupSchema,
  members: z.array(groupMemberSchema),
});
export type GetGroupOutput = z.infer<typeof getGroupOutputSchema>;

export const deleteGroupOutputSchema = z.object({
  /** How many people the group had: they lose what it granted. */
  removedMembers: z.number().int(),
});
export type DeleteGroupOutput = z.infer<typeof deleteGroupOutputSchema>;

export const addGroupMembersInputSchema = z.object({
  groupId: z.guid(),
  userIds: z.array(z.guid()).min(1).max(GROUP_MEMBERS_BATCH_MAX),
});
export type AddGroupMembersInput = z.input<typeof addGroupMembersInputSchema>;

export const addGroupMembersOutputSchema = z.object({
  /** People actually added (those already in the group are skipped). */
  added: z.number().int(),
});
export type AddGroupMembersOutput = z.infer<typeof addGroupMembersOutputSchema>;

export const removeGroupMemberInputSchema = z.object({
  groupId: z.guid(),
  userId: z.guid(),
});
export type RemoveGroupMemberInput = z.input<typeof removeGroupMemberInputSchema>;

export const searchGroupCandidatesInputSchema = z.object({
  groupId: z.guid(),
  /** Fragment of a name or email, accents ignored. */
  query: z.string().trim().min(1).max(GROUP_SEARCH_MAX),
  limit: z.number().int().min(1).max(50).default(10),
});
export type SearchGroupCandidatesInput = z.input<typeof searchGroupCandidatesInputSchema>;

export const searchGroupCandidatesOutputSchema = z.object({
  candidates: z.array(groupCandidateSchema),
});
export type SearchGroupCandidatesOutput = z.infer<typeof searchGroupCandidatesOutputSchema>;

const groupRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  member_count: z.number(),
  created_at: z.string(),
});

const memberRowSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  full_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  added_at: z.string(),
});

const candidateRowSchema = memberRowSchema.omit({ added_at: true });

function mapGroup(row: z.infer<typeof groupRowSchema>): Group {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    memberCount: row.member_count,
    createdAt: row.created_at,
  };
}

async function rpc(db: AdminDb, fn: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw dbError(error);
  return data;
}

async function fetchGroups(db: AdminDb): Promise<Group[]> {
  return z
    .array(groupRowSchema)
    .parse((await rpc(db, "admin_list_groups")) ?? [])
    .map(mapGroup);
}

/**
 * Every group with its member count, by name.
 *
 * @throws {AdminError} `FORBIDDEN`, `ADMIN_ACTION_FAILED`.
 */
export async function listGroups(db: AdminDb): Promise<ListGroupsOutput> {
  await requireSuperAdmin(db);
  return { groups: await fetchGroups(db) };
}

/**
 * One group and its members (by name).
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `GROUP_NOT_FOUND`, `ADMIN_ACTION_FAILED`.
 */
export async function getGroup(db: AdminDb, input: GroupIdInput): Promise<GetGroupOutput> {
  const { groupId } = parseInput(groupIdInputSchema, input);
  await requireSuperAdmin(db);
  const rows = await rpc(db, "admin_list_group_members", { p_group_id: groupId });
  const group = (await fetchGroups(db)).find((g) => g.id === groupId);
  if (!group) throw new AdminError("GROUP_NOT_FOUND");
  const members = z
    .array(memberRowSchema)
    .parse(rows ?? [])
    .map((row) => ({
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      avatarUrl: row.avatar_url,
      addedAt: row.added_at,
    }));
  return { group, members };
}

/**
 * Creates a group (names are unique ignoring case). Audited as `group.create`.
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `GROUP_NAME_TAKEN`, `ADMIN_ACTION_FAILED`.
 */
export async function createGroup(
  db: AdminDb,
  input: CreateGroupInput,
): Promise<CreateGroupOutput> {
  const { name, description } = parseInput(createGroupInputSchema, input);
  await requireSuperAdmin(db);
  const id = await rpc(db, "admin_create_group", {
    p_name: name,
    p_description: description || null,
  });
  return { groupId: z.guid().parse(id) };
}

/**
 * Renames a group / changes its description (an empty description clears it). Audited as
 * `group.update`.
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `GROUP_NOT_FOUND`, `GROUP_NAME_TAKEN`,
 *   `ADMIN_ACTION_FAILED`.
 */
export async function updateGroup(db: AdminDb, input: UpdateGroupInput): Promise<void> {
  const { groupId, name, description } = parseInput(updateGroupInputSchema, input);
  await requireSuperAdmin(db);
  await rpc(db, "admin_update_group", {
    p_group_id: groupId,
    p_name: name,
    p_description: description || null,
  });
}

/**
 * Deletes a group; its members lose whatever it granted at once. Audited as `group.delete`.
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `GROUP_NOT_FOUND`, `ADMIN_ACTION_FAILED`.
 */
export async function deleteGroup(db: AdminDb, input: GroupIdInput): Promise<DeleteGroupOutput> {
  const { groupId } = parseInput(groupIdInputSchema, input);
  await requireSuperAdmin(db);
  const removed = await rpc(db, "admin_delete_group", { p_group_id: groupId });
  return { removedMembers: z.number().int().parse(removed) };
}

/**
 * Adds internal users to a group. All or nothing: one person who cannot join (guest, pending,
 * locked) fails the call. Audited as `group.member_add`, once per person.
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `GROUP_NOT_FOUND`, `USER_NOT_FOUND`,
 *   `GROUP_MEMBER_NOT_INTERNAL`, `ADMIN_ACTION_FAILED`.
 */
export async function addGroupMembers(
  db: AdminDb,
  input: AddGroupMembersInput,
): Promise<AddGroupMembersOutput> {
  const { groupId, userIds } = parseInput(addGroupMembersInputSchema, input);
  await requireSuperAdmin(db);
  const added = await rpc(db, "admin_add_group_members", {
    p_group_id: groupId,
    p_user_ids: [...new Set(userIds)],
  });
  return { added: z.number().int().parse(added) };
}

/**
 * Removes a person from a group (idempotent). Audited as `group.member_remove`.
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `GROUP_NOT_FOUND`, `ADMIN_ACTION_FAILED`.
 */
export async function removeGroupMember(db: AdminDb, input: RemoveGroupMemberInput): Promise<void> {
  const { groupId, userId } = parseInput(removeGroupMemberInputSchema, input);
  await requireSuperAdmin(db);
  await rpc(db, "admin_remove_group_member", { p_group_id: groupId, p_user_id: userId });
}

/**
 * Active internal users who are not in the group yet and match `query` (accent-insensitive).
 *
 * @throws {AdminError} `VALIDATION_FAILED`, `FORBIDDEN`, `GROUP_NOT_FOUND`, `ADMIN_ACTION_FAILED`.
 */
export async function searchGroupCandidates(
  db: AdminDb,
  input: SearchGroupCandidatesInput,
): Promise<SearchGroupCandidatesOutput> {
  const { groupId, query, limit } = parseInput(searchGroupCandidatesInputSchema, input);
  await requireSuperAdmin(db);
  const rows = await rpc(db, "admin_search_group_candidates", {
    p_group_id: groupId,
    p_query: query,
    p_limit: limit,
  });
  return {
    candidates: z
      .array(candidateRowSchema)
      .parse(rows ?? [])
      .map((row) => ({
        userId: row.user_id,
        email: row.email,
        fullName: row.full_name,
        avatarUrl: row.avatar_url,
      })),
  };
}
