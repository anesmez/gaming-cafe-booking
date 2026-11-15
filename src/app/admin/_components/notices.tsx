import { getTranslations } from "next-intl/server";

type Query = Record<string, string | string[] | undefined>;

/** The ?done= and ?error= banners after a form posts and redirects back. */
export async function Notices({
  query,
  doneKey,
}: {
  query: Query;
  doneKey: string;
}) {
  const t = await getTranslations("admin");
  const done = typeof query.done === "string" ? query.done : null;
  const error = typeof query.error === "string" ? query.error : null;
  return (
    <>
      {done && t.has(`${doneKey}.${done}`) ? (
        <p
          role="status"
          className="rounded-md border border-primary/40 bg-primary/10 px-4 py-3 text-sm"
        >
          {t(`${doneKey}.${done}`)}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm"
        >
          {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.other")}
        </p>
      ) : null}
    </>
  );
}
