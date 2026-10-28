/** Match "/notes/:id" against "/notes/abc". Supports a trailing "/*" wildcard. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const clean = (s: string) => s.replace(/\/+$/, "") || "/";
  const p = clean(pattern).split("/");
  const a = clean(path).split("/");
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "*") {
      params["*"] = a.slice(i).join("/");
      return params;
    }
    if (a[i] === undefined) return null;
    if (p[i].startsWith(":")) {
      try {
        params[p[i].slice(1)] = decodeURIComponent(a[i]);
      } catch {
        return null;
      }
    } else if (p[i] !== a[i]) return null;
  }
  return a.length === p.length ? params : null;
}
