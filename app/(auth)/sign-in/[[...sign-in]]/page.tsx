import { SignIn } from '@clerk/nextjs'
import './../../auth.css'

// Clerk's prebuilt component handles password, Google OAuth, CAPTCHA, device
// client-trust verification, email codes, session finalize and the post-login
// redirect/handshake. The catch-all route ([[...sign-in]]) lets Clerk own its
// sub-paths (OAuth callback, factor steps). Branding/theme lives on the
// ClerkProvider in (auth)/layout.tsx.
export default function SignInPage() {
  return (
    <SignIn
      path="/sign-in"
      signUpUrl="/sign-up"
      fallbackRedirectUrl="/dashboard"
      forceRedirectUrl="/dashboard"
    />
  )
}
