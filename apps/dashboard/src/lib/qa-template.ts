// Standard QA checklist — mirrors "Live Checklist LLUM LP".
// Used to seed QACheckItem rows when a certificate is created.

export type QATemplateItem = {
  name: string;
  hasDualValue?: boolean; // Desktop + Mobile result columns
  isMeasurement?: boolean; // free-text measured value
};

export type QATemplateCategory = {
  category: string;
  items: QATemplateItem[];
};

export const QA_TEMPLATE: QATemplateCategory[] = [
  {
    category: "Performance",
    items: [
      { name: "GTMetrix Page Load Time", isMeasurement: true },
      { name: "GTMetrix Page Size", isMeasurement: true },
      { name: "Images compressed" },
      { name: "SSL Certificate showing up correctly" },
      { name: "CNAME setup" },
      { name: "Verify Integrations" },
      { name: "Google Page Speed", hasDualValue: true, isMeasurement: true },
    ],
  },
  {
    category: "Functional",
    items: [
      { name: "Form Submits Correctly" },
      { name: "Field Names Setup Correctly" },
      { name: "Browser Test — Chrome", hasDualValue: true },
      { name: "Browser Test — Firefox", hasDualValue: true },
      { name: "Browser Test — IE / Edge", hasDualValue: true },
      { name: "Browser Test — Safari", hasDualValue: true },
      { name: "Check Form Validation" },
      { name: "Hidden Fields Added" },
      { name: "Form Field Names Checked" },
    ],
  },
  {
    category: "Tracking",
    items: [
      { name: "Thank You Page Correctly Setup" },
      { name: "Facebook Pixel Installed" },
      { name: "Google Analytics Installed" },
      { name: "Google Adwords Installed" },
      { name: "Email Recipient" },
      { name: "Email Removed" },
    ],
  },
  {
    category: "UX",
    items: [
      { name: "Favicon Installed" },
      { name: "SEO Title and description added" },
      { name: "Social Graph Tags installed" },
      { name: "Spell Checked" },
      { name: "All CTA buttons work" },
      { name: "Privacy Page Added" },
      { name: "Copyright year up to date" },
      { name: "View source code for uneven spacing" },
      { name: "VPN Testing" },
      { name: "No Dummy Copy / Video / Images" },
      { name: "Header Tags" },
      { name: "Reset Stats" },
      { name: "Assets (Favicon, Images) on live URL" },
      { name: "Add Page to Apexure Portfolio" },
    ],
  },
  {
    category: "Conversion Goals",
    items: [
      { name: "Goals to be checked" },
      { name: "Add URL to Sitemap" },
    ],
  },
];

// Flat list with stable ordering, ready for prisma createMany.
export function buildChecklistItems(certificateId: string) {
  let order = 0;
  return QA_TEMPLATE.flatMap((group) =>
    group.items.map((item) => ({
      certificateId,
      category: group.category,
      name: item.name,
      result: "NA",
      hasDualValue: item.hasDualValue ?? false,
      isMeasurement: item.isMeasurement ?? false,
      order: order++,
    })),
  );
}
