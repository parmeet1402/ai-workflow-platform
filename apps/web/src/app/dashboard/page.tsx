import LogoutButton from "@/components/logout-button";
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

    return <div>Welcome {user.email}

        <LogoutButton />
    </div>;
}