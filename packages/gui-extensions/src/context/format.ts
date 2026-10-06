export function createSessionContextFormatter(locale: string) {
  const rate = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 })
  // The fields luxon's DATETIME_MED preset passed to Intl; output is identical.

  const dateTime = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  })

  return {
    number(value: number | null | undefined) {
      if (value === undefined) return "—"

      if (value === null) return "—"

      return value.toLocaleString(locale)
    },
    percent(value: number | null | undefined) {
      if (value === undefined) return "—"

      if (value === null) return "—"

      return value.toLocaleString(locale) + "%"
    },
    rate(value: number | undefined) {
      return value === undefined ? "—" : rate.format(value)
    },
    time(value: number | undefined) {
      if (!value) return "—"

      return dateTime.format(value)
    },
  }
}
