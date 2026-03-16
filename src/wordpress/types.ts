export interface WPPost {
  readonly id: number;
  readonly title: { readonly rendered: string };
  readonly content: { readonly rendered: string };
  readonly excerpt: { readonly rendered: string };
  readonly slug: string;
  readonly status: "publish" | "draft" | "pending" | "private" | "future";
  readonly date: string;
  readonly modified: string;
  readonly link: string;
  readonly type: string;
}

export interface WPPage {
  readonly id: number;
  readonly title: { readonly rendered: string };
  readonly content: { readonly rendered: string };
  readonly slug: string;
  readonly status: "publish" | "draft" | "pending" | "private";
  readonly date: string;
  readonly modified: string;
  readonly link: string;
  readonly parent: number;
}

export interface PostUpdate {
  readonly title?: string;
  readonly content?: string;
  readonly excerpt?: string;
  readonly status?: string;
}

export interface PageUpdate {
  readonly title?: string;
  readonly content?: string;
  readonly status?: string;
}
