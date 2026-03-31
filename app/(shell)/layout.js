import { DashboardNav } from "@/components/DashboardNav";
import { SpotWalletProvider } from "@/components/SpotWalletProvider";
import { ShellAmbient } from "@/components/shell/ShellAmbient";

export default function ShellLayout({ children }) {
  return (
    <SpotWalletProvider>
      <div className="min-h-screen bg-background">
        <DashboardNav />
        <main className="relative flex justify-center px-3 pb-12 pt-2 sm:px-4 sm:pt-3">
          <div className="relative w-[min(90%,90vw)] max-w-[1920px] min-w-0">
            <ShellAmbient />
            <div className="relative z-[1] flex flex-col gap-8">{children}</div>
          </div>
        </main>
      </div>
    </SpotWalletProvider>
  );
}
