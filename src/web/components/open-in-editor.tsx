// src/web/components/open-in-editor.tsx
import { useSettings } from "../settings";
import { editorUrl } from "../lib/editor-urls";

export function OpenInEditorLineIcon({
  absPath,
  line,
}: {
  absPath: string;
  line: number;
}) {
  const editor = useSettings((s) => s.editor);
  if (editor === "none") return null;
  const url = editorUrl(editor, absPath, line, 1);
  if (!url) return null;
  return (
    <a
      href={url}
      title={`Open in ${editor} at line ${line}`}
      className="ml-1 text-neutral-400 opacity-0 hover:text-blue-500 group-hover:opacity-100"
      onClick={(e) => e.stopPropagation()}
    >
      ↗
    </a>
  );
}

export function OpenInEditorHeaderButton({
  absPath,
  firstLine,
}: {
  absPath: string;
  firstLine: number;
}) {
  const editor = useSettings((s) => s.editor);
  if (editor === "none") return null;
  const url = editorUrl(editor, absPath, firstLine, 1);
  if (!url) return null;
  return (
    <a
      href={url}
      title={`Open in ${editor}`}
      className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
    >
      Open in editor
    </a>
  );
}
