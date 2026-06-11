import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Btn, Input, ErrorNote } from "./ui";
import logoNeg from "../assets/pw-logo-negative.png";

// Sign-in only: accounts are created by the regional admin, there is no signup.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr(error.message);
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-pw-black">
      <Card className="w-full max-w-sm p-7 animate-pw-pop">
        <img src={logoNeg} alt="Performance Windows" className="w-56 mx-auto mb-2" />
        <p className="text-center text-xs tracking-[0.3em] uppercase text-pw-muted mb-7">Performance tracker</p>
        <form onSubmit={submit} className="space-y-3">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full" autoComplete="username" />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full" autoComplete="current-password" />
          <ErrorNote>{err}</ErrorNote>
          <Btn type="submit" disabled={busy || !email || !password} className="w-full py-2.5">
            {busy ? "Signing in…" : "Sign In"}
          </Btn>
        </form>
        <p className="text-center text-xs text-pw-muted mt-5">No account? Ask Jake to set one up for you.</p>
      </Card>
    </div>
  );
}
