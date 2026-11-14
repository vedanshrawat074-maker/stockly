"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreateShopForm } from "@/components/create-shop-form";
import { PageHeading } from "@/components/dashboard-ui";

export default function CreateNewShopPage() {
  const router = useRouter();

  return (
    <div className="page-width">
      <PageHeading
        eyebrow="Workspace"
        title="Create New Shop"
        description="Add another shop to your account. Your existing shops and their data will remain unchanged."
        action={<Link href="/dashboard" className="button-secondary">Cancel</Link>}
      />
      <section className="surface max-w-2xl p-5 sm:p-6">
        <CreateShopForm onCreated={() => router.replace("/dashboard")} buttonLabel="Create New Shop" />
      </section>
    </div>
  );
}
