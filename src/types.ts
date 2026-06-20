export interface PrContext {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  isAIAuthored?: boolean;
}

export type Severity = "critical" | "high" | "medium" | "low";

export type Category =
  | "logic"
  | "security"
  | "performance"
  | "best-practice"
  | "test"
  | "comment";

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface CommentSpec {
  file: string;
  line: number;
  category: Category;
  severity: Severity;
  message: string;
  rationale: string;
  suggestion?: string;
}

export interface DiffFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  patch?: string;
  additions: number;
  deletions: number;
}
