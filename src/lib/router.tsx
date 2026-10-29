// A small, dependency-free client router (History API) covering what this app
// needs: route matching with :params, links, programmatic navigation, redirects
// and query strings. Keeps the bundle small and avoids version churn.
import {
  type AnchorHTMLAttributes,
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { matchPath } from "./matchPath";

export { matchPath };

interface RouterState {
  path: string;
  search: string;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const RouterCtx = createContext<RouterState | null>(null);
const ParamsCtx = createContext<Record<string, string>>({});

/** Sub-path the site is served from ("" at a domain root, "/nmcn-study-hub" on a GitHub project page). */
export const BASE: string = ((import.meta.env.BASE_URL as string | undefined) ?? "/").replace(/\/+$/, "");

/** Prefix an in-app path ("/dashboard") with the base for hrefs and history entries. */
export function withBase(to: string): string {
  return to.startsWith("/") && !to.startsWith("//") ? `${BASE}${to}` : to;
}

function current() {
  let path = window.location.pathname || "/";
  if (BASE && (path === BASE || path.startsWith(`${BASE}/`))) path = path.slice(BASE.length) || "/";
  return { path, search: window.location.search };
}

export function Router({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(current);

  useEffect(() => {
    const onPop = () => setLoc(current());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (/^https?:\/\//.test(to)) {
      window.location.assign(to);
      return;
    }
    const url = withBase(to);
    if (opts?.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    setLoc(current());
    window.scrollTo({ top: 0 });
  }, []);

  const value = useMemo(() => ({ ...loc, navigate }), [loc, navigate]);
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

function useRouter(): RouterState {
  const ctx = useContext(RouterCtx);
  if (!ctx) throw new Error("Router context missing");
  return ctx;
}

export const useNavigate = () => useRouter().navigate;
export const useLocation = () => {
  const { path, search } = useRouter();
  return { pathname: path, search };
};
export const useParams = <T extends Record<string, string>>() => useContext(ParamsCtx) as T;

export function useSearchParams(): [URLSearchParams, (next: Record<string, string | null>) => void] {
  const { search, path, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const set = useCallback((next: Record<string, string | null>) => {
    const p = new URLSearchParams(search);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    navigate(`${path}${qs ? `?${qs}` : ""}`, { replace: true });
  }, [search, path, navigate]);
  return [params, set];
}

export interface RouteDef {
  path: string;
  element: ReactNode;
}

/** Renders the first matching route. */
export function Routes({ routes, fallback }: { routes: RouteDef[]; fallback: ReactNode }) {
  const { path } = useRouter();
  for (const r of routes) {
    const params = matchPath(r.path, path);
    if (params) return <ParamsCtx.Provider value={params}>{r.element}</ParamsCtx.Provider>;
  }
  return <>{fallback}</>;
}

export function Navigate({ to, replace = true }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace }), [to, replace, navigate]);
  return null;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const navigate = useNavigate();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={withBase(to)} onClick={handle} {...rest} />;
}

/** Link that knows whether it's active (exact or prefix match). */
export function NavLink({ to, className, exact, ...rest }: Omit<LinkProps, "className"> & {
  className: (active: boolean) => string;
  exact?: boolean;
}) {
  const { path } = useRouter();
  const active = exact ? path === to : path === to || path.startsWith(`${to}/`);
  return <Link to={to} className={className(active)} aria-current={active ? "page" : undefined} {...rest} />;
}
