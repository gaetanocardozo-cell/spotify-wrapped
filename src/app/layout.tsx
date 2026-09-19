import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wrapped — personal listening analytics",
  description:
    "A calendar-driven alternative to Spotify Wrapped, with arbitrary date ranges and period-over-period comparisons.",
};

// System font stack: no network dependency, renders identically offline and
// in restricted environments.
const fontStack =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" style={{ fontFamily: fontStack }}>
      <body className="min-h-full flex flex-col bg-[#0a0a0b]">{children}</body>
    </html>
  );
}
