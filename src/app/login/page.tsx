import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-panel dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-semibold">Login</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Welcome back to SATYAM AI.</p>
        <form className="mt-6 space-y-4">
          <input
            type="email"
            placeholder="Email"
            className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-primary dark:border-slate-700"
          />
          <input
            type="password"
            placeholder="Password"
            className="w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 outline-none focus:border-primary dark:border-slate-700"
          />
          <button className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-white">Sign In</button>
        </form>
        <p className="mt-4 text-sm text-slate-500">
          New here?{" "}
          <Link href="/signup" className="font-medium text-primary">
            Create account
          </Link>
        </p>
      </div>
    </div>
  );
}
