import { Link, Meta } from "@solidjs/meta"
import icon from "../assets/identity/favicon-96.png"
import shortcut from "../assets/identity/favicon.ico"
import touch from "../assets/identity/apple-touch-icon.png"

export const Favicon = () => {
  return (
    <>
      <Link rel="icon" type="image/png" href={icon} sizes="96x96" />
      <Link rel="shortcut icon" href={shortcut} />
      <Link rel="apple-touch-icon" sizes="180x180" href={touch} />
      <Link rel="manifest" href="/site.webmanifest" />
      <Meta name="apple-mobile-web-app-title" content="OpenCode" />
    </>
  )
}
