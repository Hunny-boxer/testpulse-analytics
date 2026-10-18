import { useState, type FormEvent } from "react";
import { supabase } from "./supabase";

type AuthMode = "sign-in" | "sign-up";

type AuthProps = {
  onAuthenticated?: () => void;
};

const authStyles = `
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px 16px;
  color: #eee8f9;
  background:
    radial-gradient(ellipse at 50% 0%, rgba(139,92,246,.15), transparent 55%),
    #0e0a16;
  font-family: Inter, system-ui, sans-serif;
}
.auth-card {
  width: min(100%, 420px);
  padding: 32px;
  border: 1px solid rgba(190,166,255,.17);
  border-radius: 18px;
  background: rgba(22,16,33,.96);
  box-shadow: 0 24px 80px rgba(0,0,0,.3);
}
.auth-brand {
  display: flex;
  align-items: center;
  gap: 11px;
  margin-bottom: 32px;
}
.auth-brand-mark {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg,#a78bfa,#7c4de8);
  color: white;
  font-size: 23px;
  font-weight: 800;
}
.auth-brand-name {
  font-size: 22px;
  font-weight: 750;
  letter-spacing: -.7px;
}
.auth-brand-name span {
  color: #a78bfa;
}
.auth-eyebrow {
  margin: 0 0 9px;
  color: #a78bfa;
  font-size: 10px;
  font-weight: 750;
  letter-spacing: 1.5px;
}
.auth-title {
  margin: 0;
  color: #f5f0ff;
  font-size: 27px;
  font-weight: 700;
  letter-spacing: -.8px;
}
.auth-description {
  margin: 10px 0 24px;
  color: #a39ab4;
  font-size: 13px;
  line-height: 1.65;
}
.auth-form {
  display: grid;
  gap: 16px;
}
.auth-field {
  display: grid;
  gap: 7px;
  color: #d7cfe5;
  font-size: 12px;
  font-weight: 600;
}
.auth-field input {
  box-sizing: border-box;
  width: 100%;
  min-height: 45px;
  padding: 11px 12px;
  border: 1px solid rgba(190,166,255,.2);
  border-radius: 8px;
  outline: none;
  background: #100c19;
  color: #f4efff;
  font: inherit;
  font-size: 13px;
}
.auth-field input::placeholder {
  color: #70677f;
}
.auth-field input:focus {
  border-color: #a78bfa;
  box-shadow: 0 0 0 3px rgba(167,139,250,.12);
}
.auth-submit {
  min-height: 45px;
  margin-top: 3px;
  padding: 12px;
  border: 0;
  border-radius: 8px;
  background: linear-gradient(100deg,#9b7af5,#8054e8);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 750;
  cursor: pointer;
}
.auth-submit:hover:not(:disabled) {
  filter: brightness(1.1);
}
.auth-submit:disabled {
  opacity: .55;
  cursor: wait;
}
.auth-message {
  margin: 0;
  padding: 11px 12px;
  border: 1px solid;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.auth-message.error {
  border-color: rgba(251,113,133,.25);
  background: rgba(251,113,133,.07);
  color: #ffabb7;
}
.auth-message.success {
  border-color: rgba(85,214,166,.25);
  background: rgba(85,214,166,.07);
  color: #8be3bf;
}
.auth-switch {
  margin: 22px 0 0;
  color: #a39ab4;
  font-size: 12px;
  text-align: center;
  line-height: 1.8;
}
.auth-switch button {
  padding: 3px;
  border: 0;
  background: transparent;
  color: #c6b4ff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.auth-switch button:hover {
  color: #e0d5ff;
  text-decoration: underline;
}
.auth-security-note {
  margin: 22px 0 0;
  padding-top: 17px;
  border-top: 1px solid rgba(190,166,255,.1);
  color: #7e748f;
  font-size: 10px;
  line-height: 1.7;
  text-align: center;
}
@media (max-width: 480px) {
  .auth-card {
    padding: 25px 20px;
  }
  .auth-title {
    font-size: 24px;
  }
}
`;

export default function Auth({ onAuthenticated }: AuthProps) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    type: "error" | "success";
    text: string;
  } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const normalizedEmail = email.trim().toLowerCase();

      if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error) throw error;

        onAuthenticated?.();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (error) throw error;

      if (data.session) {
        onAuthenticated?.();
      } else {
        setMessage({
          type: "success",
          text: "Account created. Check your email for the verification link before signing in.",
        });
        setMode("sign-in");
        setPassword("");
      }
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Authentication failed. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage(null);
    setPassword("");
  }

  const isSignUp = mode === "sign-up";

  return (
    <>
      <style>{authStyles}</style>

      <main className="auth-page">
        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-brand">
            <span className="auth-brand-mark">T</span>
            <span className="auth-brand-name">
              Test<span>Pulse</span>
            </span>
          </div>

          <p className="auth-eyebrow">TEST EXECUTION INTELLIGENCE</p>

          <h1 className="auth-title" id="auth-title">
            {isSignUp ? "Create your account" : "Welcome back"}
          </h1>

          <p className="auth-description">
            {isSignUp
              ? "Create your TestPulse account to start managing your testing workspace."
              : "Sign in to continue to your TestPulse workspace."}
          </p>

          {message && (
            <p
              className={`auth-message ${message.type}`}
              role={message.type === "error" ? "alert" : "status"}
              aria-live="polite"
            >
              {message.text}
            </p>
          )}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-field">
              Email address
              <input
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                maxLength={254}
                required
              />
            </label>

            <label className="auth-field">
              Password
              <input
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  isSignUp ? "At least 8 characters" : "Enter your password"
                }
                autoComplete={
                  isSignUp ? "new-password" : "current-password"
                }
                minLength={isSignUp ? 8 : undefined}
                required
              />
            </label>

            <button
              className="auth-submit"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Please wait..."
                : isSignUp
                  ? "Create account"
                  : "Sign in"}
            </button>
          </form>

          <p className="auth-switch">
            {isSignUp
              ? "Already have an account? "
              : "New to TestPulse? "}

            <button
              type="button"
              onClick={() => changeMode(isSignUp ? "sign-in" : "sign-up")}
            >
              {isSignUp ? "Sign in" : "Create an account"}
            </button>
          </p>

          <p className="auth-security-note">
            Secure authentication powered by Supabase.
            <br />
            Your account must be verified when email confirmation is enabled.
          </p>
        </section>
      </main>
    </>
  );
}
