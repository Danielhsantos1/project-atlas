import { EditorPage } from "@/features/editor/EditorPage";

export default async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorPage id={id} />;
}
