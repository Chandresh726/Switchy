import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CompanyPage({ params }: Props) {
  const { id } = await params;
  redirect(`/companies/${id}/jobs`);
}
