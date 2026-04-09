// src/web/lib/editor-urls.ts
import type { Editor } from "../settings";

export function editorUrl(
  editor: Editor,
  absPath: string,
  line: number,
  col: number,
): string | null {
  if (editor === "none") return null;
  const encoded = absPath.split("/").map(encodeURIComponent).join("/");
  switch (editor) {
    case "vscode":
      return `vscode://file${encoded}:${line}:${col}`;
    case "cursor":
      return `cursor://file${encoded}:${line}:${col}`;
    case "zed":
      return `zed://file${encoded}:${line}:${col}`;
    case "idea":
      return `idea://open?file=${encoded}&line=${line}`;
    case "subl":
      return `subl://open?url=file://${encoded}&line=${line}`;
    default:
      return null;
  }
}
