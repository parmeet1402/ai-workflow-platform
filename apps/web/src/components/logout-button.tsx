"use client";

import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
    const supabase = createClient();

    const logout = async () => {
        await supabase.auth.signOut();
        window.location.href = "/login";
    };

    return <button className="bg-red-500 px-2 text-white rounded-sm cursor-pointer" onClick={logout}>Logout</button>;
}