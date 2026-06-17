import {
  Braces,
  Database,
  File,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Table2,
  type LucideIcon,
} from "lucide-react";
import type { Category } from "./mime";

/** Icon used to represent each file category across the UI. */
export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  image: ImageIcon,
  csv: Table2,
  tsv: Table2,
  json: Braces,
  jsonl: Braces,
  parquet: Database,
  markdown: FileText,
  text: FileText,
  pdf: FileText,
  audio: Music,
  video: Film,
  binary: File,
};
