import { EmailLayout, emailStyles } from "./layout";

export interface BookingConfirmedEmailProps {
  lang: string;
  venueName: string;
  code: string;
  manageUrl: string;
  rows: { label: string; value: string }[];
  copy: {
    subject: string;
    heading: string;
    intro: string;
    codeLabel: string;
    manage: string;
    arrival: string;
    cancellation: string;
    footer: string;
  };
}

export function BookingConfirmedEmail({ lang, venueName, code, manageUrl, rows, copy }: BookingConfirmedEmailProps) {
  return (
    <EmailLayout lang={lang} title={copy.subject} venueName={venueName} heading={copy.heading} footer={copy.footer}>
      <p style={emailStyles.paragraph}>{copy.intro}</p>
      <p style={{ ...emailStyles.muted, margin: "0 0 6px" }}>{copy.codeLabel}</p>
      <p style={emailStyles.code}>{code}</p>

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

      <p style={{ margin: "0 0 20px" }}>
        <a href={manageUrl} style={emailStyles.button}>
          {copy.manage}
        </a>
      </p>
      <p style={emailStyles.paragraph}>{copy.arrival}</p>
      <p style={emailStyles.muted}>{copy.cancellation}</p>
    </EmailLayout>
  );
}
