import type { CSSProperties, ReactNode } from "react";

/**
 * Shared frame for every email. Plain tables and inline styles only: that is
 * what mail clients render reliably. Colours follow the site.
 */

const NAVY = "#0b0f24";
const CYAN = "#5cc8f5";
const INK = "#141a33";
const MUTED = "#5b6280";
const LINE = "#e3e6f0";

export const emailStyles = {
  paragraph: { margin: "0 0 16px", fontSize: "15px", lineHeight: "24px", color: INK },
  muted: { margin: "0 0 16px", fontSize: "13px", lineHeight: "20px", color: MUTED },
  code: {
    margin: "0 0 20px",
    padding: "16px",
    borderRadius: "10px",
    backgroundColor: "#f1f4fb",
    color: NAVY,
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
    fontSize: "30px",
    fontWeight: 700,
    letterSpacing: "6px",
    textAlign: "center",
  },
  button: {
    display: "inline-block",
    padding: "12px 20px",
    borderRadius: "8px",
    backgroundColor: NAVY,
    color: "#ffffff",
    fontSize: "15px",
    fontWeight: 600,
    textDecoration: "none",
  },
  label: { padding: "8px 16px 8px 0", fontSize: "13px", color: MUTED, verticalAlign: "top", whiteSpace: "nowrap" },
  value: { padding: "8px 0", fontSize: "15px", color: INK, verticalAlign: "top" },
  line: LINE,
} satisfies Record<string, CSSProperties | string>;

export function EmailLayout({
  lang,
  title,
  venueName,
  heading,
  children,
  footer,
}: {
  lang: string;
  title: string;
  venueName: string;
  heading: string;
  children: ReactNode;
  footer: string;
}) {
  return (
    <html lang={lang}>
      {/* A standalone HTML document for mail clients, not a Next.js page. */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
      </head>
      <body style={{ margin: 0, padding: 0, backgroundColor: "#f4f5fa" }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ backgroundColor: "#f4f5fa" }}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: "24px 12px" }}>
                <table
                  role="presentation"
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    maxWidth: "480px",
                    backgroundColor: "#ffffff",
                    borderRadius: "14px",
                    overflow: "hidden",
                    fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                  }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          padding: "18px 24px",
                          backgroundColor: NAVY,
                          borderBottom: `3px solid ${CYAN}`,
                          color: "#ffffff",
                          fontSize: "13px",
                          fontWeight: 700,
                          letterSpacing: "2px",
                          textTransform: "uppercase",
                        }}
                      >
                        {venueName}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "28px 24px 12px" }}>
                        <h1 style={{ margin: "0 0 16px", fontSize: "22px", lineHeight: "28px", color: INK }}>
                          {heading}
                        </h1>
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "16px 24px 24px", borderTop: `1px solid ${LINE}` }}>
                        <p style={{ margin: 0, fontSize: "12px", lineHeight: "18px", color: MUTED }}>{footer}</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
