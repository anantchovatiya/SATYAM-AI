import Link from "next/link";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-semibold">Create account</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Start managing leads with SATYAM AI.</p>
        <form className="mt-6 space-y-4">
          <input
            type="text"
            placeholder="Full name"
            className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-primary dark:border-slate-700"
          />
          <input
            type="email"
            placeholder="Work email"
            className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-primary dark:border-slate-700"
          />
          <input
            type="password"
            placeholder="Password"
            className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-primary dark:border-slate-700"
          />
          <button className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-white">Sign Up</button>
        </form>
        <p className="mt-4 text-sm text-slate-500">
          Already registered?{" "}
          <Link href="/login" className="font-medium text-primary">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}
