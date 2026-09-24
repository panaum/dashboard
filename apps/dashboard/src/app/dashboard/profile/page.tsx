import { redirect } from "next/navigation";

// Renamed to Personalization; old links and bookmarks still land there.
export default function ProfileMoved() {
  redirect("/dashboard/personalization");
}
