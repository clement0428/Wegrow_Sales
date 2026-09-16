import Avatar from "./Avatar";
import type { RegistrationWithMember } from "@/lib/db/queries";

export default function RosterList({ registrations, organizerId }: { registrations: RegistrationWithMember[]; organizerId: string }) {
  const confirmed = registrations.filter((r) => r.status === "confirmed");
  const waitlisted = registrations.filter((r) => r.status === "waitlisted");
  const Row = ({ r, tag }: { r: RegistrationWithMember; tag?: string }) => (
    <li className="flex items-center gap-3 py-2">
      <Avatar src={r.member.picture_url} name={r.member.display_name} />
      <span className="flex-1 font-semibold">{r.member.display_name}</span>
      {r.member.id === organizerId && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">開場者</span>}
      {tag && <span className="text-xs text-orange-500">{tag}</span>}
    </li>
  );
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h3 className="font-bold text-gray-500">正取 {confirmed.length}</h3>
      <ul className="divide-y">{confirmed.map((r) => <Row key={r.id} r={r} />)}</ul>
      {waitlisted.length > 0 && (<>
        <h3 className="mt-3 font-bold text-gray-500">候補 {waitlisted.length}</h3>
        <ul className="divide-y">{waitlisted.map((r, i) => <Row key={r.id} r={r} tag={`候補 ${i + 1}`} />)}</ul>
      </>)}
    </div>
  );
}
