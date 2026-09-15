// Where a capture came from, in words the frame can carry.
//
// The frame draws a recognisable handset — a Dynamic Island for an iPhone, a
// punch-hole for a Galaxy. That is a claim, and it may never claim more than
// the capture delivers. An accurate iPhone bezel around a Linux capture whose
// Apple fonts were substituted invites a reader to trust typography that was
// never Apple's, which is worse than a generic rectangle around the same
// pixels: the frame lends it credibility it has not earned.
//
// So provenance is permanent and next to the device, not a tooltip and not one
// row in a findings list. Nothing here decides whether a capture is good; it
// only says what it is, so a reader can decide.

export type RunProvenance = {
  backend?: string | null;
  host?: { platform?: string | null } | null;
};

export type DeviceProvenance = {
  fonts?: {
    appleSystemFontRequested?: boolean;
    appleSystemFontAuthentic?: boolean | null;
  } | null;
  findings?: { message?: string }[] | null;
};

export type FrameNote = {
  /** The permanent line under the device. Never empty. */
  label: string;
  /** The long form, for a title attribute. */
  detail: string;
  /** warn = the capture is less than the frame implies. */
  tone: "ok" | "warn";
};

/** The host, named the way a person would say it. */
export function hostName(platform?: string | null): string {
  if (!platform) return "";
  if (platform === "darwin") return "macOS";
  if (platform === "linux") return "Linux";
  return platform;
}

export type AppleFonts = "authentic" | "substituted" | "not-asked" | "unknown";

/** Did Apple's system face actually draw? Prefers the measurement the capture
 *  recorded; falls back to the finding, which is all an older run left. */
export function appleFonts(device: DeviceProvenance): AppleFonts {
  const f = device.fonts;
  if (f?.appleSystemFontRequested) {
    if (f.appleSystemFontAuthentic === true) return "authentic";
    if (f.appleSystemFontAuthentic === false) return "substituted";
    return "unknown";
  }
  // A run from before the measurement existed carries only the finding.
  const said = (device.findings ?? []).some((x) => /Apple's system font/i.test(x?.message ?? ""));
  if (said) return "substituted";
  return f ? "not-asked" : "unknown";
}

export function frameNote(device: DeviceProvenance, run: RunProvenance): FrameNote {
  const host = hostName(run.host?.platform);
  const where = host ? `${host} capture` : "Capture host not recorded";
  const fonts = appleFonts(device);

  if (fonts === "substituted") {
    return {
      label: `${where} — Apple fonts substituted`,
      detail: "This page asks for Apple's system font. It resolved to the fallback face on the "
            + "machine that rendered this capture, so the typography here is not Apple's, "
            + "whatever the frame around it looks like.",
      tone: "warn",
    };
  }
  if (fonts === "authentic") {
    return {
      label: `${where} — real Apple fonts`,
      detail: "This page asks for Apple's system font and it measured as actually drawing here.",
      tone: host ? "ok" : "warn",
    };
  }
  if (fonts === "unknown") {
    return {
      label: `${where} — font authenticity not measured`,
      detail: "This page asks for Apple's system font. This run did not record whether it drew, "
            + "so the typography cannot be vouched for either way.",
      tone: "warn",
    };
  }
  return {
    label: where,
    detail: host
      ? `Rendered by a real browser engine on ${host}. Device metrics are emulated: this is not a physical device.`
      : "This run did not record which machine rendered it.",
    tone: host ? "ok" : "warn",
  };
}
