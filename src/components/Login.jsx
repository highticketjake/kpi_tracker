import { useState } from "react";
import { supabase } from "../lib/supabase";
import { Card, Btn, Input, ErrorNote } from "./ui";

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
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="font-display text-4xl text-center mb-1">KPI TRACKER</h1>
        <p className="text-center text-sm text-gray-400 mb-6">Sign in with your team account</p>
        <form onSubmit={submit} className="space-y-3">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full" autoComplete="username" />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full" autoComplete="current-password" />
          <ErrorNote>{err}</ErrorNote>
          <Btn type="submit" disabled={busy || !email || !password} className="w-full py-2">
            {busy ? "Signing in…" : "Sign In"}
          </Btn>
        </form>
        <p className="text-center text-xs text-gray-400 mt-4">
          No account? Ask Jake to set one up for you.
        </p>
      </Card>
    </div>
  );
}
