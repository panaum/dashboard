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
  { title: "Head of Accounts", role: "MANAGER" },
  { title: "Chief Delivery Officer", role: "MANAGER" },
  { title: "CEO", role: "MANAGER" },
];

/**
 * The order the management block reads in, most senior first. Everything else
 * on this page is sorted by name, which put the CEO wherever the alphabet felt
 * like putting him.
 *
 * It is a separate list from DESIGNATIONS on purpose. That one runs the other
 * way — junior first — because it is a dropdown, and because designationFor()
 * takes the FIRST entry matching a role as the sensible default for somebody
 * who has no title yet. Reordering DESIGNATIONS to put the CEO on top would
 * quietly make "CEO" the default designation for every new manager.
 *
 * A manager whose title is not listed here sorts after the ones that are,
 * by name. Nobody vanishes for want of a line in this array.
 */
export const MANAGEMENT_ORDER: readonly string[] = [
  "CEO",
  "Chief Delivery Officer",
  "Head of Accounts",
  "Project Manager",
];

export function compareManagement(
  a: { name: string; title?: string | null; role: string },
  b: { name: string; title?: string | null; role: string },
): number {
  const rank = (m: typeof a) => {
    const i = MANAGEMENT_ORDER.indexOf(memberLabel(m));
    return i === -1 ? MANAGEMENT_ORDER.length : i;
  };
  return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

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
