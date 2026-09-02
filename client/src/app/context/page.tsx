import { ProjectContextView } from "./_components/ProjectContextView";

/* Route: /context (Project Context, REQ-8). Thin route entry — the view, its
   tabs, the document list and styles are colocated under _components. */
export default function ContextPage() {
  return <ProjectContextView />;
}
