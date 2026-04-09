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
      className="ml-1 text-fg-muted opacity-0 hover:text-accent group-hover:opacity-100"
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
      className="rounded border border-border-strong px-2 py-0.5 text-xs text-fg-muted hover:border-accent hover:text-fg"
    >
      Open in editor
    </a>
  );
}
