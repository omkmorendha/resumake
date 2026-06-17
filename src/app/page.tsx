import { dockerPreflight } from "@/lib/latex/preflight";

// The preflight shells out to `docker`, so this page must render on the
// Node runtime and never be statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  const preflight = await dockerPreflight();

  if (!preflight.ok) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <div className="max-w-lg rounded-lg border border-amber-300 bg-amber-50 p-6 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <h1 className="mb-2 text-lg font-semibold">Setup needed</h1>
          <p className="text-sm leading-6">{preflight.guide}</p>
          <p className="mt-3 text-xs text-amber-700/80 dark:text-amber-300/70">
            Resumake will work normally once this is resolved — reload after fixing.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Resumake</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Local-first AI resume feedback. Skeleton — UI coming in M1.
      </p>
    </main>
  );
}
