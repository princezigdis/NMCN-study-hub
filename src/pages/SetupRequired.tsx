export default function SetupRequired() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20">
      <h1 className="text-2xl font-bold">Almost there: connect Supabase</h1>
      <p className="ink-2 mt-3 text-sm leading-relaxed">
        The app needs your Supabase project's public URL and anon key. Copy <code>.env.example</code> to <code>.env.local</code>,
        fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart the dev server.
        See <code>docs/SETUP.md</code> for the full checklist.
      </p>
    </div>
  );
}
