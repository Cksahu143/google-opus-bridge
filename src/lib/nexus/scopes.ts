/**
 * Least-privilege scope catalog. Each entry is requested only because at least
 * one implemented capability needs it. Docs:
 * https://developers.google.com/identity/protocols/oauth2/scopes
 */
export const SCOPES = {
  openid: "openid",
  email: "https://www.googleapis.com/auth/userinfo.email",
  profile: "https://www.googleapis.com/auth/userinfo.profile",

  gmailReadonly: "https://www.googleapis.com/auth/gmail.readonly",
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
  gmailModify: "https://www.googleapis.com/auth/gmail.modify",

  drive: "https://www.googleapis.com/auth/drive",
  documents: "https://www.googleapis.com/auth/documents",
  spreadsheets: "https://www.googleapis.com/auth/spreadsheets",
  presentations: "https://www.googleapis.com/auth/presentations",

  calendar: "https://www.googleapis.com/auth/calendar",
  tasks: "https://www.googleapis.com/auth/tasks",
  contacts: "https://www.googleapis.com/auth/contacts",
  contactsReadonly: "https://www.googleapis.com/auth/contacts.readonly",

  meetings: "https://www.googleapis.com/auth/meetings.space.created",
  meetingsReadonly: "https://www.googleapis.com/auth/meetings.space.readonly",
  chatSpaces: "https://www.googleapis.com/auth/chat.spaces.readonly",
  chatMessages: "https://www.googleapis.com/auth/chat.messages",
  forms: "https://www.googleapis.com/auth/forms.body",
  formsResponses: "https://www.googleapis.com/auth/forms.responses.readonly",
  script: "https://www.googleapis.com/auth/script.projects",
  /**
   * Vertex AI (Lyria music, Imagen on Vertex). Requested only when the user
   * opts into the generative-media adapters, because it is broad.
   */
  cloudPlatform: "https://www.googleapis.com/auth/cloud-platform",
} as const;

export type ScopeKey = keyof typeof SCOPES;

/** Identity scopes are always requested so Nexus can name the account. */
export const BASE_SCOPES = [SCOPES.openid, SCOPES.email, SCOPES.profile];

export function uniqueScopes(scopes: string[]): string[] {
  return Array.from(new Set([...BASE_SCOPES, ...scopes])).sort();
}