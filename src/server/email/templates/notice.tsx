import { EmailLayout, emailStyles } from "./layout";

/** A plain notice: a heading, a few paragraphs, an optional table and button. */
export interface NoticeEmailProps {
  lang: string;
  venueName: string;
  title: string;
  heading: string;
  paragraphs: string[];
  rows?: { label: string; value: string }[];
  button?: { label: string; href: string };
  note?: string;
  footer: string;
}

export function NoticeEmail({ lang, venueName, title, heading, paragraphs, rows, button, note, footer }: NoticeEmailProps) {
  return (
    <EmailLayout lang={lang} title={title} venueName={venueName} heading={heading} footer={footer}>
      {paragraphs.map((p, i) => (
        <p key={i} style={emailStyles.paragraph}>
          {p}
        </p>
      ))}
      {rows && rows.length > 0 ? (
        <table role="presentation" cellPadding={0} cellSpacing={0} style={{ width: "100%", margin: "0 0 20px" }}>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td style={{ ...emailStyles.label, borderTop: `1px solid ${emailStyles.line}` }}>{row.label}</td>
                <td style={{ ...emailStyles.value, borderTop: `1px solid ${emailStyles.line}` }}>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {button ? (
        <p style={{ margin: "0 0 20px" }}>
          <a href={button.href} style={emailStyles.button}>
            {button.label}
          </a>
        </p>
      ) : null}
      {note ? <p style={emailStyles.muted}>{note}</p> : null}
    </EmailLayout>
  );
}
