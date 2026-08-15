import { z } from "zod";

import { SCOPES } from "@/lib/nexus/scopes";
import { defineAdapter, defineCapability } from "@/lib/nexus/types";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/** Sheets API v4 — https://developers.google.com/workspace/sheets/api/reference/rest */
export const sheetsAdapter = defineAdapter({
  service: "sheets",
  label: "Google Sheets",
  description: "Read, write and append spreadsheet values with the official Sheets API.",
  status: "supported",
  statusNote: "Official Sheets API v4 (values read/write/append, create, metadata).",
  docsUrl: "https://developers.google.com/workspace/sheets/api/reference/rest",
  capabilities: [
    defineCapability({
      id: "sheets.create",
      title: "Create a spreadsheet",
      description: "Create a spreadsheet with an optional first sheet title.",
      implementation: "google-rest-api",
      scopes: [SCOPES.spreadsheets],
      mutating: true,
      input: z.object({ title: z.string().min(1), sheetTitle: z.string().optional() }),
      run: async (ctx, input) => {
        const created = await ctx.api<{ spreadsheetId: string; spreadsheetUrl: string }>(BASE, {
          body: {
            properties: { title: input.title },
            ...(input.sheetTitle
              ? { sheets: [{ properties: { title: input.sheetTitle } }] }
              : {}),
          },
        });
        return { spreadsheetId: created.spreadsheetId, url: created.spreadsheetUrl };
      },
    }),
    defineCapability({
      id: "sheets.describe",
      title: "Describe a spreadsheet",
      description: "List the tabs (sheet names, ids and grid sizes) of a spreadsheet.",
      implementation: "google-rest-api",
      scopes: [SCOPES.spreadsheets],
      input: z.object({ spreadsheetId: z.string().min(1) }),
      run: async (ctx, input) => {
        const res = await ctx.api<{
          properties: { title: string };
          sheets: { properties: { sheetId: number; title: string; gridProperties?: unknown } }[];
        }>(`${BASE}/${input.spreadsheetId}?fields=properties(title),sheets(properties)`);
        return {
          title: res.properties.title,
          sheets: res.sheets.map((sheet) => sheet.properties),
        };
      },
    }),
    defineCapability({
      id: "sheets.read_range",
      title: "Read a range",
      description: "Read cell values from an A1 range such as 'Sheet1!A1:D50'.",
      implementation: "google-rest-api",
      scopes: [SCOPES.spreadsheets],
      input: z.object({ spreadsheetId: z.string().min(1), range: z.string().min(1) }),
      run: (ctx, input) =>
        ctx.api(`${BASE}/${input.spreadsheetId}/values/${encodeURIComponent(input.range)}`),
    }),
    defineCapability({
      id: "sheets.write_range",
      title: "Write a range",
      description: "Overwrite cell values in an A1 range with a 2D array of values.",
      implementation: "google-rest-api",
      scopes: [SCOPES.spreadsheets],
      mutating: true,
      input: z.object({
        spreadsheetId: z.string().min(1),
        range: z.string().min(1),
        values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/${input.spreadsheetId}/values/${encodeURIComponent(input.range)}?valueInputOption=USER_ENTERED`,
          { method: "PUT", body: { values: input.values } },
        ),
    }),
    defineCapability({
      id: "sheets.append_rows",
      title: "Append rows",
      description: "Append rows after the last row of a range or table.",
      implementation: "google-rest-api",
      scopes: [SCOPES.spreadsheets],
      mutating: true,
      input: z.object({
        spreadsheetId: z.string().min(1),
        range: z.string().min(1),
        values: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
      }),
      run: (ctx, input) =>
        ctx.api(
          `${BASE}/${input.spreadsheetId}/values/${encodeURIComponent(input.range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          { body: { values: input.values } },
        ),
    }),
  ],
});

export default sheetsAdapter;