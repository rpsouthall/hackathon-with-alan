import type { Metadata } from "next";
import "./globals.css";
import "./lesson.css";
import "./environments.css";

export const metadata: Metadata = {
  title: "Kyoto Conversations",
  description: "Practice real Japanese through conversations in an immersive Kyoto-inspired world.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
