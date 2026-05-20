export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cat Density Map",
};

import PublicMapLoader from "./PublicMapLoader";

export default function PublicMapPage() {
  return <PublicMapLoader />;
}
