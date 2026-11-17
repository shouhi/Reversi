/**
 * Platform-wide identity and metadata constants. Change the name / tagline here
 * once and it updates the header, footer, and all SEO metadata.
 */
export const SITE_NAME = "ZEN GAMEBOX";
export const SITE_TAGLINE = "友達とURLを共有して遊べる、ブラウザゲーム集。";
export const SITE_DESCRIPTION =
  "登録不要・インストール不要。ルームを作って招待URLを送るだけで、友達とそれぞれの端末からブラウザゲームをオンライン対戦できます。";

/**
 * Absolute site origin, used as `metadataBase` for OGP / canonical URLs.
 * Prefers an explicit NEXT_PUBLIC_SITE_URL, then Vercel's auto-injected
 * production URL, and falls back to localhost for development. No manual env
 * setup is required on Vercel.
 */
export function getSiteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return new URL(explicit);

  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return new URL(`https://${vercel}`);

  return new URL("http://localhost:3000");
}
