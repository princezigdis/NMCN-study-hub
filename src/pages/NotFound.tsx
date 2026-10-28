import { Link } from "../lib/router";
import { EmptyState, Button } from "../components/ui";

export default function NotFound() {
  return (
    <EmptyState icon="search" title="Page not found" action={<Link to="/"><Button>Go home</Button></Link>}>
      The page you're looking for doesn't exist or has moved.
    </EmptyState>
  );
}
