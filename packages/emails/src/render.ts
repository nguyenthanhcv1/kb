import { render } from "@react-email/render";
import type { ReactElement } from "react";

export interface RenderedEmail {
  html: string;
  /** Plain-text alternative (links as `text [url]`), for clients that block HTML. */
  text: string;
}

/** Renders a React Email element to the HTML body and its plain-text alternative. */
export async function renderEmail(element: ReactElement): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
