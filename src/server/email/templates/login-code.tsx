import { EmailLayout, emailStyles } from "./layout";

export interface LoginCodeEmailProps {
  lang: string;
  venueName: string;
  code: string;
  copy: {
    subject: string;
    heading: string;
    intro: string;
    validity: string;
    ignore: string;
    footer: string;
  };
}

export function LoginCodeEmail({ lang, venueName, code, copy }: LoginCodeEmailProps) {
  return (
    <EmailLayout lang={lang} title={copy.subject} venueName={venueName} heading={copy.heading} footer={copy.footer}>
      <p style={emailStyles.paragraph}>{copy.intro}</p>
      <p style={emailStyles.code}>{code}</p>
      <p style={emailStyles.paragraph}>{copy.validity}</p>
      <p style={emailStyles.muted}>{copy.ignore}</p>
    </EmailLayout>
  );
}
