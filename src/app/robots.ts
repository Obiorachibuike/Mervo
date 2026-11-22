import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "https://mervo.app";
  return {
    rules: [
      { userAgent: "*", allow: ["/", "/pricing"], disallow: ["/dashboard", "/pos", "/settings", "/admin", "/api", "/receipt", "/store"] },
    ],
    sitemap: `${base.replace(/\/$/, "")}/sitemap.xml`,
  };
}
