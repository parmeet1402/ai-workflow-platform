import LogoutButton from "@/components/logout-button";
import { DashboardOrg } from "./dashboard-org";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Dashboard() {
    const supabase = await createClient();

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    return (
        <div className="flex flex-col gap-4 p-6">
            <div>
                <p className="text-lg">Welcome {user.email}</p>
                <DashboardOrg />
            </div>
            <LogoutButton />
        </div>
    );
}