import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Event detail lives in the home-page sheet (/?event=id); this route only exists so old/shared links keep working.
export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/?event=${encodeURIComponent(id)}`);
}
