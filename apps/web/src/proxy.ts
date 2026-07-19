import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_PATHS = new Set(["/login", "/sign-up"]);

/**
 * Next.js proxy (middleware) that runs on every request matched by `config.matcher`.
 *
 * It keeps the Supabase auth session alive by calling `supabase.auth.getUser()`,
 * which validates the session and refreshes expired auth tokens, writing the
 * updated cookies back onto both the request and the response.
 *
 * It also redirects already-authenticated users away from the auth pages
 * (/login, /sign-up) to /dashboard, carrying over any refreshed session cookies.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // Middleware-specific Supabase client (distinct from lib/supabase/server.ts,
  // which is for Server Components / Route Handlers). Middleware is the only
  // place that can write refreshed auth cookies back to the browser, so this
  // client syncs them onto both the request and the outgoing response.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && AUTH_PATHS.has(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie.name, cookie.value);
    });
    return redirectResponse;
  }

  return supabaseResponse;
}

export const config = {
  // Match all paths except Next.js internals (_next/static, _next/image),
  // favicon.ico, and common image files (svg, png, jpg, jpeg, gif, webp),
  // so the middleware skips static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
