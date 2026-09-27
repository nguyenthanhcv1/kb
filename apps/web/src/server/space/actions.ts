"use server";

import { createClient } from "@/lib/supabase/server";

import {
  SpaceError,
  archiveSpace as archiveSpaceCore,
  createSpace as createSpaceCore,
  getSpaceBySlug as getSpaceBySlugCore,
  listSpaces as listSpacesCore,
  updateSpace as updateSpaceCore,
  type ArchiveSpaceInput,
  type CreateSpaceInput,
  type GetSpaceBySlugInput,
  type ListSpacesInput,
  type ListSpacesOutput,
  type Space,
  type SpaceDb,
  type SpaceErrorCode,
  type UpdateSpaceInput,
} from "./index";

/**
 * Server Action wrappers of the T1.4a Space contract (`./index.ts`). Each action creates a
 * caller-scoped Supabase client (`@/lib/supabase/server`, never `@/lib/supabase/admin`) and
 * returns a plain, serializable result — Next.js Server Actions cannot return thrown `Error`
 * instances to the client, so every `SpaceError` is caught here and turned into `{ ok: false }`.
 */
export type SpaceActionResult<T> = { ok: true; data: T } | { ok: false; error: SpaceErrorCode };

async function runAction<T>(run: () => Promise<T>): Promise<SpaceActionResult<T>> {
  try {
    const data = await run();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof SpaceError) return { ok: false, error: error.code };
    throw error;
  }
}

/**
 * Supabase's ungenerated-schema client exposes a deeply recursive generic `from()` signature.
 * Narrow it at this boundary to the small structural contract used by the core module; keeping
 * the cast here avoids making every query instantiate the entire PostgREST type graph.
 */
function asSpaceDb(client: Awaited<ReturnType<typeof createClient>>): SpaceDb {
  return client as unknown as SpaceDb;
}

export async function listSpaces(
  input?: ListSpacesInput,
): Promise<SpaceActionResult<ListSpacesOutput>> {
  return runAction(async () => {
    const supabase = await createClient();
    return listSpacesCore(asSpaceDb(supabase), input);
  });
}

export async function getSpaceBySlug(
  input: GetSpaceBySlugInput,
): Promise<SpaceActionResult<Space | null>> {
  return runAction(async () => {
    const supabase = await createClient();
    return getSpaceBySlugCore(asSpaceDb(supabase), input);
  });
}

export async function createSpace(input: CreateSpaceInput): Promise<SpaceActionResult<Space>> {
  return runAction(async () => {
    const supabase = await createClient();
    return createSpaceCore(asSpaceDb(supabase), input);
  });
}

export async function updateSpace(input: UpdateSpaceInput): Promise<SpaceActionResult<Space>> {
  return runAction(async () => {
    const supabase = await createClient();
    return updateSpaceCore(asSpaceDb(supabase), input);
  });
}

export async function archiveSpace(input: ArchiveSpaceInput): Promise<SpaceActionResult<void>> {
  return runAction(async () => {
    const supabase = await createClient();
    return archiveSpaceCore(asSpaceDb(supabase), input);
  });
}
