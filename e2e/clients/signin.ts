// Signing a client in without the e-mail round trip.
//
// The local reticulum has real SMTP settings (admin > Server Settings > Email), so the UI sign-in would
// send an e-mail through that account to whatever address is typed in. Instead, reticulum itself finds
// or creates the test accounts, promotes the admin, and signs a token with the same Guardian call the
// e-mail link ends in; the token goes into the profile's local storage (___hubs_store, credentials),
// which is exactly where a finished sign-in leaves it. Never use the e-mail sign-in flow here.
import type { Page } from "@playwright/test";
import { BASE_URL } from "../lib/env";
import { elixir } from "../lib/stack";
import type { Account, AccountName } from "../lib/fixtures";
import type { Client } from "./launch";

export const ACCOUNT_EMAILS: Record<AccountName, string> = {
  admin: "admin@example.com",
  member1: "member1@example.com",
  member2: "member2@example.com"
};

export type SignedAccount = Account & { name: AccountName; token: string };

/**
 * Tokens are dated this much earlier than now. The long-running reticulum server's Erlang clock can lag
 * the container's clock (measured 163 s on this PC, after Docker Desktop corrected its VM clock), while
 * the short-lived `mix run` node that signs the token reads the current time; a token dated "now" is
 * then rejected as not yet valid ("invalid_token") until the server catches up. Accounts accept tokens
 * issued after min_token_issued_at, which is the epoch unless the account signed out everywhere.
 */
const BACKDATE_SECONDS = 600;

/** Finds or creates the accounts in reticulum (the admin promoted) and signs a fresh token for each */
export function mintTokens(names: AccountName[] = ["admin", "member1", "member2"]): Record<string, SignedAccount> {
  const list = names.map(n => `{"${n}", "${ACCOUNT_EMAILS[n]}", ${n === "admin"}}`).join(", ");
  const out = elixir(`
for {name, email, admin} <- [${list}] do
  account = Ret.Account.find_or_create_account_for_email(email)
  account = if admin and not account.is_admin, do: account |> Ecto.Changeset.change(is_admin: true) |> Ret.Repo.update!(), else: account
  {:ok, _, claims} = Ret.Guardian.encode_and_sign(account)
  claims = claims |> Map.update!("iat", &(&1 - ${BACKDATE_SECONDS})) |> Map.update!("nbf", &(&1 - ${BACKDATE_SECONDS}))
  {:ok, token} = Guardian.Token.Jwt.create_token(Ret.Guardian, claims)
  IO.puts("ACCOUNT\\t#{name}\\t#{email}\\t#{account.account_id}\\t#{account.is_admin}\\t#{token}")
end`);
  const result: Record<string, SignedAccount> = {};
  for (const line of out.split("\n").filter(l => l.startsWith("ACCOUNT\t"))) {
    const [, name, email, accountId, isAdmin, token] = line.trim().split("\t");
    result[name] = { name: name as AccountName, email, accountId, isAdmin: isAdmin === "true", token };
  }
  for (const n of names) if (!result[n]) throw new Error(`reticulum did not return a token for ${n}:\n${out.slice(-500)}`);
  return result;
}

type Credentials = { token?: string; email?: string };

async function storedCredentials(page: Page): Promise<Credentials> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("___hubs_store") || "{}").credentials ?? {});
}

async function storeCredentials(page: Page, credentials: Credentials) {
  await page.evaluate(credentials => {
    const state = JSON.parse(localStorage.getItem("___hubs_store") || "{}");
    state.credentials = credentials;
    localStorage.setItem("___hubs_store", JSON.stringify(state));
  }, credentials);
}

/** Whether reticulum accepts the token: an endpoint that needs a signed-in account */
async function tokenWorks(page: Page, token: string): Promise<boolean> {
  const res = await page.request.get(`${BASE_URL}/api/v1/projects`, { headers: { authorization: `bearer ${token}` } });
  return res.ok();
}

/**
 * Makes sure the client's profile is signed in as `account`. A profile keeps its sign-in between runs;
 * a new token is only signed (a few seconds in reticulum) when the stored one is missing, belongs to
 * another address or is no longer accepted. Leaves the page on the home page.
 */
export async function ensureSignedIn(client: Client, account: AccountName, minted?: Record<string, SignedAccount>) {
  const page = client.page;
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  const stored = await storedCredentials(page);
  const email = ACCOUNT_EMAILS[account];
  if (stored.email === email && stored.token && (await tokenWorks(page, stored.token))) return { refreshed: false };
  const signed = (minted ?? mintTokens([account]))[account];
  await storeCredentials(page, { token: signed.token, email: signed.email });
  await page.reload({ waitUntil: "domcontentloaded" });
  const after = await storedCredentials(page);
  if (after.email !== email) throw new Error(`sign-in of ${account} did not stick in ${client.name}'s profile`);
  if (!(await tokenWorks(page, signed.token))) throw new Error(`reticulum does not accept the new token of ${account}`);
  return { refreshed: true };
}

/** The token a signed-in client holds, for API calls made as that account */
export async function tokenOf(client: Client): Promise<string> {
  const { token } = await storedCredentials(client.page);
  if (!token) throw new Error(`${client.name} is not signed in`);
  return token;
}
