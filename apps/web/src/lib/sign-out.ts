// ログアウトして、移り先へ遷移する。移り先は、IdP が end_session_endpoint を持てばその URL、持たなければ `fallbackUrl`。
// ページごと遷移するので、戻る操作で保護された画面が見えないよう、Cookie と HTTP cache はサーバーが
// `Clear-Site-Data` で捨てる (docs/adr/0022)。

interface SignOutResult {
  readonly data: { readonly url?: unknown } | null;
  readonly error: { readonly message?: string | undefined; readonly statusText: string } | null;
}

export async function signOutAndLeave(
  signOut: (options: { disableRedirect: true; callbackURL: string }) => Promise<SignOutResult>,
  assign: (url: string) => void,
  fallbackUrl: string,
): Promise<void> {
  const { data, error } = await signOut({ disableRedirect: true, callbackURL: fallbackUrl });
  if (error) throw new Error(`Sign out failed: ${error.message ?? error.statusText}`);
  assign(typeof data?.url === "string" ? data.url : fallbackUrl);
}
