"use client";

import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { color, radius } from "@/config/tokens";
import "./richtext.css";

/** Empty ProseMirror document. */
export const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } })];

/**
 * Shared rich-text surface used by every text-based block. Tiptap under the hood.
 * Present mode = read-only editor (no chrome). Edit mode (dev authoring) = the
 * same editor made editable with a compact format toolbar. Content is stored as
 * ProseMirror JSON in the block's data — the durable, versionable representation.
 */
export function RichText({
  value,
  editing = false,
  onChange,
  style,
}: {
  value: JSONContent | null;
  editing?: boolean;
  onChange?: (json: JSONContent) => void;
  style?: React.CSSProperties;
}) {
  const editor = useEditor({
    extensions,
    content: value ?? EMPTY_DOC,
    editable: editing,
    immediatelyRender: false, // avoid SSR hydration mismatch in Next
    onUpdate: ({ editor }) => onChange?.(editor.getJSON()),
  });

  useEffect(() => {
    editor?.setEditable(editing);
  }, [editing, editor]);

  // Sync external content changes (restore / programmatic) while not editing.
  useEffect(() => {
    if (!editor || editing) return;
    const next = value ?? EMPTY_DOC;
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) {
      editor.commands.setContent(next);
    }
  }, [value, editing, editor]);

  return (
    <div className="agabi-rt" style={style}>
      {editing && editor ? <RtToolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function RtToolbar({ editor }: { editor: Editor }) {
  const btn = (active: boolean): React.CSSProperties => ({
    minWidth: 26,
    height: 26,
    padding: "0 6px",
    borderRadius: radius.sm,
    border: `1px solid ${active ? color.violet2 : color.border}`,
    background: active ? "rgba(167,139,250,0.16)" : color.surface,
    color: active ? color.violet3 : color.muted3,
    fontSize: 12,
    fontFamily: "var(--font-mono, monospace)",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  });

  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        flexWrap: "wrap",
        marginBottom: 8,
        padding: 6,
        borderRadius: radius.md,
        border: `1px solid ${color.border}`,
        background: "rgba(10,12,17,0.9)",
      }}
      // keep clicks inside the editor (don't trigger canvas/select)
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button type="button" style={btn(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold"><b>B</b></button>
      <button type="button" style={btn(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic"><i>I</i></button>
      <button type="button" style={btn(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline"><u>U</u></button>
      <button type="button" style={btn(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()} aria-label="Strikethrough"><s>S</s></button>
      <button type="button" style={btn(editor.isActive("code"))} onClick={() => editor.chain().focus().toggleCode().run()} aria-label="Inline code">{"</>"}</button>
      <button type="button" style={btn(editor.isActive("link"))} onClick={setLink} aria-label="Link">↗</button>
      <span style={{ width: 1, background: color.border, margin: "2px 2px" }} />
      <button type="button" style={btn(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="Heading">H</button>
      <button type="button" style={btn(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list">•</button>
      <button type="button" style={btn(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Numbered list">1.</button>
      <button type="button" style={btn(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()} aria-label="Quote">&ldquo;</button>
    </div>
  );
}
