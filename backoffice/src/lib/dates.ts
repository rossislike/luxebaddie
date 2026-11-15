const dateAndTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

/** "Nov 14, 2026, 7:00 AM", in the owner's own time zone. */
export const formatDateTime = (iso: string) => dateAndTime.format(new Date(iso));

/** "Nov 14, 2026". */
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));
