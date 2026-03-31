import { Inter, JetBrains_Mono, Syne } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const geistSans = Inter({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const shellDisplay = Syne({
  subsets: ["latin"],
  variable: "--font-shell-display",
  display: "swap",
});

export const metadata = {
  title: "AITrade — Crypto bots & AI optimization",
  description: "Serverless crypto trading: strategies, backtests, copy trading, Binance.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${shellDisplay.variable} min-h-screen font-sans antialiased`}
      >
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
