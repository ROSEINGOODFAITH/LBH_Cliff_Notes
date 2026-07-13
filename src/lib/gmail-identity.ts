/**
 * Gmail sender identity + safety gate.
 *
 * All PULSE outbound email must go from the brand owner's Gmail,
 * davidt@laurelbathhouse.com. We reuse the existing refresh-token Gmail OAuth
 * (lib/gmail.ts) — no new credentials are added or exposed. Before any external
 * send we verify the CONNECTED Google identity actually matches the expected
 * sender; if it differs (wrong account reconnected), sending is blocked with a
 * reconnect message rather than silently mailing from the wrong mailbox.
 */
import { getEnv, integrations } from "@/lib/env";
import { getProfile, GmailError } from "@/lib/gmail";

/** The one mailbox PULSE is allowed to send from. */
export const EXPECTED_SENDER = "davidt@laurelbathhouse.com";

export type GmailIdentityStatus = "connected" | "wrong_account" | "not_connected" | "demo";

export interface GmailIdentity {
  status: GmailIdentityStatus;
  /** The mailbox we're actually connected to (null if unknown/not connected). */
  connectedEmail: string | null;
  expected: string;
  /** True only when it is safe to send external email right now. */
  canSend: boolean;
  message: string;
}

export class GmailIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailIdentityError";
  }
}

/**
 * Pure identity resolution — decides status/canSend from inputs so the decision
 * is unit-testable without network. `demo` short-circuits to a safe non-sending
 * state used when live Gmail can't be reached (spec B6).
 */
export function describeGmailIdentity(opts: {
  configured: boolean;
  connectedEmail: string | null;
  demo: boolean;
  expected?: string;
}): GmailIdentity {
  const expected = (opts.expected ?? EXPECTED_SENDER).toLowerCase();

  if (opts.demo) {
    return {
      status: "demo",
      connectedEmail: null,
      expected,
      canSend: false,
      message: `Demo mode — Gmail is not live. Drafts queue for ${expected}; no external email is sent.`,
    };
  }
  if (!opts.configured || !opts.connectedEmail) {
    return {
      status: "not_connected",
      connectedEmail: null,
      expected,
      canSend: false,
      message: `Gmail is not connected. Connect ${expected} to send.`,
    };
  }
  const connected = opts.connectedEmail.toLowerCase();
  if (connected !== expected) {
    return {
      status: "wrong_account",
      connectedEmail: connected,
      expected,
      canSend: false,
      message: `Connected to ${connected}, but PULSE sends only from ${expected}. Reconnect the correct account.`,
    };
  }
  return {
    status: "connected",
    connectedEmail: connected,
    expected,
    canSend: true,
    message: `Sending as ${expected}.`,
  };
}

function isDemoMode(): boolean {
  try {
    return getEnv().MOCK === "1" || !integrations.gmail();
  } catch {
    return true;
  }
}

/**
 * Resolve the live Gmail identity. In demo mode (MOCK or Gmail unconfigured) we
 * never touch the network and report a safe non-sending state. Otherwise we ask
 * Gmail whose mailbox the refresh token belongs to and compare it to the
 * expected sender.
 */
export async function getGmailIdentity(): Promise<GmailIdentity> {
  let configured = false;
  try {
    configured = integrations.gmail();
  } catch {
    configured = false;
  }

  let demo = false;
  try {
    demo = getEnv().MOCK === "1";
  } catch {
    demo = true;
  }
  if (demo || !configured) return describeGmailIdentity({ configured, connectedEmail: null, demo: demo || isDemoMode() });

  try {
    const profile = await getProfile();
    return describeGmailIdentity({ configured: true, connectedEmail: profile.emailAddress, demo: false });
  } catch (e) {
    // A live lookup failure is treated as not-connected (never as "connected").
    const msg = e instanceof GmailError ? `Gmail lookup failed (${e.status ?? "network"}).` : "Gmail lookup failed.";
    return { status: "not_connected", connectedEmail: null, expected: EXPECTED_SENDER, canSend: false, message: msg };
  }
}

/** Throw unless it is currently safe to send external email as the expected sender. */
export async function assertSenderAllowed(): Promise<GmailIdentity> {
  const id = await getGmailIdentity();
  if (!id.canSend) throw new GmailIdentityError(id.message);
  return id;
}
