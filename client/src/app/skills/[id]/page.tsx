import { SkillEditor } from "./_components/SkillEditor";

/* Route: /skills/:id (Config + Preview). Thin route entry. */
export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SkillEditor id={id} />;
}
