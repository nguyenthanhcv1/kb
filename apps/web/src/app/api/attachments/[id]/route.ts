import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { AttachmentError, getAttachmentUrl } from "@/server/attachments";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stable address of an attachment (T3.6b). Pages store `/api/attachments/<id>` — never a signed
 * URL, which expires — and this route checks the viewer's access (RLS) and redirects to a
 * short-lived signed URL. `?download=1` saves the file under its original name.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "ATTACHMENT_NOT_FOUND" }, { status: 404 });

  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const { url } = await getAttachmentUrl(supabase, {
      attachmentId: id,
      download: request.nextUrl.searchParams.get("download") === "1",
    });
    // The signed URL is valid for an hour; the browser may reuse this redirect for a few minutes.
    return NextResponse.redirect(url, {
      status: 307,
      headers: { "cache-control": "private, max-age=300" },
    });
  } catch (error) {
    if (error instanceof AttachmentError && error.code === "ATTACHMENT_NOT_FOUND") {
      return NextResponse.json({ error: error.code }, { status: 404 });
    }
    console.error("[attachments] cannot sign url", error);
    return NextResponse.json({ error: "ATTACHMENT_UPLOAD_FAILED" }, { status: 500 });
  }
}
