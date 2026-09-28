import { redirect } from "next/navigation";

/** `/admin` → its first section. */
export default function AdminPage() {
  redirect("/admin/access");
}
