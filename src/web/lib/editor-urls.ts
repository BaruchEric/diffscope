// src/web/lib/editor-urls.ts
import type { Editor } from "../settings";

export function editorUrl(
  editor: Editor,
  absPath: string,
  line: number,
  col: number,
): string | null {
  if (editor === "none") return null;
  // encodeURI preserves the leading slash and path separators while still
  // escaping spaces and other unsafe characters.
  const encoded = encodeURI(absPath);
  switch (editor) {
    case "vscode":
      return `vscode://file${encoded}:${line}:${col}`;
    case "cursor":
      return `cursor://file${encoded}:${line}:${col}`;
    case "zed":
      return `zed://file${encoded}:${line}:${col}`;
    case "idea":
      return `idea://open?file=${encoded}&line=${line}&column=${col}`;
    case "subl":
      return `subl://open?url=file://${encoded}&line=${line}&column=${col}`;
    default:
      return null;
  }
}
