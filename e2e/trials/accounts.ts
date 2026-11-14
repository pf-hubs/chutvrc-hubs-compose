// Trial helper: local test accounts without the e-mail round trip.
//
// The local reticulum has SMTP settings in its server config (admin > Server Settings > Email), so
// the UI sign-in would send a real e-mail through that account to the address typed in. Instead this
// creates (or finds) the accounts in reticulum, promotes the admin, makes a sign-in token for each
// with the same Guardian call the e-mail link ends in, and stores it in the profile's local storage
// (key ___hubs_store, credentials.token/email), which is where a completed sign-in leaves it.
//   npx tsx trials/accounts.ts            # admin, member1, member2 -> profiles/trial-<name>
import { execFileSync } from "node:child_process";
import { BASE, COMPOSE_ROOT, firstPage, launchClient, readFixtures, writeFixtures } from "./common";

const accounts: Record<string, string> = {
  admin: "admin@example.com",
  member1: "member1@example.com",
  member2: "member2@example.com"
};

const elixir = `
for {email, admin} <- [${Object.entries(accounts)
  .map(([name, email]) => `{"${email}", ${name === "admin"}}`)
  .join(", ")}] do
  account = Ret.Account.find_or_create_account_for_email(email)
  account = if admin and not account.is_admin, do: account |> Ecto.Changeset.change(is_admin: true) |> Ret.Repo.update!(), else: account
  {:ok, token, _} = Ret.Guardian.encode_and_sign(account)
  IO.puts("ACCOUNT\\t#{email}\\t#{account.account_id}\\t#{account.is_admin}\\t#{token}")
end
`;

const out = execFileSync("docker", ["compose", "exec", "-T", "reticulum", "mix", "run", "--no-compile", "-e", elixir], {
  cwd: COMPOSE_ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"]
});
const rows = out
  .split("\n")
  .filter(l => l.startsWith("ACCOUNT\t"))
  .map(l => l.split("\t"));

const fixtures = readFixtures();
for (const [, email, accountId, isAdmin, token] of rows) {
  const name = Object.keys(accounts).find(k => accounts[k] === email)!;
  fixtures.accounts[name] = { email, accountId, isAdmin: isAdmin === "true", profile: `trial-${name}` };
  const context = await launchClient("desk1", { profile: `trial-${name}`, headless: true });
  const page = await firstPage(context);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ token, email }) => {
      const key = "___hubs_store";
      const state = JSON.parse(localStorage.getItem(key) || "{}");
      state.credentials = { token, email };
      localStorage.setItem(key, JSON.stringify(state));
    },
    { token, email }
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const signedIn = await page.evaluate(() => JSON.parse(localStorage.getItem("___hubs_store") || "{}").credentials?.email);
  console.log(name, email, "account", accountId, "admin", isAdmin, "stored for", signedIn);
  await context.close();
}
writeFixtures(fixtures);
