import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Access token for the collab WebSocket (T3.5). The Supabase session lives in httpOnly cookies the
 * browser script cannot read, so the editor asks here — at connect and again before it expires.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: noStore });
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: noStore });
  }
  return NextResponse.json(
    {
      token: data.session.access_token,
      expiresAt: (data.session.expires_at ?? 0) * 1000,
    },
    { headers: noStore },
  );
}

const noStore = { "cache-control": "no-store" };
