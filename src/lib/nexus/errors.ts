export class NexusError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "NexusError";
    this.code = code;
    this.status = status;
  }
}

export const notConnected = () =>
  new NexusError(
    "google_not_connected",
    "No Google account is connected for this user. Connect Google in the Nexus dashboard first.",
    412,
  );

export const missingScope = (scopes: string[]) =>
  new NexusError(
    "google_scope_missing",
    `The connected Google account has not granted the permissions this operation needs (${scopes.join(", ")}). Re-connect Google and approve them.`,
    403,
  );

export const capabilityUnavailable = (capabilityId: string, reason: string) =>
  new NexusError("capability_unavailable", `${capabilityId} is not available: ${reason}`, 501);