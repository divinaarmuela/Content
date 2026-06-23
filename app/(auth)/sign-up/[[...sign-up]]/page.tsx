import { SignUp } from '@clerk/nextjs'
import './../../auth.css'

// Clerk's prebuilt component handles account creation, the required CAPTCHA/bot
// protection, email-code verification, session finalize and the post-signup
// redirect. The catch-all route ([[...sign-up]]) lets Clerk own its sub-paths
// (verification, OAuth callback). Branding/theme lives on the ClerkProvider in
// (auth)/layout.tsx.
export default function SignUpPage() {
  return (
    <SignUp
      path="/sign-up"
      signInUrl="/sign-in"
      fallbackRedirectUrl="/dashboard"
      forceRedirectUrl="/dashboard"
    />
  )
}
