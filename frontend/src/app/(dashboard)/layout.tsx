import { AppShell } from "@/components/app-shell";
import { ProtectedDashboard } from "@/components/auth-guards";

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ProtectedDashboard><AppShell>{children}</AppShell></ProtectedDashboard>;
}