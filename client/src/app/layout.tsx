import type { Metadata } from "next";
import Script from "next/script";

// next/script ScriptProps has a JSX intersection issue with React 19 that
// rejects `src` at the call site; an untyped alias sidesteps it.
const NextScript = Script as unknown as (props: any) => any;
import InviteToast from "@/components/InviteToast";
import PartyBar from "@/components/PartyBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Decked — Custom Card Games",
  description: "Create and play custom card games with friends",
  icons: {
    icon: "/icon.svg",
    apple: "/icon-192.png",
  },
  manifest: "/manifest.json",
  themeColor: "#7c3aed",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Decked",
  },
  viewport: {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen" suppressHydrationWarning>
        {/* Google Sign-In script is lazy-loaded by GoogleSignIn.tsx only when an
            unauthenticated user actually needs the button — saves ~96 KB transfer
            (258 KB raw) on every page for everyone else. */}
        <NextScript id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
          }
        `}</NextScript>
        <InviteToast />
        <PartyBar />
        <main>{children}</main>
      </body>
    </html>
  );
}
