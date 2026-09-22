import { label, type MemberRole } from "./constants";

// ONE FIELD, NOT TWO.
//
// `title` ("CEO") and `role` ("MANAGER") were separate fields on the member
// form because one is what it says on somebody's card and the other is what
// assignment lists read. In this team they say the same thing every time —
// QA Lead is a tester, Project Manager and CEO are managers, a Developer is a
// developer — and two fields that always agree are two chances to disagree.
//
// So the form offers a designation and the work role is derived from it.
// Neither column moved: `title` still stores the label, `role` still stores
// what every assignment list reads. No migration.
//
// Adding a job title is adding a line below. A title typed in free text before
// this change still displays and keeps whatever role it had — see saveMember.

export const DESIGNATIONS: readonly { title: string; role: MemberRole }[] = [
  { title: "Developer", role: "DEVELOPER" },
  { title: "Senior Developer", role: "DEVELOPER" },
  { title: "QA", role: "TESTER" },
  { title: "QA Lead", role: "TESTER" },
  { title: "Developer & QA", role: "BOTH" },
  { title: "Project Manager", role: "MANAGER" },
  { title: "CEO", role: "MANAGER" },
];

/** The work role a designation implies, or null if we have never heard of it. */
export function roleForDesignation(title: string | null | undefined): MemberRole | null {
  const t = title?.trim();
  if (!t) return null;
  return DESIGNATIONS.find((d) => d.title === t)?.role ?? null;
}

/** The single thing to show under someone's name. Their designation when they
 *  have one, and otherwise the plain role — never both, which was the
 *  complaint. */
export function memberLabel(member: { title?: string | null; role: string }): string {
  return member.title?.trim() || label(member.role);
}

/** The option to preselect: their own designation, or the closest stock one
 *  for the role they already have, so opening the dialog never silently
 *  changes anybody. */
export function designationFor(member: { title?: string | null; role: string }): string {
  const t = member.title?.trim();
  if (t) return t;
  return DESIGNATIONS.find((d) => d.role === member.role)?.title ?? DESIGNATIONS[0].title;
}
