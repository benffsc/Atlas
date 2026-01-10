import type { Metadata } from "next";
import "./globals.css";
import GlobalSearch from "@/components/GlobalSearch";

export const metadata: Metadata = {
  title: "Atlas TNR",
  description: "Cat tracking and TNR management system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="container nav-inner">
            <a href="/" className="nav-brand">
              Atlas TNR
            </a>
            <GlobalSearch />
            <div className="nav-links">
              <a href="/cats" className="nav-link">
                Cats
              </a>
              <a href="/people" className="nav-link">
                People
              </a>
              <a href="/places" className="nav-link">
                Places
              </a>
              <a href="/search" className="nav-link">
                Search
              </a>
            </div>
          </div>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
