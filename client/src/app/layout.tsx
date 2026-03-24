import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Decked — Custom Card Games",
  description: "Create and play custom card games with friends",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen">{children}</body>
    </html>
  );
}
