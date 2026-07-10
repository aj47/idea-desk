export type Status = "inbox" | "developing" | "ready_to_film" | "filmed" | "published" | "archived";

export interface Idea {
  schema_version: 1;
  idea_id: string;
  title: string;
  premise: string;
  status: Status;
  source: { type: string; reference?: string };
  viewer_promise?: string;
  hook?: string;
  platforms: string[];
  content_types: string[];
  tags: string[];
  priority: number;
  notes: string[];
  related_stream_ids: string[];
  related_topic_ids: string[];
  created_at: string;
  updated_at: string;
  legacy?: unknown;
}
